// @ts-check
// P7.8 / §B4 STEP 5 — CALENDAR SYNC. Google first.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 3a.4 (spec 03a §2/§7/§11) — `findConnectionsNeedingRenewal`/`renewChannel` (below) and
//     `applyRemoteEvent`/`handleSyncTokenGone` (below) were written here with ZERO callers anywhere
//     in `src/` — MEASURED, `grep -rn "findConnectionsNeedingRenewal\|renewChannel\|applyRemoteEvent\
//     |handleSyncTokenGone" src/` before this task returned only this file's own definitions and
//     `test/`'s direct calls. §7 names this file exactly, `calendarSync.mjs:26,72` for the renewal
//     pair and `calendarSync.mjs:111` for `applyRemoteEvent` — the two periodic jobs
//     `sweep_calendar_renewal`/`sweep_calendar_pull` (`src/queue/tasks.mjs`) are the callers they
//     have never had. `applyRemoteEvent` is EXTENDED below (§7's own instruction: "code change, not
//     a migration") to set `remote_change_pending`/`remote_change_detail` (0288) and emit
//     `calendar.remote_change.flagged` (§5) when an applied remote change touches a REAL booking
//     still open — everything else about it (the echo/unchanged short-circuits above) is UNCHANGED.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ★★★ §B3.1, verbatim: "Google push channels expire at a maximum of 604,800 seconds (7 days) …
//   ★ IF RENEWAL FAILS YOU SILENTLY START MISSING CHANGE EVENTS. THAT IS THIS PROJECT'S EXACT
//   FAILURE CLASS. A periodic `updated_after` sweep is the standard production safety net."
//
// ★★ THE DESIGN FOLLOWS FROM ONE OBSERVATION: a silent sync failure and an empty calendar produce
// IDENTICAL OUTPUT. Nothing to log, no error to catch, no alert to fire — just a coach whose
// bookings stop appearing, noticed days later by a human. So this module is built around making
// that state NAME ITSELF:
//   · a connection has an explicit `status`, and `renewal_failed` is one of its values,
//   · `channel_expires_at` is stored, so "should have renewed by now" is a QUERY, not a hope,
//   · and the SWEEP is the backstop — it runs on its own clock and does not trust the webhook.

import { emit, userActor } from "../events/outbox.mjs";
// ★ Task 3a.6 (spec 03a §2, F686) — the remote-changes conflict queue (list/accept/reject). `notFound`
//   for a booking the caller may not act on (RECORD_QUERIES.booking's own scoped read, reschedule.mjs's
//   established idiom); `rescheduleBooking` is accept's own "internally calls rescheduleBooking" (§2's
//   own route row).
import { notFound } from "../http/errors.mjs";
import { RECORD_QUERIES } from "../records/queries.mjs";
import { rescheduleBooking } from "./reschedule.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ [DOC] Google's hard maximum for a push channel: 604800s = 7 days. */
export const GOOGLE_MAX_CHANNEL_SECONDS = 604_800;

/**
 * ★★ Renew EARLY, not at the deadline. A renewal attempted at T-0 has no room for a transient
 * failure, and a transient failure at T-0 is a silent outage. One day of headroom buys ~24
 * retries at hourly cadence.
 */
export const RENEWAL_HEADROOM_MS = 24 * 60 * 60 * 1000;

/** Connections that must be renewed now, and connections that are already overdue. */
export async function findConnectionsNeedingRenewal(tx, { now = new Date() } = {}) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id", "host_id", "provider", "channel_expires_at", "status", "last_error"])
    .where((eb) => eb("status", "in", ["active", "renewal_failed"]))
    .where("channel_expires_at", "is not", null)
    .where("channel_expires_at", "<=", new Date(now.getTime() + RENEWAL_HEADROOM_MS))
    .orderBy("channel_expires_at", "asc"));
  return rows;
}

/**
 * ★★★ THE ASSERTION THAT MAKES SILENCE AUDIBLE.
 * A connection whose channel has ALREADY EXPIRED while still marked `active` is, by definition,
 * missing change events right now and claiming to be fine. ★ This is the query P7.9 asserts on,
 * and it is what a health check and an alert both read.
 */
export async function findSilentlyBrokenConnections(tx, { now = new Date() } = {}) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id", "host_id", "provider", "channel_expires_at", "status"])
    .where("channel_expires_at", "is not", null)
    .where("channel_expires_at", "<", now)
    .where("status", "=", "active"));
  return rows;
}

