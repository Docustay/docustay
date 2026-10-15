// @ts-check
// STAGE 13 TASK 13.12 — THE WAITLIST ENGINE. One module for the waitlist writes and the offer
// engine: `reschedule.mjs`'s staff cancel branch and its `offerToWaitlist` wrapper are the
// application callers (this task); routes (13.13) and the claim endpoints (`peekOffer` /
// `claimOffer` / `declineOffer`, appended by 13.14) call this module too, and the job side (13.15)
// reads `offer_expires_at` to advance an unclaimed offer. This file owns everything EXCEPT the
// claim functions, which 13.14 appends.
//
// ★★★ AN OFFER IS A PROMISE WITH A CLOCK ON IT, AND IT MUST NOT BE MADE TWICE FOR THE SAME SLOT.
//     `offerFreedSlot` locks every `status='waiting'` row for the (tenant, service, booking_id)
//     scope with `SELECT ... FOR UPDATE` BEFORE it decides who matches. Two concurrent calls for
//     the same scope (two near-simultaneous cancellations) serialise on that lock: the second call
//     blocks until the first COMMITS, and Postgres then re-checks `status = 'waiting'` against the
//     now-current row before returning it — an entry the first call already flipped to `offered`
//     is silently excluded from the second call's candidate set. A plain SELECT-then-UPDATE (the
//     code this replaces) does not have this property: two overlapping transactions could both read
//     the same entry as `waiting` and both emit an offer for it, with only the last UPDATE's slot
//     surviving in the row while an already-sent notification named the other one.
//
// ★★ THE OFFER WINDOW COMES FROM THE SETTING, NEVER HARDCODED. `booking.waitlist_offer_minutes`
//     (13.8, `src/settings/keys.mjs:354`, "reader: task 13.12") is read via `getSetting` on every
//     offer; there is no second window mechanism here.
//
// ★★ WHO IS OFFERED FIRST: NOBODY IS — A FREED SLOT IS BROADCAST TO EVERY MATCHING WAITING ENTRY
//     AT ONCE, not sequenced by position. The plan's own "done" line makes this explicit: cancelling
//     one 4:30 with two evening-waiters and one morning-waiter offers the TWO evening-waiters
//     TOGETHER, not the higher-position one first. `position` orders the queue for staff's own
//     screen (13.13) and is still the tie-break used to pick which candidates are locked first, but
//     it does not gate who receives an offer from a single freed slot — the section names no such
//     gate, so none is invented here.
//
// ★★ SETTINGS ARE ENFORCED SERVER-SIDE; N8N REACTS. `booking.online_enabled` is checked on THIS
//     route-adjacent function, not left to a workflow: an n8n outage must never let someone be
//     offered a slot while online booking is switched off for the practice.
//
// ★ TIME: `startsAt` is the real UTC instant already stored on the booking; `preferenceMatches`
//   reads it back through the practice's own IANA zone (`keystone.tenant.timezone`) via
//   `wallClockIn`/`dayOfWeekIn` (`./slots.mjs`), never a bare UTC hour — that is what keeps
//   "evenings"/"mornings"/"weekends" correct on both sides of a DST transition.

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { emit, userActor } from "../events/outbox.mjs";
import { notFound, invalid } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
import { createPerson } from "../people/writes.mjs";
import { wallClockIn, dayOfWeekIn } from "./slots.mjs";
// ★★★ 13.14 — the claim functions book through the SAME anonymous-admission door the ordinary
//   public booking page uses (`createPublicBooking`, the 0317 RLS path), never `createBooking`:
//   `createBooking`'s `user_may(actor,...)` guard is unconditionally false for a null actor
//   (publicBooking.mjs:20-31), and a claim link presenter has no session and no actor by design.
import { createPublicBooking, PUBLIC_BOOKING_REFUSED } from "./publicBooking.mjs";
import { SlotTakenError } from "./createBooking.mjs";
import { revokeLinkToken } from "../auth/linkToken.mjs";

const SECTION = "booking";

/** The closed preference vocabulary (0398's CHECK, mirrored here for callers that render it). */
export const PREFERENCES = Object.freeze(["evenings", "mornings", "weekends", "flexible", "specific"]);

