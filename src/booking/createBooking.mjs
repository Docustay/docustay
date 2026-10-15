// @ts-check
// P7.6 / §B4 STEP 4 — BOOKING WRITES, WITH BOTH GUARDS.
//
// ★★★ §B4 STEP 4, verbatim: "A unique index on the staff-and-slot pair AND a locked overlap check
// inside the transaction. EITHER ONE ALONE STILL LETS DOUBLES THROUGH."
//
// ★★ [MEASURED, research/B1-snagtime-diff.md §2] that claim is TRUE OF THE GUARD IT DESCRIBES and
// not true in general — a START-KEYED unique index leaks (a 60-minute booking at 09:00 and a
// 30-minute at 09:30 have different keys and overlapping times), while a minute-granularity index
// or a range EXCLUDE does not, because those indexes understand overlap.
// ★ P7.7 MEASURES which of ours suffice alone rather than asserting it either way.
//
// ══ THE TWO GUARDS AS BUILT ════════════════════════════════════════════════
//   GUARD 1 — `EXCLUDE USING gist (tenant_id =, host_id =, occupies &&) WHERE state <> cancelled`
//             (migration 0013). The INDEX itself refuses an overlapping range. Atomic; no lock.
//   GUARD 2 — an explicit `SELECT … FOR UPDATE` on the host row, then an overlap query, INSIDE
//             the transaction, BEFORE the insert.
//
// ★★★ WHY GUARD 2 IS STILL WORTH HAVING WHEN GUARD 1 IS SUFFICIENT:
//   · it converts a raw 23P01 constraint violation into a DOMAIN ERROR the caller can act on —
//     "that time was just booked, choose another" rather than a Postgres error string,
//   · it can say WHICH booking conflicts, which an index violation cannot,
//   · and it still holds if someone later adds a code path that writes `occupies` directly.
// ★ It is NOT load-bearing for correctness, and this file says so rather than implying otherwise.
// Pretending a redundant guard is essential is how the essential one gets removed by mistake.

import { emit, userActor } from "../events/outbox.mjs";
import { reserveCreditForBooking, returnCreditForBooking } from "../money/credits.mjs";
import { getSetting } from "../settings/writes.mjs";
// ★ P2.5 — the default and the key live with the reminder logic, not here, so the scheduler and the
//   writer cannot disagree about what "the practice default" means.
import { DEFAULT_REMINDER_MINUTES, REMINDER_SETTING_KEY } from "./reminders.mjs";
import { invalid, forbidden, notFound, AppError, ErrorKind } from "../http/errors.mjs";
// ★ 13.9 — the client participant is added under the SAME `tx` as the booking, per §2.7 (never
//   borrow another party's name) and the "one write, one event, one transaction" rule this module
//   already follows for the credit reservation below.
import { addBookingParticipant } from "./writes.mjs";
// ★ B-3 — the one requirement mechanism (F793) and the executed-instance lineage read.
import { requirementsFor, hasPriorBooking, currentExecutedInstance } from "./requirements.mjs";
// ★ B-3 — sending the held agreement. Existing signatures, unchanged (documents/writes.mjs:240,313).
// ★ DOCUSTAY WALL FIX — routed through the front door (both already exported there); pure
//   relocation, zero logic change. Found by db/gates/documents_wall.mjs.
import { createInstance, sendInstance } from "../documents/frontDoor.mjs";
import { templateBuilderAndName, pointHoldAtBooking } from "../documents/api.mjs";
import { db, run } from "../db/kysely.mjs";
import { asPracticeOwner } from "../money/asPracticeOwner.mjs";
import { sql } from "kysely";

// ★★ 13.9 — the closed `source` vocabulary. No default row exists for this in the database; this
//   array IS the contract, checked by hand against migration 0399's CHECK
//   (`booking_source_check`, `db/migrations/0399_booking_flag_source_price.sql:7-8`) at review time.
const BOOKING_SOURCES = ["staff", "portal", "public", "waitlist", "rwg"];

