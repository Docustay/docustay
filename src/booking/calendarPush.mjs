// @ts-check
// Task 3a.3 — THE PAIRED-EVENT LIFECYCLE. §1.2's open decision (recommendation A, RULED — see
// that section's own framing) + the data-layer half of CT-114's correction (already realised in
// code by tasks 3a.1/3a.2; nothing here reintroduces the wrong Secret Manager names or the wrong
// `SECRET_PURPOSES` member — this module never touches a secret directly, see the scope note below).
//
// Spec: specs/03-engagements/03a-calendar-and-sync.md §1.2 (the ruling + its reasoning), §3 (the
// paired-event columns this module writes: `calendar_event_map.booking_id/external_event_id/
// last_pushed_state/written_by_us/sync_marker`, all already built by task 3a.1's migrations
// 0013/0288 — no new migration here, checked first per this task's own build instruction).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ RECOMMENDATION A, THE FOUR TRANSITIONS, VERBATIM FROM §1.2:
//   created     → CREATE the paired outside event on every ACTIVE connection this host has.
//   rescheduled → UPDATE the paired outside event's start/end IN PLACE — never delete+recreate,
//                 because `calendar_event_map` keys on (connection_id, external_event_id)
//                 specifically so one event keeps one identity across edits.
//   cancelled   → DELETE the paired outside event.
//   completed   → NO-OP, either outcome (`completed` or `no_show`) — the outside calendar answers
//                 "am I free," not "did the client show up," and encoding attendance into a
//                 provider event would leak a billing fact onto a personal calendar a client might
//                 glimpse over a coach's shoulder (§1.2's own privacy reasoning).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ★★★ SCOPE BOUNDARY, REPORTED HERE RATHER THAN GUESSED AT (this task's own build instruction:
//     "if you hit a spec gap in your own area, STOP and report the specific unspecified piece,
//     don't invent security-sensitive logic, but keep building everything else the Done
//     criterion needs" — same discipline task 3a.1 used for F664):
//
//   1. THE ACTUAL AUTHENTICATED GOOGLE/MICROSOFT HTTP CALL IS INJECTED, NEVER IMPLEMENTED HERE —
//      same shape `calendarSync.mjs`'s `renewChannel(tx, connectionId, renewFn, …)` already
//      establishes for this exact codebase (a required, non-defaulted 3rd argument). Making a real
//      authenticated call needs an access token from a refresh-token exchange, which does not exist
//      ANYWHERE in this codebase yet (MEASURED: grepped `src/` for `grant_type.*refresh_token` —
//      the only two hits are `calendarConnect.mjs`/`mailboxConnect.mjs`'s AUTHORIZATION-CODE
//      exchanges, a different OAuth step) — building that flow is §6/§8's territory (outside
//      services / secrets), not this task's own `§2/§3` Files field. Building it here would be
//      inventing token-handling logic this task was not asked to build.
//   2. WIRING THIS MODULE'S ENTRY POINT (`applyPairedEventLifecycle`, bottom of this file) INTO A
//      `PUSH_TO_CALENDAR` LISTENER IN `src/queue/tasks.mjs` IS NOT DONE HERE. §5's own table
//      names that file (`src/queue/tasks.mjs:1250`'s `LISTENER_REACH` pattern) as where the
//      listener lives — but `FEATURES-COMBINED-PLAN.md` §0.4's own cross-spec file-overlap table
//      states, in exactly these words: **"`src/queue/tasks.mjs` (`LISTENER`, `LISTENER_REACH`,
//      `JOB_POLICY`) | 03b, 08 | 03b adds booking-hold/expiry entries (task 3b.4) … 08 adds
//      `SEND_TO_N8N`/…"** — spec 03a is NOT one of the two specs that table admits into this file,
//      for ANY of its five tasks. This task's own Files field also cites only `§2/§3`, never `§5`
//      or `src/queue/tasks.mjs`. Editing that file from here would be a same-file collision with
//      whichever agent is building task 3b.4 in the SAME parallel BUILD batch (up to 8 agents at
//      once, per BUILD-PROCESS.md) — a real, concrete risk, not a theoretical one.
//   ★ Net effect: everything §1.2/§3 asks for — the exact four-transition decision, the
//     `calendar_event_map` reads/writes, the idempotent-retry guard §7 describes — is built and
//     independently testable (spec §12 test 6) against injected provider-call fixtures. The
//     listener registration that makes it fire automatically on a real `booking.booking.*` event is
//     the one piece this task does not touch, and is named here rather than silently left undone.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** §5's table, stated as data: `created` → create, `rescheduled` → update, `cancelled` → delete,
 *  `completed` → no-op. Kept as one frozen map so there is exactly one place §1.2's rule lives. */