/**
 * ★ Does this waiting entry match a slot that starts at `startsAt` for `hostId`, read in the
 *   practice's own `timeZone`? Pure — no I/O, so the offer engine's SELECT-then-filter can call it
 *   per candidate without a query per candidate.
 *
 * For EVERY preference kind: a non-null `entry.host_id` must equal `hostId` — a person who asked
 * for a specific coach is never matched to someone else's freed slot.
 */
export function preferenceMatches(entry, { startsAt, hostId, timeZone }) {
  if (entry.host_id != null && entry.host_id !== hostId) return false;

  const day = dayOfWeekIn(startsAt, timeZone);
  switch (entry.preference) {
    case "evenings": {
      const w = wallClockIn(startsAt, timeZone);
      return w.hour * 60 + w.minute >= 17 * 60;
    }
    case "mornings": {
      const w = wallClockIn(startsAt, timeZone);
      return w.hour * 60 + w.minute < 12 * 60;
    }
    case "weekends":
      return day === 0 || day === 6;
    case "flexible":
      return true;
    case "specific":
      // ★ Restated per the section's own text: the host check above already covers this; the days
      //   check is the part specific to this kind.
      if (entry.host_id != null && entry.host_id !== hostId) return false;
      if (entry.preference_days != null && !entry.preference_days.includes(day)) return false;
      return true;
    default:
      return false;
  }
}

/**
 * Add someone to the waitlist queue. When `personId` is null, the lead is found by lower(email) in
 * this tenant, or created (same `createPerson` call `publicBooking.mjs:429-432` makes) — every
 * entry ends up with a `client_user_id`, never a bare name/email pair with nothing behind it.
 *
 * `position` is `coalesce(max(position),0)+1` for (tenant, service), taken under an advisory lock
 * keyed the same way every other booking-side serialisation point in this codebase is
 * (`createBooking.mjs`, `publicBooking.mjs`, `reschedule.mjs`) — a string param to
 * `hashtextextended`, never SQL-side concatenation.
 */
export async function addToWaitlist(tx, {
  tenantId, serviceId, hostId = null, bookingId = null, personId = null,
  displayName, email, phone = null, preference = "flexible", preferenceNote = null,
  preferenceDays = null, kind = "coach_request", actorUserId = null,
}) {
  let clientUserId = personId;
  if (clientUserId == null) {
    const normEmail = String(email).trim().toLowerCase();
    const { rows: existing } = await tx.query(
      `SELECT id FROM keystone.app_user WHERE tenant_id = $1 AND lower(email) = $2`,
      [tenantId, normEmail]);
    if (existing.length > 0) {
      clientUserId = existing[0].id;
    } else {
      // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON —
      //   createPerson (src/people/writes.mjs) now enforces this unconditionally. Only reachable
      //   HERE, when this entry is for a genuinely new person (no existing match, no personId
      //   passed in) — selecting an EXISTING person from search never needs a phone typed in this
      //   sheet at all. `phone` used to be collected on the waitlist_entry row only (below), never
      //   passed to createPerson, which is why no staff UI ever asked for it at this point.
      if (!phone || !String(phone).trim()) {
        throw invalid("A phone number is required to add a new person.", { field: "phone" });
      }
      const person = await createPerson(tx, {
        tenantId, email: normEmail, displayName, mobilePhone: String(phone).trim(),
        role: "adult_client", staffRole: null, invite: false, actorUserId,
      });
      clientUserId = person.id;
    }
  }

  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [`waitlist:${tenantId}:${serviceId}`]);
  const { rows: [{ next_position }] } = await tx.query(
    `SELECT coalesce(max(position), 0) + 1 AS next_position
       FROM keystone.booking_waitlist_entry
      WHERE tenant_id = $1 AND service_id = $2`,
    [tenantId, serviceId]);

  const { rows: [row] } = await run(tx, db
    .insertInto("keystone.booking_waitlist_entry")
    .values({
      tenant_id: tenantId ?? null,
      kind: kind ?? null,
      service_id: serviceId ?? null,
      host_id: hostId ?? null,
      booking_id: bookingId ?? null,
      client_user_id: clientUserId ?? null,
      display_name: displayName ?? null,
      email: email ?? null,
      phone: phone ?? null,
      position: next_position ?? null,
      preference: preference ?? null,
      preference_note: preferenceNote ?? null,
      preference_days: preferenceDays ?? null,
    })
    .returningAll());
  return row;
}