// ★★★ 409, NOT 500. [MEASURED 2026-09-14] the deployed app answered
//     `POST /api/engagements/bookings -> 500 SlotTakenError: That time was just booked.`
//     The message is perfectly user-facing; the STATUS said "we broke". A double-booking is the most
//     ordinary conflict this product has — two people wanting one slot — and a 500 tells a coach to
//     report a bug instead of picking another time. It also makes every uptime monitor count normal
//     contention as an outage.
//
// ★★★ AND THE FIX IS THE SUPERCLASS, NOT A `statusCode` PROPERTY. [MEASURED — src/http/errors.mjs:88
//     `toAppError`] the boundary reads `statusCode` on NOTHING. It branches on `instanceof AppError`,
//     then on `err.name === "NoTenantContext"`, then on four Postgres SQLSTATEs, then falls through to
//     INTERNAL/500. An `Error` subclass that sets `this.statusCode = 409` therefore still answers 500 —
//     the property is never read by anything. My first attempt at this fix did exactly that and would
//     have looked correct in review while changing nothing on the wire.
//   ★ Extending AppError makes the status come from the closed taxonomy (CONFLICT → 409) and makes
//     `retryable` false, which is right: retrying the same slot cannot succeed.
//   ★ `instanceof SlotTakenError` still holds, which is how all four gate assertions identify it
//     (db/gates/p7_double_booking.mjs:124,164,192 · db/gates/p7_end_to_end.mjs:138).
//   ★ conflictingBookingId is kept as a PROPERTY and deliberately NOT passed as AppError `detail`:
//     `detail` is serialised to the client for every 4xx, and on the client-facing booking route that
//     would hand one practice member the row id of another person's session. The gates read the
//     property; nobody needs it in the body.
export class SlotTakenError extends AppError {
  constructor(message, conflictingBookingId = null) {
    super(ErrorKind.CONFLICT, message);
    this.name = 'SlotTakenError';
    this.code = 'slot_taken';
    this.conflictingBookingId = conflictingBookingId;
  }
}

/** Postgres SQLSTATE for an exclusion-constraint violation. */
const EXCLUSION_VIOLATION = '23P01';

/**
 * Create a booking. ★ The caller supplies an already-open transaction client — this must run
 * inside one, because guard 2's lock has no meaning otherwise.
 *
 * @param {object} tx    a pg client INSIDE a transaction, with tenant context already set
 * @param {object} input { tenantId, hostId, serviceId, startsAt, endsAt,
 *                         bufferBeforeMinutes, bufferAfterMinutes, inviteeTimezone,
 *                         title, description, locationKind, locationDetail, actorUserId,
 *                         recurrenceCadence, recurrenceGroupId, reminderMinutesBefore,
 *                         capacity, source, priceId, personId, tellClient }
 * @param {object} opts  { skipAdvisoryCheck } — for the P7.7 measurement ONLY;
 *                        { clientSelfService } — true ONLY from a client's own booking route: skips
 *                        the staff `user_may` check and asks the client-self-booking question
 *                        instead (see that block below). Defaults to false — every other caller
 *                        (staff route, tests, scripts) is completely unchanged.
 */