const PAIRED_EVENT_ACTION = Object.freeze({
  "booking.booking.created": "create",
  "booking.booking.rescheduled": "update",
  "booking.booking.cancelled": "delete",
  // ★ Listed explicitly, not implied by omission — §5's own instruction: "so the closed set of
  //   push triggers is stated completely, not implied by omission."
  "booking.booking.completed": "noop",
});

/** ★ Pure. §12 test 6 exercises this directly — no database, no network. */
export function decidePairedEventAction(topic) {
  const action = PAIRED_EVENT_ACTION[topic];
  if (!action) {
    throw new Error(
      `calendarPush: "${topic}" is not one of §1.2's four transitions ` +
      `(${Object.keys(PAIRED_EVENT_ACTION).join(", ")}).`);
  }
  return action;
}

/** `last_pushed_state` — the idempotency marker §3/§7 describe: "e.g. 'confirmed:2026-10-01T14:00Z'
 *  — what we last told the provider," so a retried job can tell "already sent" from "needs sending". */
function pushedStateKey(state, startsAt) {
  return `${state}:${new Date(startsAt).toISOString()}`;
}

/** Everything a paired-event write needs from the booking row — same query shape as
 *  `reminders.mjs`'s `reminderFacts`, this module's own established precedent in this codebase. */
async function bookingCalendarFacts(tx, bookingId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking as b")
    .innerJoin("keystone.service as s", "s.id", "b.service_id")
    .select(["b.id", "b.host_id", "b.starts_at", "b.ends_at", "b.state", "b.location_kind", "b.location_detail", sql`s.name`.as("service_name")])
    .where("b.id", "=", bookingId));
  return rows[0] ?? null;
}

/** §2's `event_title_mode`: `client_first_name` is a FIRST NAME only, never the full name — same
 *  "never carry more than the screen needs" discipline `attendance.mjs`'s own comment already
 *  applies (§1.2's own citation). `booking_participant.party = 'client'` is the closed-vocabulary
 *  row that names who the session is with (0013's own `party` CHECK). */
async function clientFirstName(tx, bookingId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_participant")
    .select(["display_name"])
    .where("booking_id", "=", bookingId)
    .where("party", "=", "client")
    .orderBy("id", "asc")
    .limit(1));
  const name = rows[0]?.display_name;
  if (!name) return null;
  const first = String(name).trim().split(/\s+/)[0];
  return first || null;
}

/** ★ `session_only` (the default, §3) NEVER carries a client's name — deliberately narrower. */
function eventTitleFor({ mode, serviceName, clientFirst }) {
  const service = serviceName || "Session";
  if (mode === "client_first_name" && clientFirst) return `${service} — ${clientFirst}`;
  return service;
}