/** Raised when a connection is degraded. ★ It carries the connection so an alert can name it. */
export class CalendarSyncDegraded extends Error {
  constructor(message, connection) {
    super(message);
    this.name = 'CalendarSyncDegraded';
    this.code = 'calendar_sync_degraded';
    this.connection = connection;
  }
}

/**
 * Renew one channel. ★★ `renewFn` is injected so a failure can be provoked without a network.
 *
 * ★★★ THE WHOLE POINT IS THE CATCH BLOCK. A failed renewal must move the connection OUT of
 * `active` — because `active` with an expired channel is the silent state. It is recorded as
 * `renewal_failed`, with the error text, so the next sweep finds it and a human can see why.
 */
export async function renewChannel(tx, connectionId, renewFn, { now = new Date() } = {}) {
  try {
    const result = await renewFn(connectionId);
    const expires = result?.expiresAt instanceof Date
      ? result.expiresAt
      : new Date(now.getTime() + GOOGLE_MAX_CHANNEL_SECONDS * 1000);

    // ★ Never store an expiry beyond what the provider can actually grant. Trusting a provider's
    // number blindly is how a channel "expires" in 2037 and is never renewed.
    const cap = new Date(now.getTime() + GOOGLE_MAX_CHANNEL_SECONDS * 1000);
    const capped = expires > cap ? cap : expires;

    await run(tx, db
      .updateTable("keystone.calendar_connection")
      .set({ channel_expires_at: capped, last_renewed_at: now, status: "active", last_error: null })
      .where("id", "=", connectionId));
    return { renewed: true, expiresAt: capped };
  } catch (e) {
    // ★★★ LOUD, NOT QUIET. The status change is what makes the failure findable; the throw is
    // what makes it reach the caller. Doing only one of the two is how this fails silently.
    await run(tx, db
      .updateTable("keystone.calendar_connection")
      .set({ status: "renewal_failed", last_error: String(e?.message ?? e).slice(0, 500) ?? null })
      .where("id", "=", connectionId));
    throw new CalendarSyncDegraded(
      `Calendar channel renewal FAILED for connection ${connectionId}: ${e?.message ?? e}`,
      connectionId);
  }
}

/** §1's "never silent" rule, applied narrowly: a remote edit is only ever flagged for a booking
 *  still OPEN — same closed set `reschedule.mjs`'s own `MOVABLE` uses, kept as this module's own
 *  copy rather than an import (this file has never imported from `booking/` and a flag on a
 *  cancelled/completed booking would be a flag nobody can act on). */
const OPEN_BOOKING_STATES = new Set(["confirmed", "pending_payment"]);

/**
 * ★★ Apply an incoming change. §B3.2:
 *   "Google shares ONE event id across attendees; Microsoft and iCloud do not.
 *    ★ Key records on CONNECTION ID PLUS EVENT ID, never event id alone.
 *    ★ Tag our own writes with a sync marker so an A→B→A loop cannot form."
 *
 * ★★★ TASK 3a.4 EXTENSION (§7): `proposedStartsAt`/`proposedEndsAt` are OPTIONAL and NEW — when
 *     given, and the applied change touches an event mapped to a REAL booking still OPEN
 *     (`OPEN_BOOKING_STATES` above), the change is not silently absorbed: `remote_change_pending`
 *     is set true, `remote_change_detail` carries ONLY the two proposed instants (0288 — never a
 *     title, never any other field the outside provider sent), and `calendar.remote_change.flagged`
 *     (§5, `subjectType: 'booking'`) is emitted so it reaches History on the booking itself. A
 *     change with no mapped booking (a plain busy block) or one whose booking is no longer open is
 *     applied exactly as before this task — nothing to reconcile, nothing to flag.
 */