export async function createBooking(tx, input, opts = {}) {
  const {
    tenantId, hostId, serviceId, startsAt, endsAt,
    bufferBeforeMinutes = 0, bufferAfterMinutes = 0, inviteeTimezone = null,
    // ★★ P2.5 — the canonical fields. All optional: a booking made with only a time and a host is
    //    still a valid booking, and requiring a location would break every existing caller to record
    //    a fact the practice may not have yet.
    title: titleInput = null, description = null, locationKind = null, locationDetail = null,
    recurrenceCadence = null, recurrenceGroupId = null,
    // ★ P8.6 — whose credit to spend on this booking, or null to pay another way.
    creditForUserId = null,
    // ★★★ `undefined` and `null` MEAN DIFFERENT THINGS HERE, and this is the one place in the module
    //     where that distinction is load-bearing:
    //       undefined — the caller did not say → apply the practice's default
    //       null      — the caller said NO REMINDER → honour it
    //     Defaulting `null` to the practice value would make "no reminder" unsayable, which is the
    //     silent-override shape this project keeps finding in settings code.
    reminderMinutesBefore,
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ FIX ROUND 2, F494 — `createdBy` IS GONE, same fix as `money/writes.mjs`'s createInvoice.
    //     It used to be its own parameter, populated straight from the request body (
    //     `routes/writes.mjs`'s `{ ...body }` spread) — so `POST /api/engagements/bookings` could
    //     name ANY user id as the one who created the booking, into `booking.created_by`.
    //     `actorUserId` (the session id `routes/writes.mjs:230` stamps LAST, after the body spread)
    //     is now the ONLY source, for the column AND the envelope's `actor` below. A body that
    //     still sends `createdBy` is simply not read under any name.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    actorUserId = null,
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ 13.9 — CAPACITY / SOURCE / PRICE / PERSON / HOLD, all optional so every existing caller
    //     (the staff route, the app booking route, tests) keeps working unchanged.
    //   · `capacityInput` — kept as the raw input (not `capacity`) because `undefined` ("read the
    //     service default") and explicit `null` ("one-to-one, same reading the service's own
    //     default_capacity gives") are different instructions this function must tell apart.
    //   · `priceIdInput` — same distinction: absent resolves the currently active price row and
    //     SNAPSHOTS it; an explicit id (or explicit null) is used exactly as given.
    capacity: capacityInput,
    source = "staff",
    priceId: priceIdInput,
    personId = null,
    tellClient = true,
  } = input;

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ hostId AND serviceId ARE VALIDATED HERE, AND THEY WERE NOT UNTIL NOW.
  //     [MEASURED 2026-09-14, P16.12's deployed E2E] a POST that omitted `hostId` produced
  //         500 {"kind":"internal","message":"null value in column \"host_id\" of relation
  //              \"booking\" violates not-null constraint"}
  //     — an **INTERNAL SERVER ERROR for a caller's missing field.** The NOT NULL constraint did its
  //     job; the problem is that a 500 tells an integrator "we broke" when the truth is "you left out
  //     the host", and it puts a Postgres constraint name in a response body.
  //   ★★ This file already validates `startsAt`/`endsAt` carefully. The two required IDs were simply
  //      never checked, so the only validation was the column definition — and a column cannot phrase
  //      a 400. Same fail-loud, name-the-field discipline as the rest of the module.
  //   ★ `invalid()` is the project's 400; TypeError/RangeError below are kept as they were, because a
  //     non-Date `startsAt` is a PROGRAMMING error in a caller module, not a user's input.
  if (!tenantId) throw invalid('a booking needs a tenantId');
  if (!hostId) {
    throw invalid('a booking needs a hostId — which member of staff is this session with? ' +
      'Without it the booking has no calendar to appear on and no one to hold the slot.');
  }
  if (!serviceId) {
    throw invalid('a booking needs a serviceId — the service decides the duration, the price and ' +
      'whether it is bookable at all.');
  }
  // ★ 13.9 — the closed source vocabulary. Checked here, with the other input validation, before
  //   anything touches the database.
  if (!BOOKING_SOURCES.includes(source)) {
    throw invalid(`source must be one of ${BOOKING_SOURCES.join(", ")} — got "${source}".`);
  }

  if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) {
    throw new TypeError('startsAt and endsAt must be Date instances (UTC instants)');
  }
  if (endsAt <= startsAt) throw new RangeError('endsAt must be after startsAt');

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ STAGE 7 7.18 — THE CREATE-SIDE GAP. [MEASURED] before this, nothing here asked whether
  //     `actorUserId` may book for `hostId` — a Coach on `engagement: edit/owned` could put a
  //     session on ANY other coach's calendar. Same object/verb this file's own record read
  //     (`RECORD_QUERIES.booking`, `src/records/queries.mjs`) asks for cancel/reschedule after this
  //     task: 'engagement', 'edit'. BEFORE ANY WRITE — ahead of both guards below.
  //   ★★ REFUSAL IS `forbidden` (403), NOT `notFound`. Unlike cancel/reschedule, there is no
  //      EXISTING record here whose existence a 404 would need to hide — creating is not a record
  //      that could leak by its status code.
  //   ★ 0197 adds the SAME predicate to `keystone.booking`'s INSERT policy `WITH CHECK`, so the
  //     rule holds for any future writer too (a script, a worker, a second route) — this check is
  //     belt and braces, not the only place it is enforced.
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ REPORT ITEM (step-4 FIX) — "NO signed-in client can book a session." A client holds no
  //     `user_role` at all, so `user_may` above is ALWAYS false for one — every real client session
  //     hitting `POST /api/app/booking` got 403. `opts.clientSelfService` is the ONLY way around
  //     `user_may`, and only `/api/app/booking` passes it (see that route). When true, this asks the
  //     SAME three questions 0507's new policy branch asks, in SQL, inside this same transaction:
  //     the actor is a client role IN THIS TENANT, the host is staff-and-accepting, the service is
  //     bookable/active AND has the client-portal door open (`portal_bookable` — the DIFFERENT flag
  //     from the anonymous public door's `public_bookable`). `created_by` below is always
  //     `actorUserId` regardless of this branch — the row never carries anyone else's identity.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (opts.publicBooking) {
    // ★ B-1 — THE ANONYMOUS PUBLIC DOOR. Reachable ONLY from publicBooking.mjs (never from an
    //   authenticated route — see that file's own comment at the call site). actorUserId === null is
    //   a HARD PRECONDITION, checked FIRST: an authenticated caller's actorUserId is never null, so
    //   this branch can never be reached with a real identity, by construction, not by convention.
    if (actorUserId !== null) {
      throw forbidden('opts.publicBooking is for the anonymous door only — actorUserId must be null.');
    }
    const { rows: doorRows } = await tx.query(
      `SELECT
          EXISTS (SELECT 1 FROM keystone.app_user h
                   WHERE h.id = $1 AND h.tenant_id = $2
                     AND h.role = 'staff' AND h.accepting_new_bookings = true) AS host_open,
          EXISTS (SELECT 1 FROM keystone.service s
                   WHERE s.id = $3 AND s.tenant_id = $2
                     AND s.bookable AND s.active AND s.public_bookable) AS service_open`,
      [hostId, tenantId, serviceId]);
    const ok = doorRows[0];
    if (!ok?.host_open || !ok?.service_open) {
      throw forbidden('This host or service is not open to public booking.');
    }
  } else if (opts.clientSelfService) {
    const { rows: selfRows } = await tx.query(
      `SELECT
          EXISTS (SELECT 1 FROM keystone.app_user c
                   WHERE c.id = $1 AND c.tenant_id = $2
                     AND c.role IN ('adult_client', 'adolescent_client')) AS actor_is_client,
          EXISTS (SELECT 1 FROM keystone.app_user h
                   WHERE h.id = $3 AND h.tenant_id = $2
                     AND h.role = 'staff' AND h.accepting_new_bookings = true) AS host_open,
          EXISTS (SELECT 1 FROM keystone.service s
                   WHERE s.id = $4 AND s.tenant_id = $2
                     AND s.bookable AND s.active AND s.portal_bookable) AS service_open`,
      [actorUserId, tenantId, hostId, serviceId]);
    const ok = selfRows[0];
    if (!ok?.actor_is_client || !ok?.host_open || !ok?.service_open) {
      throw forbidden('You do not have permission to book a session for this host.');
    }
  } else {
    const { rows: mayRows } = await tx.query(
      `SELECT keystone.user_may($1, 'engagement', 'edit', $2) AS allowed`,
      [actorUserId, hostId]);
    if (!mayRows[0]?.allowed) {
      throw forbidden('You do not have permission to book a session for this host.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 13.9 — CAPACITY, PRICE AND PERSON ARE RESOLVED HERE, BEFORE EITHER GUARD.
  //     ★★ None of this is a concurrency question — capacity here means "how many seats does this
  //     OCCURRENCE have", stored once on the row at create time; it is 13.10's job (a separate
  //     task), guarded by `FOR UPDATE` + this SAME advisory-lock key on the SEAT-taking write
  //     (`addBookingParticipant`), to hold that count against two simultaneous joins. This function
  //     only decides what the row's capacity number STARTS as.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ Fetched unconditionally (not only when capacity is unresolved) because `title`'s own default
  //   below needs the service's name regardless of how capacity was supplied.
  const { rows: svcNameRows } = await run(tx, db
    .selectFrom("keystone.service")
    .select(["name", "default_capacity"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", serviceId));
  const serviceRow = svcNameRows[0] ?? null;

  let capacity = capacityInput;
  if (capacity === undefined) {
    capacity = serviceRow?.default_capacity ?? null;
  } else if (capacity !== null) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw invalid('capacity must be a whole number between 1 and 500, or null for a one-to-one session.');
    }
  }

  // ★★★ "UNTITLED SESSION" — a booking with no title fell back to the record page's generic
  //     `Untitled ${label}`, which for this shell's `label: 'Session'` reads "Untitled session" no
  //     matter what was booked. Nobody ever supplied one: `BookSessionDialog.jsx` never sent `title`
  //     at all. The session's name IS the service that was booked — defaulting to it here, once, at
  //     the one place every booking-creation path (staff, public, portal) converges, means every
  //     caller gets a real title without each one having to know to ask the service for its own name.
  const title = (!titleInput || !titleInput.trim()) ? (serviceRow?.name ?? null) : titleInput;

  // ★★ THE PRICE ROW IS SNAPSHOTTED, NEVER RE-LOOKED-UP. Stripe is the money record (CLAUDE.md);
  //    `price_id` here is only a record of what was agreed at booking time. A price change is a
  //    NEW row (the old one is never edited), so resolving "the active row" NOW and storing its id
  //    is what keeps a later price change from silently re-pricing this booking.
  let priceId = priceIdInput;
  if (priceId === undefined) {
    const { rows: priceRows } = await run(tx, db
      .selectFrom("keystone.price")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("subject_type", "=", "service")
      .where("subject_id", "=", serviceId)
      .where("active", "=", true)
      .where("effective_from", "<=", sql`now()`)
      .where((eb) => eb.or([
        eb("effective_to", "is", null),
        eb("effective_to", ">", sql`now()`),
      ]))
      .orderBy("effective_from", "desc")
      .limit(1));
    priceId = priceRows[0]?.id ?? null;
  }

  // ★★★ THE HOLD. An adolescent client with no GRANTED consent books into `pending_consent`
  //    (0309/CT-116's widened `booking_state_check`), not `confirmed` — the row exists and holds
  //    the slot, but the client is not told, and nothing downstream treats it as a real session,
  //    until a guardian executes consent. ★★ WHAT RELEASES THE HOLD: guardian consent executing
  //    moves it to `confirmed` (spec 03b §3, not this function's job). ★★ WHAT EXPIRES IT: 13.15's
  //    `booking_hold_expiry` job, fired +24h after this call, per 0309's own header — NOT anything
  //    in this function. This function only decides the STARTING state.
  let state = "confirmed";
  let personDisplayName = null, personEmail = null;
  if (personId) {
    const { rows: personRows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["display_name", "email", "role", "consent_status"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", personId));
    if (!personRows.length) throw notFound('That person could not be found.');
    const person = personRows[0];
    personDisplayName = person.display_name;
    personEmail = person.email;
    // ★ IS DISTINCT FROM in SQL, `!==` in JS give the same answer for this comparison: a NULL
    //   consent_status (never asked) and 'waiting'/'declined' (asked, not granted) are all
    //   distinct from 'granted', and only 'granted' clears the hold.
    state = (person.role === "adolescent_client" && person.consent_status !== "granted")
      ? "pending_consent" : "confirmed";
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ B-3 — A SERVICE THAT NEEDS A SIGNATURE HOLDS THE BOOKING UNTIL IT IS SIGNED (F793).
  //     `item_agreement_requirement.hold_until_signed`/`first_booking_only` (0410) existed and were
  //     read by NOTHING — a practice could switch either on in the editor and no booking anywhere
  //     ever held for it. `requirementsFor`/`hasPriorBooking`/`currentExecutedInstance`
  //     (`./requirements.mjs`, new) are the first reader.
  //   ★★ THE CONSENT RULE STAYS FIRST. A teen with no granted consent is `pending_consent`
  //      regardless of any signature requirement — that check already ran, above, and this block
  //      only widens `state === "confirmed"` further, never overrides `pending_consent`.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  let holdTemplateId = null;
  if (state === "confirmed" && personId) {
    // ★ R27 (RECONCILE) — "has this person signed / booked before" is a fact about the PRACTICE's
    //   records, not about what the booker may view: document_instance is visibility-gated, so a
    //   booker who cannot see the client's executed agreement (or no viewer at all) read "never
    //   signed" and held a booking that should have confirmed. Read as the Owner, on the same tx;
    //   the booker's viewer is restored before the hold's instance is created below.
    //   Only a service that actually holds for a signature pays for the Owner read.
    const holds = (await requirementsFor(tx, { tenantId, serviceId })).filter((r) => r.holdUntilSigned);
    if (holds.length > 0) {
      holdTemplateId = await asPracticeOwner(tx, tenantId, async () => {
        for (const req of holds) {
          if (req.firstBookingOnly && await hasPriorBooking(tx, { tenantId, personId, serviceId })) continue;
          if (!(await currentExecutedInstance(tx, { tenantId, templateId: req.templateId, personId }))) {
            return req.templateId;
          }
        }
        return null;
      });
    }
    if (holdTemplateId) state = "pending_signature";
  }

  // ★ The hold's own expiry — 24h before the session, clamped to at least an hour from now so a
  //   same-day booking still gets a real window instead of one that has already lapsed.
  let holdExpiresAt = null;
  if (state === "pending_signature") {
    const minExpiry = new Date(Date.now() + 60 * 60_000);
    const targetExpiry = new Date(startsAt.getTime() - 24 * 60 * 60_000);
    holdExpiresAt = targetExpiry > minExpiry ? targetExpiry : minExpiry;
  }

  if (!opts.skipAdvisoryCheck) {
    // ══ GUARD 2 — SERIALISE THE HOSTS, THEN LOOK ═══════════════════════════
    // ★★ A transaction-scoped ADVISORY LOCK keyed on the host. Two concurrent attempts for the
    // same host queue; the second sees the first's committed row.
    // ★ Why an advisory lock and not `SELECT … FOR UPDATE` on the host's app_user row: locking a
    // PERSON row to book their time is a lock on the wrong object — anything else that updates
    // that person (a name change, a login timestamp) would contend with booking, and a booking
    // would contend with it. The advisory key names the thing actually being serialised.
    // ★ `hashtextextended` gives a stable 64-bit key; it is released at COMMIT or ROLLBACK
    // automatically, so there is no path that leaks a held lock.
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`booking:${tenantId}:${hostId}`]);

    const occStart = new Date(startsAt.getTime() - bufferBeforeMinutes * 60_000);
    const occEnd   = new Date(endsAt.getTime()   + bufferAfterMinutes  * 60_000);

    const { rows } = await tx.query(
      `SELECT id, starts_at, ends_at
         FROM keystone.booking
        WHERE tenant_id = $1 AND host_id = $2
          AND state <> 'cancelled'
          AND occupies && tstzrange($3, $4, '[)')
        LIMIT 1`,
      [tenantId, hostId, occStart, occEnd]);

    if (rows.length > 0) {
      // ★ A DOMAIN error, naming the conflict. This is guard 2's actual value.
      throw new SlotTakenError('That time was just booked. Choose another slot.', rows[0].id);
    }
  }

  // ══ GUARD 1 — THE INDEX HAS THE FINAL WORD ═══════════════════════════════
  try {
    // ★★ THE PRACTICE'S DEFAULT IS RESOLVED ONCE, HERE, AND STORED ON THE ROW. A column meaning
    //    "go and ask a setting" makes a booking's behaviour depend on a value somebody can change
    //    afterwards — the row would then no longer record what the client was promised.
    const reminder = reminderMinutesBefore === undefined
      ? await getSetting(tx, REMINDER_SETTING_KEY, DEFAULT_REMINDER_MINUTES)
      : reminderMinutesBefore;

    const { rows } = await tx.query(
      `INSERT INTO keystone.booking
         (tenant_id, host_id, service_id, starts_at, ends_at,
          buffer_before_minutes, buffer_after_minutes, invitee_timezone,
          title, description, location_kind, location_detail, created_by,
          recurrence_cadence, recurrence_group_id, reminder_minutes_before,
          capacity, source, price_id, state, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, starts_at, ends_at, state, capacity, price_id, hold_expires_at`,
      [tenantId, hostId, serviceId, startsAt, endsAt,
       bufferBeforeMinutes, bufferAfterMinutes, inviteeTimezone,
       title, description, locationKind, locationDetail, actorUserId,
       recurrenceCadence, recurrenceGroupId, reminder,
       capacity, source, priceId, state, holdExpiresAt]);

    // ★★★ §X4.1 — THE EVENT, IN THIS TRANSACTION. P15B.2. "A write with no event is a silent state
    //     change", and until now this module was one: [MEASURED] `emit()` had ZERO call sites
    //     anywhere in src/ (F5), so the booking table moved and nothing — no feed, no worker, no
    //     audit trail — could observe it. ★ This is the outbox's FIRST PRODUCER.
    // ★★ IT IS THE SAME `tx`, DELIBERATELY AND NECESSARILY. A booking that exists with no event, or
    //    an event for a booking the exclusion constraint refused, are both states nothing in the
    //    system can repair. One transaction makes both unrepresentable. ★ And emit() now REFUSES a
    //    pool (U26/P15B.2a), so this cannot be loosened by accident later.
    // ★ AFTER the INSERT and inside the same try: if the insert raises EXCLUSION_VIOLATION there is
    //   nothing to announce, and the catch below turns it into SlotTakenError.
    await emit(tx, {
      tenantId,
      topic: "booking.booking.created",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: rows[0].id,
      // ★ FIX ROUND 2 — same session id as the row's `created_by` column now (see the parameter's
      //   own comment above): one fact, one source, never the body.
      actor: userActor(actorUserId),
      // ★ The payload carries what a consumer needs WITHOUT re-reading: a notification has to name
      //   the time, and the invitee's own zone is the only correct way to render it (§B4 STEP 3 —
      //   local wall-clock plus an IANA zone, never a stored UTC instant).
      payload: {
        starts_at: rows[0].starts_at,
        ends_at: rows[0].ends_at,
        state: rows[0].state,
        host_id: hostId,
        service_id: serviceId,
        invitee_timezone: inviteeTimezone,
        // ★ 13.9 — a consumer (a notification, a hold-expiry sweep) needs these without a re-read.
        source,
        capacity: rows[0].capacity,
        price_id: rows[0].price_id,
        tell_client: tellClient,
        person_id: personId ?? null,
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ B-3 — WHEN HELD, THE AGREEMENT GOES OUT NOW, IN THIS SAME TRANSACTION. A booking sitting
    //     in `pending_signature` with nothing sent would be a hold nobody can ever clear.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (rows[0].state === "pending_signature") {
      const tpl = await templateBuilderAndName(tx, { tenantId, templateId: holdTemplateId });
      const inst = await createInstance(tx, {
        tenantId, builder: tpl.builder, title: tpl.name, templateId: holdTemplateId, subjectUserId: personId,
      });
      // ★ D1 — the door: documents/api.mjs owns the hold_booking_id write (R15/I29's own ruling unchanged).
      await pointHoldAtBooking(tx, { tenantId, instanceId: inst.id, bookingId: rows[0].id });
      await sendInstance(tx, { tenantId, instanceId: inst.id });
      await emit(tx, {
        tenantId,
        topic: "booking.booking.held",
        emittedBy: "booking",
        subjectType: "booking",
        subjectId: rows[0].id,
        actor: userActor(actorUserId),
        payload: { hold_instance_id: inst.id, hold_expires_at: rows[0].hold_expires_at },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ 13.9 — THE CLIENT PARTICIPANT, SAME TRANSACTION, AFTER THE INSERT AND ITS EVENT.
    //     A booking made "for" someone with no participant row is a booking nobody can be shown on
    //     an attendance list — same reasoning as P8.6's credit reservation just below, which is
    //     exactly why this sits ahead of it (a person is added before their credit is spent).
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (personId) {
      await addBookingParticipant(tx, {
        tenantId, bookingId: rows[0].id, party: "client",
        appUserId: personId, displayName: personDisplayName, email: personEmail, actorUserId,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ P8.6 — THE CREDIT IS RESERVED IN **THIS** TRANSACTION, WITH THE BOOKING.
    //     §B4 STEP 6 and KS-16.2 ruling 1: booking spends a credit. Doing it in a second
    //     transaction would allow a booking that exists with no credit attached — and the repair
    //     would have to guess whether the client had been charged.
    //   ★★ OPT-IN, NOT AUTOMATIC. `creditForUserId` is supplied by the caller because "use a credit
    //      or pay for this one" is a CHOICE the booking screen offers — to staff and to the client
    //      alike. Spending one silently because the person happened to have one would take a
    //      decision about their money without asking.
    //   ★ A person with no spendable credit is NOT an error: `reserveCreditForBooking` returns null
    //     and the booking stands, unpaid-for, which is a real and permitted state. The caller learns
    //     which happened from `creditReserved` on the result.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    let creditReserved = null;
    if (creditForUserId) {
      creditReserved = await reserveCreditForBooking(tx, {
        tenantId, ownerUserId: creditForUserId, serviceId, bookingId: rows[0].id,
        bookingStartsAt: startsAt,      // ★ credits defect 20: a credit that expires before the SESSION cannot pay for it
      });
    }
    return { ...rows[0], creditReserved };
  } catch (e) {
    // ★★ Translate the constraint violation rather than letting a SQLSTATE reach a booking page.
    // ★ This is also the path that proves guard 1 is real: if guard 2 were the only thing
    // stopping doubles, this branch would never be reached under concurrency — and P7.7 measures
    // exactly that by disabling guard 2 and checking that this still fires.
    if (e.code === EXCLUSION_VIOLATION) {
      throw new SlotTakenError('That time was just booked. Choose another slot.');
    }
    throw e;
  }
}

/**
 * ★★ Cancel, and return the reserved entitlement credit, if one was reserved.
 * §B4 STEP 6's check is that the credit returns **EXACTLY ONCE** — so the return is expressed as a
 * conditional UPDATE whose `rowCount` IS the evidence, rather than a read-then-write.
 */
export async function cancelBooking(tx, { tenantId, bookingId, actorUserId = null }) {
  const cancelled = await tx.query(
    `UPDATE keystone.booking
        SET state = 'cancelled', cancelled_at = now()
      WHERE tenant_id = $1 AND id = $2 AND state <> 'cancelled'
      RETURNING id`,
    [tenantId, bookingId]);

  // ★★★ IDEMPOTENT BY CONSTRUCTION. A second cancel updates ZERO rows, so it cannot reach the
  // credit release below. "Exactly once" is enforced by the predicate `state <> 'cancelled'`,
  // not by the caller remembering not to call twice.
  if (cancelled.rowCount === 0) {
    return { cancelled: false, creditsReturned: 0, entitlementCreditReturned: 0 };
  }

  // ★ In the SAME transaction as the cancellation and INSIDE the exactly-once guard above: a
  //   second cancel updates zero booking rows and returns before reaching this line, so a credit
  //   cannot be returned twice.
  const creditReturned = await returnCreditForBooking(tx, { tenantId, bookingId });
  const n = creditReturned ? 1 : 0;

  // ★★★ EMITTED ONLY ON THE REAL TRANSITION. The zero-row early return above has already left, so
  //     reaching this line means a booking DID move to cancelled exactly once. A second cancel
  //     emits nothing — the same "exactly once" property the predicate gives the write. Getting it
  //     wrong would put duplicate cancellations in the feed for one booking.
  // ★ `credits_returned` is in the payload because a consumer cannot derive it: the credit rows have
  //   already been cleared by the time anything reads them, so the count exists only here.
  await emit(tx, {
    tenantId,
    topic: "booking.booking.cancelled",
    emittedBy: "booking",
    subjectType: "booking",
    subjectId: bookingId,
    // ★ FIX ROUND 1, I1 — see the note in `createBooking` above.
    actor: userActor(actorUserId),
    payload: {
      credits_returned: n,
      // ★ FIX, 30 Sep 2026 ("credit-used/returned email" brief) — same reasoning as
      //   `credits_returned` above: the credit row is already cleared by the time a listener could
      //   look it up, so the entitlement id travels in the payload or is lost.
      credit_returned: creditReturned ? { entitlement_id: creditReturned.entitlement_id } : null,
    },
  });

  // ★ FIX, 30 Sep 2026 ("credit-used/returned email" brief) — a DEDICATED event, not a listener on
  //   `booking.booking.cancelled` above: that topic already has its own "your session was
  //   cancelled" notification (`notifyCancelledFrom`, src/queue/tasks.mjs), and a client whose
  //   credit came back gets a SECOND, separate email about that fact, not a silently different
  //   cancellation email replacing the first.
  if (creditReturned) {
    await emit(tx, {
      tenantId,
      topic: "booking.booking.credit_returned",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: bookingId,
      actor: userActor(actorUserId),
      payload: { entitlement_id: creditReturned.entitlement_id },
    });
  }

  return {
    cancelled: true,
    creditsReturned: n,
    entitlementCreditReturned: n,
  };
}