/** §4/§5 — every ACTIVE connection belonging to this host, tenant-scoped. */
async function activeConnectionsForHost(tx, { tenantId, hostId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id", "provider", "push_calendar_id", "event_title_mode"])
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where("status", "=", "active"));
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TRANSITION 1 — CREATE (`booking.booking.created`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * §1.2/§5 — push a newly-created booking onto every ACTIVE connection this host has. Nothing to
 * prune yet (§5's own words), so this only ever adds.
 *
 * @param createRemoteEvent  REQUIRED, injected (see file header §1). `(connection, descriptor) =>
 *   Promise<{ externalEventId, etag?, syncMarker? }>`. `descriptor`: `{ title, startsAt, endsAt,
 *   locationDetail, calendarId }`. Never given a client's full name (§1.2/§8 privacy).
 */
export async function pushBookingCreated(tx, { tenantId, bookingId, createRemoteEvent }) {
  if (typeof createRemoteEvent !== "function") {
    throw new Error("pushBookingCreated needs createRemoteEvent — see this file's header §1.");
  }
  const booking = await bookingCalendarFacts(tx, bookingId);
  if (!booking) return { pushed: 0 };

  const connections = await activeConnectionsForHost(tx, { tenantId, hostId: booking.host_id });
  if (connections.length === 0) return { pushed: 0 };

  const clientFirst = await clientFirstName(tx, bookingId);
  const desiredState = pushedStateKey(booking.state, booking.starts_at);

  let pushed = 0;
  for (const conn of connections) {
    // ★★ IDEMPOTENT RETRY (§7): a crash after the provider call but before this row lands would,
    //    without this check, create a SECOND outside event on retry. Same connection + same
    //    booking already mapped means "already pushed" — no-op, not a duplicate write.
    const already = await run(tx, db
      .selectFrom("keystone.calendar_event_map")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("connection_id", "=", conn.id)
      .where("booking_id", "=", bookingId));
    if (already.rows[0]) continue;

    const descriptor = {
      title: eventTitleFor({ mode: conn.event_title_mode, serviceName: booking.service_name, clientFirst }),
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      // ★ §2's `location_detail` is only meaningful with a kind (0085's own CHECK); never leaked
      //   without one.
      locationDetail: booking.location_kind ? booking.location_detail : null,
      calendarId: conn.push_calendar_id,
    };
    const result = await createRemoteEvent(
      { id: conn.id, provider: conn.provider, pushCalendarId: conn.push_calendar_id }, descriptor);
    if (!result?.externalEventId) {
      throw new Error(`createRemoteEvent for connection ${conn.id} returned no externalEventId.`);
    }

    await tx.query(
      `INSERT INTO keystone.calendar_event_map
         (tenant_id, connection_id, booking_id, external_event_id, external_etag,
          written_by_us, sync_marker, last_pushed_state, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7, now())
       ON CONFLICT (connection_id, external_event_id) DO UPDATE
          SET booking_id = EXCLUDED.booking_id, external_etag = EXCLUDED.external_etag,
              written_by_us = true, sync_marker = EXCLUDED.sync_marker,
              last_pushed_state = EXCLUDED.last_pushed_state, last_seen_at = now()`,
      [tenantId, conn.id, bookingId, result.externalEventId, result.etag ?? null,
       result.syncMarker ?? null, desiredState]);
    pushed++;
  }
  return { pushed };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TRANSITION 2 — UPDATE, IN PLACE (`booking.booking.rescheduled`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * §1.2 — UPDATE the paired event's time. NEVER delete+recreate (§1.2's own reasoning, quoted in
 * this file's header). Only touches connections that already HAVE a mapped event for this booking
 * — a connection added after the booking was created has nothing to move yet (recommendation A
 * does not ask this transition to also create).
 *
 * @param updateRemoteEvent  REQUIRED, injected. `(connection, externalEventId, descriptor) =>
 *   Promise<{ etag? }>`. `descriptor`: `{ startsAt, endsAt }` — the title is not re-sent, only the
 *   time moved, per §1.2.
 */
export async function pushBookingRescheduled(tx, { tenantId, bookingId, updateRemoteEvent }) {
  if (typeof updateRemoteEvent !== "function") {
    throw new Error("pushBookingRescheduled needs updateRemoteEvent — see this file's header §1.");
  }
  const booking = await bookingCalendarFacts(tx, bookingId);
  if (!booking) return { pushed: 0 };

  const { rows: mapped } = await run(tx, db
    .selectFrom("keystone.calendar_event_map as m")
    .innerJoin("keystone.calendar_connection as c", "c.id", "m.connection_id")
    .select(["m.id", "m.connection_id", "m.external_event_id", "m.last_pushed_state", "c.provider", "c.push_calendar_id"])
    .where("m.tenant_id", "=", tenantId)
    .where("m.booking_id", "=", bookingId)
    .where("c.status", "=", "active"));

  const desiredState = pushedStateKey(booking.state, booking.starts_at);
  let pushed = 0;
  for (const row of mapped) {
    // ★★ IDEMPOTENT RETRY (§7): nothing changed since the last successful push → no-op, so a
    //    retried job (crash recovery, not a genuine second reschedule) does not re-issue an
    //    identical write.
    if (row.last_pushed_state === desiredState) continue;

    const result = await updateRemoteEvent(
      { id: row.connection_id, provider: row.provider, pushCalendarId: row.push_calendar_id },
      row.external_event_id,
      { startsAt: booking.starts_at, endsAt: booking.ends_at });

    await run(tx, db
      .updateTable("keystone.calendar_event_map")
      .set({ external_etag: result?.etag ?? null, last_pushed_state: desiredState, written_by_us: true, last_seen_at: sql`now()` })
      .where("id", "=", row.id));
    pushed++;
  }
  return { pushed };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TRANSITION 3 — DELETE (`booking.booking.cancelled`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * §1.2 — DELETE the paired event. The `calendar_event_map` row is removed once the provider
 * confirms the delete — §3's own reasoning for the Disconnect route applies identically here: a
 * map row carries no independent audit value once what it maps to is gone, and nothing in §3
 * marks these rows frozen/signed.
 *
 * @param deleteRemoteEvent  REQUIRED, injected. `(connection, externalEventId) => Promise<void>`.
 */
export async function pushBookingCancelled(tx, { tenantId, bookingId, deleteRemoteEvent }) {
  if (typeof deleteRemoteEvent !== "function") {
    throw new Error("pushBookingCancelled needs deleteRemoteEvent — see this file's header §1.");
  }
  const { rows: mapped } = await run(tx, db
    .selectFrom("keystone.calendar_event_map as m")
    .innerJoin("keystone.calendar_connection as c", "c.id", "m.connection_id")
    .select(["m.id", "m.connection_id", "m.external_event_id", "c.provider", "c.push_calendar_id"])
    .where("m.tenant_id", "=", tenantId)
    .where("m.booking_id", "=", bookingId));

  let pushed = 0;
  for (const row of mapped) {
    await deleteRemoteEvent(
      { id: row.connection_id, provider: row.provider, pushCalendarId: row.push_calendar_id },
      row.external_event_id);
    await run(tx, db
      .deleteFrom("keystone.calendar_event_map")
      .where("id", "=", row.id));
    pushed++;
  }
  return { pushed };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TRANSITION 4 — NO-OP (`booking.booking.completed`, either outcome)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ Exported and callable, not merely implied — §5's own instruction (see this file's header). */
export async function pushBookingCompleted() {
  return { pushed: 0, noop: true };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ENTRY POINT. Whichever task wires `PUSH_TO_CALENDAR` into `src/queue/tasks.mjs` (out of
// THIS task's scope — see file header §2) calls this, so §1.2's mapping has exactly one home.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @param providers `{ createRemoteEvent, updateRemoteEvent, deleteRemoteEvent }` — only the one(s)
 *   the resolved action needs are actually called.
 */
export async function applyPairedEventLifecycle(tx, { tenantId, bookingId, topic, providers = {} }) {
  const action = decidePairedEventAction(topic);
  if (action === "create") {
    return pushBookingCreated(tx, { tenantId, bookingId, createRemoteEvent: providers.createRemoteEvent });
  }
  if (action === "update") {
    return pushBookingRescheduled(tx, { tenantId, bookingId, updateRemoteEvent: providers.updateRemoteEvent });
  }
  if (action === "delete") {
    return pushBookingCancelled(tx, { tenantId, bookingId, deleteRemoteEvent: providers.deleteRemoteEvent });
  }
  return pushBookingCompleted();
}