export async function applyRemoteEvent(tx, { tenantId, connectionId, externalEventId, etag,
                                             syncMarker = null, proposedStartsAt = null,
                                             proposedEndsAt = null, now = new Date() }) {
  // ★★★ LOOP PREVENTION. If the incoming event carries OUR marker, it is our own write coming
  // back. Applying it would write again, which arrives again — an A→B→A loop that looks like
  // heavy but healthy traffic until it saturates the rate limit.
  const existing = await run(tx, db
    .selectFrom("keystone.calendar_event_map")
    .select(["id", "written_by_us", "sync_marker", "external_etag"])
    .where("connection_id", "=", connectionId)
    .where("external_event_id", "=", externalEventId));

  if (existing.rows[0]?.written_by_us && existing.rows[0]?.sync_marker === syncMarker && syncMarker) {
    await run(tx, db
      .updateTable("keystone.calendar_event_map")
      .set({ last_seen_at: now, written_by_us: false })
      .where("id", "=", existing.rows[0].id));
    return { applied: false, reason: 'echo_of_our_own_write' };
  }

  // ★ An unchanged etag means nothing to do — a sweep re-reads everything, and re-applying every
  // unchanged event on every sweep is how a safety net becomes a load problem.
  if (existing.rows[0] && etag && existing.rows[0].external_etag === etag) {
    await run(tx, db
      .updateTable("keystone.calendar_event_map")
      .set({ last_seen_at: now })
      .where("id", "=", existing.rows[0].id));
    return { applied: false, reason: 'unchanged' };
  }

  const upserted = await tx.query(
    `INSERT INTO keystone.calendar_event_map
       (tenant_id, connection_id, external_event_id, external_etag, written_by_us, last_seen_at)
     VALUES ($1,$2,$3,$4,false,$5)
     ON CONFLICT (connection_id, external_event_id)
     DO UPDATE SET external_etag = EXCLUDED.external_etag,
                   last_seen_at  = EXCLUDED.last_seen_at,
                   written_by_us = false
     RETURNING id, booking_id`,
    [tenantId, connectionId, externalEventId, etag ?? null, now]);
  const mapRow = upserted.rows[0];

  if (mapRow?.booking_id && proposedStartsAt && proposedEndsAt) {
    const { rows: [booking] } = await run(tx, db
      .selectFrom("keystone.booking")
      .select(["state"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", mapRow.booking_id));
    if (booking && OPEN_BOOKING_STATES.has(booking.state)) {
      const detail = {
        proposed_starts_at: new Date(proposedStartsAt).toISOString(),
        proposed_ends_at: new Date(proposedEndsAt).toISOString(),
      };
      await run(tx, db
        .updateTable("keystone.calendar_event_map")
        .set({ remote_change_pending: true, remote_change_detail: JSON.stringify(detail) ?? null })
        .where("id", "=", mapRow.id));
      // ★ §5 — subjectType 'booking', not 'calendar_connection': the fact is about THIS booking's
      //   own scheduled time, read on its own History tab (spec 03a §5's own walkthrough).
      await emit(tx, {
        tenantId, topic: "calendar.remote_change.flagged", emittedBy: "calendar",
        subjectType: "booking", subjectId: mapRow.booking_id,
        actor: userActor(null),
        payload: { connectionId, externalEventId, ...detail },
      });
      return { applied: true, flagged: true };
    }
  }

  return { applied: true };
}

/**
 * ★ §B3.1: "Handle 410 Gone on an expired sync token by doing a full resync and taking a fresh
 * token." A dead token is not an error to retry — retrying it returns 410 forever.
 */
export async function handleSyncTokenGone(tx, connectionId) {
  await run(tx, db
    .updateTable("keystone.calendar_connection")
    .set({ sync_token: null, status: "needs_full_resync" })
    .where("id", "=", connectionId));
  return { fullResyncRequired: true };
}

/** Record that the polling sweep ran. ★ "When did the backstop last actually run?" must be answerable. */
export async function recordSweep(tx, connectionId, { now = new Date() } = {}) {
  await run(tx, db
    .updateTable("keystone.calendar_connection")
    .set({ last_swept_at: now })
    .where("id", "=", connectionId));
}

/**
 * ★★★ THE HEALTH ANSWER. Returns a list of problems, each naming a connection.
 * ★ A sweep that has not run is ALSO a failure — the backstop silently not running is the same
 * shape of defect as the webhook silently not firing, and it is the one people forget.
 */
export async function calendarHealth(tx, { now = new Date(), sweepMaxAgeMs = 6 * 3600_000 } = {}) {
  const problems = [];

  for (const c of await findSilentlyBrokenConnections(tx, { now })) {
    problems.push({ connectionId: c.id, kind: 'expired_but_active',
      detail: `channel expired ${c.channel_expires_at.toISOString()} but status is still 'active' — ` +
              `change events are being missed RIGHT NOW and nothing has said so` });
  }

  const { rows: failed } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id", "last_error"])
    .where("status", "=", "renewal_failed"));
  for (const c of failed) {
    problems.push({ connectionId: c.id, kind: 'renewal_failed', detail: c.last_error });
  }

  const { rows: stale } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id", "last_swept_at"])
    .where("status", "=", "active")
    .where((eb) => eb.or([
      eb("last_swept_at", "is", null),
      eb("last_swept_at", "<", new Date(now.getTime() - sweepMaxAgeMs)),
    ])));
  for (const c of stale) {
    problems.push({ connectionId: c.id, kind: 'sweep_overdue',
      detail: `the polling SAFETY NET has not run since ${c.last_swept_at?.toISOString() ?? 'ever'}` });
  }

  return { healthy: problems.length === 0, problems };
}

/**
 * ★★★ THE PLATFORM-WIDE ANSWER — Stage 4 Task 11 / 07 §5. `calendarHealth()` above runs inside
 * WHATEVER tenant context its caller has, because `keystone.calendar_connection` is FORCE RLS: the
 * `/platform/health` route used to call it directly and see only the CALLING session's own tenant's
 * connections, which for the platform tenant itself is a small, misleading slice of the truth for a
 * screen whose whole point is to watch every practice.
 * ★★ So this reads `keystone_meta.calendar_health()` (migration 0152) instead — a SECURITY DEFINER
 *    function owned by `auth_owner` with its own explicit read policy, the same shape
 *    `outbox_health()`/`email_health()` use, cross-tenant and worker-safe (works identically from
 *    `app_worker`, with no tenant context at all, and from `app_rw` inside any tenant's request).
 * ★ Deliberately an AGGREGATE, not the per-connection list `calendarHealth()` returns: a
 *   platform-wide function that returned every practice's connection ids and host ids would be a
 *   wider leak than a health dashboard needs to carry (0007/0008's "too narrow to carry a leak").
 */
export async function platformCalendarHealth(db) {
  const { rows: [r] } = await db.query("SELECT * FROM keystone_meta.calendar_health()");
  if (r.total === 0) {
    return { state: "unknown", total: 0,
      detail: "No calendar connections exist yet, so there is nothing to verify." };
  }
  const problems = [];
  if (r.expired_active > 0) {
    problems.push(`${r.expired_active} connection(s) expired but still marked active — change events are being missed right now`);
  }
  if (r.renewal_failed > 0) {
    problems.push(`${r.renewal_failed} connection(s) with a failed renewal`);
  }
  if (r.sweep_overdue > 0) {
    problems.push(`${r.sweep_overdue} connection(s) whose polling safety net has not run in the last 6 hours`);
  }
  if (problems.length === 0) {
    return { state: "ok", total: r.total, detail: `${r.total} connection(s) across every practice, none silently broken.` };
  }
  return { state: "problem", total: r.total,
    detail: `${problems.length} problem(s) across ${r.total} connection(s): ${problems.join("; ")}.` };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 3a.6 (spec 03a §2/§5, F686) — THE REMOTE-CHANGES CONFLICT QUEUE.
//
//     §2's three routes (`GET …/calendar/remote-changes`, `POST …/remote-changes/accept`,
//     `POST …/remote-changes/reject`) had ZERO callers anywhere in `src/` before this task (MEASURED,
//     `grep -rn "remote-changes|remoteChanges" src/` returned nothing) — task 3a.4 built the FLAGGING
//     half (`applyRemoteEvent`'s extension, above) with no way for a person to ever resolve what it
//     flags. These three functions are the review/resolve half; `src/routes/calendar.mjs` calls them.
//
// ★★ RESOLUTION SEMANTICS, READ FROM `applyRemoteEvent` ITSELF, NOT GUESSED:
//    "Accept" means the OUTSIDE calendar's proposed time wins — the booking is moved to match it
//    (`rescheduleBooking`, §2's own row: "internally calls rescheduleBooking, then clears
//    remote_change_pending"). "Reject" means PLATFORM'S time wins — nothing about the booking moves,
//    only the flag clears.
//
// ★ NO NEW `flaggedAt` COLUMN EXISTS (0288 has no such column, and this task adds no migration —
//   "none should be needed" is its own instruction). `last_seen_at` is used instead: `applyRemoteEvent`
//   upserts `last_seen_at` in the SAME statement that sets `remote_change_pending`/`remote_change_detail`
//   (above, this file), so for any row CURRENTLY pending, `last_seen_at` IS the moment it was flagged —
//   a measured substitution, not an invented one, disclosed here and in this task's own build report.
//
// ★★ REJECT AND "NOT A HOPE" (§2's own row: "the NEXT push cycle re-asserts the platform's time onto the
//    outside event — an explicit corrective write, not a hope"). `PUSH_TO_CALENDAR` (task 3a.6's OTHER
//    half, `src/queue/tasks.mjs`) is event-triggered, not periodic, and `pushBookingRescheduled`
//    (`calendarPush.mjs`, task 3a.3, out of this task's Files field) no-ops when
//    `last_pushed_state === desiredState` — and a reject changes NOTHING about the booking's own row, so
//    that idempotency marker would still read "already sent" and silently swallow the correction on the
//    very next legitimate push trigger. Clearing `last_pushed_state` on the SAME row this task already
//    writes (`calendar_event_map`, alongside `remote_change_pending`/`detail`) is the smallest change
//    that makes the NEXT push a real one rather than a silently-skipped one, without editing
//    `calendarPush.mjs` itself (outside this task's Files field) or fabricating a false
//    `booking.booking.rescheduled` event (nothing actually moved). This route does NOT itself force an
//    immediate push — routes never enqueue a graphile job directly in this codebase (every outbound
//    effect is queued from the event-listener dispatcher, P8.5) — so the correction lands on whichever
//    real booking event next touches this booking, not instantly. Disclosed here and in this task's own
//    build report as a measured, minimal-footprint judgment call, not a silent shortcut.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** §2 — `GET …/calendar/remote-changes`. This coach's own flagged bookings (Owner/Admin may pass a
 *  DIFFERENT coach's `hostId`, scoped by the caller — §2's own row, same shape `CalendarBusy` uses). */
export async function listRemoteChanges(tx, { tenantId, hostId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.calendar_event_map as m")
    .innerJoin("keystone.calendar_connection as c", "c.id", "m.connection_id")
    .select(["m.booking_id", "m.external_event_id", "c.provider", "m.remote_change_detail", "m.last_seen_at"])
    .where("m.tenant_id", "=", tenantId)
    .where("c.host_id", "=", hostId)
    .where("m.remote_change_pending", "=", true)
    .orderBy("m.last_seen_at", "asc"));
  return rows.map((r) => ({
    bookingId: r.booking_id,
    externalEventId: r.external_event_id,
    provider: r.provider,
    proposedStartsAt: r.remote_change_detail?.proposed_starts_at ?? null,
    proposedEndsAt: r.remote_change_detail?.proposed_ends_at ?? null,
    flaggedAt: r.last_seen_at,
  }));
}

/** ★ Shared by accept/reject — the flagged row, and a scoped check that THIS caller may act on the
 *  booking it names (RECORD_QUERIES.booking's own `verb: 'edit'` read, `reschedule.mjs`'s established
 *  idiom — never a second, hand-copied predicate). */
async function ownedPendingChange(tx, { tenantId, bookingId, externalEventId, viewerId }) {
  const seen = await tx.query(RECORD_QUERIES.booking.sqlFor('edit'), [bookingId, viewerId]);
  if (seen.rows.length === 0) throw notFound("That booking does not exist, or you cannot see it.");
  const { rows: [row] } = await run(tx, db
    .selectFrom("keystone.calendar_event_map")
    .select(["id", "connection_id", "remote_change_pending", "remote_change_detail"])
    .where("tenant_id", "=", tenantId)
    .where("booking_id", "=", bookingId)
    .where("external_event_id", "=", externalEventId));
  if (!row || !row.remote_change_pending) {
    throw notFound("There is no pending remote change for that booking.");
  }
  return row;
}

/** §2 — `POST …/calendar/remote-changes/accept`. The OUTSIDE calendar's proposed time wins. */
export async function acceptRemoteChange(tx, { tenantId, bookingId, externalEventId, actorUserId = null }) {
  const row = await ownedPendingChange(tx, { tenantId, bookingId, externalEventId, viewerId: actorUserId });
  const detail = row.remote_change_detail ?? {};
  const moved = await rescheduleBooking(tx, {
    tenantId, bookingId, actorUserId,
    startsAt: detail.proposed_starts_at, endsAt: detail.proposed_ends_at,
  });
  await run(tx, db
    .updateTable("keystone.calendar_event_map")
    .set({ remote_change_pending: false, remote_change_detail: null })
    .where("id", "=", row.id));
  return { id: moved.id, starts_at: moved.starts_at, ends_at: moved.ends_at, rescheduled: moved.rescheduled };
}

/** §2 — `POST …/calendar/remote-changes/reject`. PLATFORM's own time wins; nothing about the booking
 *  moves — see this section's header note on `last_pushed_state`. */
export async function rejectRemoteChange(tx, { tenantId, bookingId, externalEventId, actorUserId = null }) {
  const row = await ownedPendingChange(tx, { tenantId, bookingId, externalEventId, viewerId: actorUserId });
  await run(tx, db
    .updateTable("keystone.calendar_event_map")
    .set({ remote_change_pending: false, remote_change_detail: null, last_pushed_state: null })
    .where("id", "=", row.id));
  return { accepted: false };
}