/**
 * A client-expressed demand row (kind='demand', F15 §2.3) — "I'd take evenings with anyone" rather
 * than a named coach_request. `display_name`/`email` are read from the client's own `app_user` row,
 * never re-typed by the caller.
 */
export async function recordDemand(tx, { tenantId, clientUserId, serviceId, hostId = null, preference, preferenceNote = null }) {
  const { rows: [person] } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["display_name", "email"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", clientUserId));
  if (!person) throw notFound("That client does not exist in this practice.");

  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [`waitlist:${tenantId}:${serviceId}`]);
  const { rows: [{ next_position }] } = await tx.query(
    `SELECT coalesce(max(position), 0) + 1 AS next_position
       FROM keystone.booking_waitlist_entry
      WHERE tenant_id = $1 AND service_id = $2`,
    [tenantId, serviceId]);

  const { rows: [row] } = await run(tx, db
    .insertInto("keystone.booking_waitlist_entry")
    .values({
      tenant_id: tenantId ?? null,
      kind: "demand",
      service_id: serviceId ?? null,
      host_id: hostId ?? null,
      client_user_id: clientUserId ?? null,
      display_name: person.display_name ?? null,
      email: person.email ?? null,
      position: next_position ?? null,
      preference: preference ?? null,
      preference_note: preferenceNote ?? null,
    })
    .returningAll());
  return row;
}

/** Transition an entry to `removed` — only from `waiting`/`offered` (never deleted, 0314's rule). */
export async function removeFromWaitlist(tx, { tenantId, entryId }) {
  const { rows: [row] } = await run(tx, db
    .updateTable("keystone.booking_waitlist_entry")
    .set({ status: "removed", updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", entryId)
    .where("status", "in", ["waiting", "offered"])
    .returningAll());
  return row ?? null;
}

/**
 * ★★★ THE OFFER ENGINE. Called by `reschedule.mjs`'s `offerToWaitlist` (the staff cancel branch,
 * and the two existing client-path call sites at reschedule.mjs:146,345) whenever a slot frees up.
 *
 * `bookingId` scopes to a specific occurrence (a freed class seat); left null (the default), it
 * scopes to entries with no occurrence pinned (a freed 1:1 slot) — `booking_id IS NOT DISTINCT
 * FROM $bookingId` reads correctly either way.
 */
export async function offerFreedSlot(tx, { tenantId, serviceId, hostId, startsAt, endsAt, bookingId = null }) {
  const onlineEnabled = await getSetting(tx, "booking.online_enabled", true);
  if (onlineEnabled === false) {
    // ★ Turn-off modal: "They can't be offered a slot while this is off."
    return { told: 0 };
  }

  const { rows: [tenantRow] } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select(["timezone"])
    .where("id", "=", tenantId));
  const timeZone = tenantRow?.timezone ?? "UTC";

  // ★★★ SELECT ... FOR UPDATE — see the file header. This locks every candidate row for this
  //     (tenant, service, booking_id) scope before any decision is made, so a concurrent freed-slot
  //     call for the same scope serialises here rather than racing past this point.
  const { rows: candidates } = await tx.query(
    `SELECT id, client_user_id, display_name, email, phone, host_id, preference, preference_days
       FROM keystone.booking_waitlist_entry
      WHERE tenant_id = $1 AND service_id = $2 AND status = 'waiting'
        AND booking_id IS NOT DISTINCT FROM $3
      ORDER BY position ASC
      FOR UPDATE`,
    [tenantId, serviceId, bookingId]);

  const matched = candidates.filter((entry) => preferenceMatches(entry, { startsAt, hostId, timeZone }));
  if (matched.length === 0) return { told: 0 };

  const offerMinutes = await getSetting(tx, "booking.waitlist_offer_minutes", 60);
  const ids = matched.map((e) => e.id);

  // ★★★ `offered_host_id` — THE OFFERED HOST IS PERSISTED, NOT ONLY ANNOUNCED (migration 0405).
  //     Found 25 Sep 2026 by the task standing at the other end of this wire. Before this column
  //     the offer put `host_id` in the EVENT payload (below) and NOWHERE ELSE, so a FLEXIBLE-
  //     preference entry — one whose `host_id` is NULL precisely because the person did not ask for
  //     a particular coach — stayed NULL through the whole offer. `claimOffer` then passed
  //     `entry.host_id` straight into `createPublicBooking`, whose first guard is
  //     `if (!hostId) throw invalid("a coach or coachSlug is required")`
  //     (`publicBooking.mjs:436`, MEASURED). ★★ CONSEQUENCE WHILE IT STOOD: the person gets an
  //     email saying a time has come up, clicks "Take it", and is refused with a message about a
  //     coach they were never asked to choose — the one path a waitlist exists to serve.
  //   ★★★ A SEPARATE COLUMN, NOT `host_id`. `host_id` means "the host this person ASKED for; NULL
  //     means anyone", and `preferenceMatches` reads it that way (:67). Filling it in at offer time
  //     would permanently pin a flexible waiter to whichever coach happened to free a slot — and
  //     the taken/declined/expired paths put the entry back to `waiting` with that pin still on it,
  //     narrowing every future match. The offer is transient; the preference is not. So this joins
  //     the OFFER GROUP (`offered_starts_at`/`offered_ends_at`/`offer_expires_at`) and is cleared
  //     with it everywhere that group is cleared.
  const { rows: updated } = await tx.query(
    `UPDATE keystone.booking_waitlist_entry
        SET status = 'offered',
            offered_starts_at = $3,
            offered_ends_at = $4,
            offer_expires_at = now() + make_interval(mins => $5),
            offered_host_id = $6,
            updated_at = now()
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])
      RETURNING id, offer_expires_at`,
    [tenantId, ids, startsAt, endsAt, offerMinutes, hostId]);
  const expiresById = new Map(updated.map((r) => [r.id, r.offer_expires_at]));
  const told = updated.length;

  for (const entry of matched) {
    await emit(tx, {
      tenantId,
      topic: "booking.waitlist.offered",
      emittedBy: SECTION,
      subjectType: null,
      subjectId: null,
      actor: "system",
      payload: {
        entry_id: entry.id,
        service_id: serviceId,
        host_id: hostId,
        starts_at: startsAt,
        ends_at: endsAt,
        offer_expires_at: expiresById.get(entry.id),
        told_count: told,
      },
    });
  }

  return { told };
}

/**
 * The "Offer a time" button (13.13's route) — staff hand-picks one waiting entry and one slot,
 * bypassing `preferenceMatches` entirely (a human already decided this is the right match). Same
 * UPDATE shape and event as `offerFreedSlot`, `told_count` always 1. No `endsAt` param is given by
 * the section, so `offered_ends_at` is left as it was — the table's own shape check
 * (`waitlist_offer_shape`, 0314) only requires `offered_starts_at` and `offer_expires_at` for an
 * `offered` row, not `offered_ends_at`.
 */
export async function offerTime(tx, { tenantId, entryId, startsAt, hostId, actorUserId = null }) {
  // ★★★ `hostId` IS REQUIRED, AND THIS SENTENCE IS WHY THE DATABASE IS ONLY THE BACKSTOP.
  //     0405 (B-32) tightened `waitlist_offer_shape` so an `offered` row must name its host — the
  //     column `claimOffer` reads to build the booking. Without this check a caller that omits
  //     `hostId` would hit that CHECK and get a raw constraint violation, i.e. a 500 with a
  //     Postgres string in it, in place of a 400 and a sentence. ★★ The route
  //     (`/api/engagements/waitlist/offer`, `src/routes/writes.mjs:517`) passes the body straight
  //     through and validates nothing, so this is the only place the question is asked before the
  //     database asks it. Same division of labour `setDensity`/`setCalendarPreferences` use: JS
  //     owns the message, the CHECK owns the guarantee.
  if (!hostId) {
    throw invalid(`Choose which coach the time is with before offering it.`);
  }
  // ★ RUN-2 (26 Sep 2026): the same reasoning for the TIME. A missing/unparseable startsAt reached the
  //   offered-row CHECK and answered a raw 500 (found by the T10 persona run); it is a 400 with a sentence.
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) {
    throw invalid("Choose the time you are offering before offering it.", { field: "startsAt" });
  }
  const offerMinutes = await getSetting(tx, "booking.waitlist_offer_minutes", 60);
  const { rows: [entry] } = await tx.query(
    `UPDATE keystone.booking_waitlist_entry
        SET status = 'offered',
            offered_starts_at = $3,
            offer_expires_at = now() + make_interval(mins => $4),
            offered_host_id = $5,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'waiting'
      RETURNING id, service_id, offer_expires_at`,
    [tenantId, entryId, startsAt, offerMinutes, hostId]);
  if (!entry) throw notFound("That waitlist entry does not exist, or is no longer waiting.");

  await emit(tx, {
    tenantId,
    topic: "booking.waitlist.offered",
    emittedBy: SECTION,
    subjectType: null,
    subjectId: null,
    actor: userActor(actorUserId),
    payload: {
      entry_id: entry.id,
      service_id: entry.service_id,
      host_id: hostId,
      starts_at: startsAt,
      ends_at: null,
      offer_expires_at: entry.offer_expires_at,
      told_count: 1,
    },
  });

  return { told: 1 };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 13.14 — THE CLAIM FUNCTIONS. `peekOffer`/`claimOffer`/`declineOffer`, called by the public,
// unauthenticated `/api/public/waitlist/claim` and `/api/public/waitlist/decline` routes
// (`src/routes/public.mjs`) after the presented link token has already been peeked/redeemed for
// purpose `waitlist_claim` and its tenant checked against the Host-resolved tenant — every function
// below is handed an `entryId` that is ALREADY the subject the link named, never one a caller could
// pick free-form.
//
// ★★★ WHAT MAKES A DOUBLE-CLICK ON THE SAME LINK IMPOSSIBLE TO REDEEM TWICE: `redeemLinkToken`
//     spends the token through `keystone.redeem_link_token`, ONE SQL statement —
//     `UPDATE ... SET redeemed_at = now() WHERE ... redeemed_at IS NULL ... RETURNING` — so two
//     concurrent redeems of the SAME row serialise on Postgres's own row lock: the second UPDATE
//     blocks until the first commits, then re-evaluates `redeemed_at IS NULL` against the now-
//     current row and matches nothing. That happens entirely inside `src/auth/linkToken.mjs`
//     (CT-018/019), before either of these functions ever runs — nothing here re-implements it.
//     A DIFFERENT race — two DIFFERENT entries (two different tokens) both offered the SAME slot —
//     is a different property, held by `createPublicBooking`'s own advisory lock + exclusion
//     constraint on `keystone.booking` (see `claimOffer`'s own comment below).
//
// ★★★ COUNTS, NEVER NAMES. `peekOffer` is a READ on a PUBLIC, unauthenticated route — the one
//     thing standing between a stranger holding a link and every OTHER waiting person's name,
//     email or position is this function never selecting those columns. `toldOthers` is a bare
//     integer count of sibling offers, nothing that could be turned back into who they are.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Loose, display-only labels for the closed `PREFERENCES` vocabulary — never exported: nothing
 *  outside this file's own claim-page sentence needs the mapping, and the closed set itself is
 *  already public via `PREFERENCES` above. */
function preferenceLabel(preference) {
  switch (preference) {
    case "evenings": return "evenings";
    case "mornings": return "mornings";
    case "weekends": return "weekends";
    case "specific":  return "specific days";
    case "flexible":
    default:          return "any time that works";
  }
}

/**
 * ★★ PEEK — a non-spending read of the offer a `waitlist_claim` link points at (13.35's claim
 * page loads this before anyone clicks anything). Three-state summary only: `open` (still claimable),
 * `taken` (this entry ITSELF is already `claimed` — the same link, used, or a peek after a successful
 * POST), or `expired` (anything else: the row is gone, or its own offer window has closed/cycled back
 * to `waiting` — this function cannot and does not distinguish "someone else claimed a sibling offer
 * on the same slot" from "the window simply ran out", because `booking_waitlist_entry` stores no
 * column recording which of the two happened once an entry is back to `waiting`; `claimOffer`, which
 * runs at the moment of the attempt, is what tells THOSE two apart, and does, below).
 *
 * ★ `locationSentence` is honestly `null` — same "return null rather than guess" rule
 * `publicBooking.mjs`'s `photoUrl` already follows. Neither `booking_waitlist_entry` (0314/0398) nor
 * `keystone.service` carries any location column; `location_kind`/`location_detail` live only on
 * `keystone.booking`, written once an offer is actually claimed into one. There is nothing to read
 * yet at peek time, so nothing is invented.
 */
export async function peekOffer(tx, { tenantId, entryId }) {
  const { rows: [entry] } = await tx.query(
    `SELECT e.status, e.offered_starts_at, e.offered_ends_at, e.offer_expires_at,
            e.service_id, e.preference,
            s.name AS service_name, s.duration_minutes,
            h.display_name AS host_name
       FROM keystone.booking_waitlist_entry e
       JOIN keystone.service s ON s.tenant_id = e.tenant_id AND s.id = e.service_id
       LEFT JOIN keystone.app_user h ON h.tenant_id = e.tenant_id AND h.id = e.host_id
      WHERE e.tenant_id = $1 AND e.id = $2`,
    [tenantId, entryId]);

  if (!entry) return { state: "expired" };

  let state;
  if (entry.status === "offered" && entry.offer_expires_at != null && entry.offer_expires_at > new Date()) {
    state = "open";
  } else if (entry.status === "claimed") {
    state = "taken";
  } else {
    state = "expired";
  }

  // ★ COUNTS, NEVER NAMES — every OTHER entry currently offered this exact slot+service, as a bare
  //   number. `offered_starts_at = $3` reads correctly even when this entry's own offer has already
  //   lapsed (offered_starts_at stays NULL only once cycled back to 'waiting', at which point the
  //   comparison matches nothing and the count is 0 — the honest answer once nothing is live).
  const { rows: [{ count }] } = await tx.query(
    `SELECT count(*)::int AS count
       FROM keystone.booking_waitlist_entry
      WHERE tenant_id = $1 AND service_id = $2 AND status = 'offered'
        AND offered_starts_at = $3 AND id <> $4`,
    [tenantId, entry.service_id, entry.offered_starts_at, entryId]);

  return {
    state,
    startsAt: entry.offered_starts_at,
    endsAt: entry.offered_ends_at,
    hostName: entry.host_name ?? null,
    serviceName: entry.service_name,
    durationMinutes: entry.duration_minutes,
    locationSentence: null,
    preferenceSentence: `You asked for ${preferenceLabel(entry.preference)}, and this is the closest we have.`,
    toldOthers: count,
  };
}

/**
 * ★★★ THE SPEND. Called after the ROUTE has already redeemed the presented link token (single-use,
 * see the file-header comment above) and confirmed its tenant matches the Host-resolved one.
 *
 * `entry` must be `offered` and its `offer_expires_at` still in the future — otherwise `{state:
 * 'expired'}`, the honest answer once the window has closed (whether by the 13.15 expiry job or
 * simply nobody having claimed it yet at all). The service must still be `public_bookable` —
 * otherwise the ONE generic public refusal (`PUBLIC_BOOKING_REFUSED`, 404): a service withdrawn
 * from public booking, or portal-only, is claimed by signing in (13.15), never through this door.
 *
 * ★★★ THE SAME-SLOT RACE — two DIFFERENT entries (two different links) both offered the SAME
 * host+time. `createPublicBooking` books through the 0317 anonymous-admission path, which serialises
 * on the SAME per-host advisory lock (`booking:${tenantId}:${hostId}`) and the SAME exclusion
 * constraint every other booking door uses (`publicBooking.mjs`'s own "GUARD 2 ... GUARD 1" pair).
 * The loser's `createPublicBooking` call throws `SlotTakenError` — caught HERE, the entry is put
 * straight back to `waiting` (never a fourth status: the section names only `waiting`), and the
 * caller gets `{state:'taken', ...}`. On success this entry becomes `claimed` and every OTHER entry
 * offered this exact `offered_starts_at`+service also goes back to `waiting` — they stay on the list,
 * per 0314's "never deleted, only transitioned" rule.
 */
export async function claimOffer(tx, { tenantId, entryId }) {
  const { rows: [entry] } = await tx.query(
    `SELECT id, service_id, host_id, offered_host_id, display_name, email,
            offered_starts_at, offered_ends_at, offer_expires_at, status
       FROM keystone.booking_waitlist_entry
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [tenantId, entryId]);

  if (!entry || entry.status !== "offered" ||
      entry.offer_expires_at == null || !(entry.offer_expires_at > new Date())) {
    return { state: "expired" };
  }

  const { rows: [service] } = await run(tx, db
    .selectFrom("keystone.service")
    .select(["duration_minutes"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", entry.service_id)
    .where("public_bookable", "=", true));
  if (!service) throw notFound(PUBLIC_BOOKING_REFUSED);

  const startsAt = entry.offered_starts_at;
  // ★ `offered_ends_at` is NULL for a staff hand-picked offer (`offerTime`, above, sets no end) —
  //   fall back to the service's own duration, the same computation `public.mjs`'s POST /api/public/
  //   book handler already does for the ordinary booking form.
  const endsAt = entry.offered_ends_at ?? new Date(startsAt.getTime() + service.duration_minutes * 60_000);

  let booking;
  try {
    booking = await createPublicBooking(tx, {
      // ★ THE OFFER'S host, falling back to the one the person asked for. `offered_host_id` is the
      //   coach whose freed slot this actually IS (0405 — see `offerFreedSlot` above); `host_id` is
      //   only what they asked for, and is NULL for a flexible waiter. Reading the preference first
      //   was the bug: it handed `createPublicBooking` a null and got the caller refused.
      tenantId, hostId: entry.offered_host_id ?? entry.host_id, serviceId: entry.service_id, startsAt, endsAt,
      name: entry.display_name, email: entry.email, source: "waitlist",
    });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      await run(tx, db
        .updateTable("keystone.booking_waitlist_entry")
        .set({ status: "waiting", offered_starts_at: null, offered_ends_at: null, offer_expires_at: null, offered_host_id: null, updated_at: sql`now()` })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", entryId));
      return { state: "taken" };
    }
    throw e;
  }

  await run(tx, db
    .updateTable("keystone.booking_waitlist_entry")
    .set({ status: "claimed", updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", entryId));

  // ★ Every OTHER entry offered this exact slot+service — the evening-waiters told together,
  //   released together — stays on the list at 'waiting', never removed (0314).
  await run(tx, db
    .updateTable("keystone.booking_waitlist_entry")
    .set({ status: "waiting", offered_starts_at: null, offered_ends_at: null, offer_expires_at: null, offered_host_id: null, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("service_id", "=", entry.service_id)
    .where("status", "=", "offered")
    .where("offered_starts_at", "=", startsAt)
    .where("id", "<>", entryId));

  return { state: "claimed", bookingId: booking.bookingId, bookingState: booking.state };
}

/**
 * "Not this one — keep me on the list." Puts the entry back to `waiting` (never removed — 0314) and
 * revokes the link token so it cannot be peeked or claimed again, in the SAME transaction as the
 * entry transition. `tokenId` is the PUBLIC half of the presented string (`parsePresented(t).tokenId`,
 * `src/auth/linkToken.mjs`) — the route already has it from parsing `t` to peek the offer, so it is
 * passed in rather than re-derived here.
 */
export async function declineOffer(tx, { tenantId, entryId, tokenId }) {
  const { rows: [row] } = await run(tx, db
    .updateTable("keystone.booking_waitlist_entry")
    .set({ status: "waiting", offered_starts_at: null, offered_ends_at: null, offer_expires_at: null, offered_host_id: null, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", entryId)
    .where("status", "=", "offered")
    .returning(["id"]));

  const { revoked } = await revokeLinkToken(tx, tokenId, "waitlist_offer_declined");

  return { declined: Boolean(row), tokenRevoked: revoked };
}
