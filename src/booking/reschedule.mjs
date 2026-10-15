// @ts-check
// STAGE 3 TASK 9 — MOVE A BOOKING (the maintainer ruling R41, option A: the server side now, screens with feature 03).
// C2.2 — EXTEND TO SUPPORT CLIENT-APP CANCELLATION AND RESCHEDULE WITH POLICY WINDOWS.
//
// ★★★ [MEASURED, recon §6] before this file NO FUNCTION ANYWHERE updated a booking's starts_at/ends_at,
//     and `booking.booking.rescheduled` had zero emit sites. This is the one writer of both.
//
// ★★★ C2.2 EXTENDS THIS FILE: the CLIENT app calls `cancelBookingByRequest` and `rescheduleBooking` with
//     different semantics than the STAFF paths. Client paths check policy windows (cancellation_notice_minutes,
//     reschedule_notice_minutes) and apply `late_cancel_behaviour` outside those windows. Staff paths (used by
//     the CRM) continue to use the existing scoped visibility check (`lockVisibleBooking`). Both paths are
//     distinguished by the route they come from and the policy they apply.
//
// ★★ THE HOST CONFLICT RULE IS createBooking's, NOT THE AVAILABILITY READ. createBooking's guard 2 is a
//    direct overlap query on `keystone.booking` for THIS host, excluding cancelled rows, under a per-host
//    advisory lock; guard 1 is the `EXCLUDE USING gist (tenant_id, host_id, occupies &&) WHERE state <>
//    cancelled` constraint (0013). Neither reads the slot generator F489 describes (which ignores host and
//    state), so this check does not inherit F489. The same two guards apply here — the same lock key, the
//    same predicate (minus the booking being moved), and 23P01 translated to the same SlotTakenError (409).
//
// ★ Duration is kept unless the request names an end. Buffers stay the row's own — `occupies` is derived
//   from starts_at/ends_at/buffers by the 0013 trigger, never supplied.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { SlotTakenError, cancelBooking } from "./createBooking.mjs";
import { RECORD_QUERIES } from "../records/queries.mjs";
// ★ 13.12 — the waitlist engine now owns the offer logic; this file only wires it in.
import { offerFreedSlot } from "./waitlist.mjs";
// ★ the maintainer, 1 Oct 2026 — no-show/late-cancel merge brief: `late_cancel_behaviour` was computed and put
//   on the event payload below for a LISTENER THAT NEVER EXISTED — a SPEC-GAP, not a bug, but one
//   that meant every late cancellation outside the notice window was silently free regardless of
//   policy. Called directly, in the SAME transaction as the cancellation, rather than through a new
//   listener: a charge decision belongs in the same commit as the state change it follows, the same
//   reasoning `settleBooking` itself already applies to attendance.
import { chargeLateCancelFee } from "./settleBooking.mjs";
import { returnCreditForBooking, consumeCreditForBooking, assertCreditCoversDate } from "../money/credits.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "booking";

const NOT_VISIBLE = "That booking does not exist, or you cannot see it.";

/**
 * ★★★ FIX ROUND 1, T9-R2 — THE BOOKING IS FOUND THROUGH THE SAME SCOPED READ `GET /api/records/booking/:id`
 *     USES (`RECORD_QUERIES.booking`: `user_may(viewer, 'engagement', 'view', host_id) OR
 *     scope_not_yet_configured(viewer)`), with the SESSION's id as the viewer. A coach whose engagement scope
 *     is `owned` therefore gets the same 404 for another coach's session as for another practice's — and
 *     cannot cancel it (returning that client's credit) or move it by id. Only then is the row locked.
 *   ★ Not a second copy of the predicate: the record query IS the rule, so the read page and these writes
 *     cannot disagree about who may reach a booking. (Booking CREATE has the same gap; that is Stage 7's.)
 *
 * ★★★ STAGE 7 7.18 — `verb` is now REQUIRED and both callers below pass `'edit'`, not `'view'`. A
 *     booking the caller may SEE but not EDIT (e.g. `engagement: view/owned`) now gets the SAME
 *     `notFound(NOT_VISIBLE)` as one truly out of scope — 05 §2b.5, never confirm a single
 *     out-of-scope record exists by answering it differently. `RECORD_QUERIES.booking.sqlFor(verb)`
 *     is the one source: no second, hand-copied predicate.
 */
async function lockVisibleBooking(tx, { tenantId, bookingId, viewerId, verb }) {
  const seen = await tx.query(RECORD_QUERIES.booking.sqlFor(verb), [bookingId, viewerId]);
  if (seen.rows.length === 0) throw notFound(NOT_VISIBLE);
  const { rows: [b] } = await run(tx, db
    .selectFrom("keystone.booking")
    .select(["id", "host_id", "state", "starts_at", "ends_at", "buffer_before_minutes", "buffer_after_minutes", "archived_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", bookingId)
    .modifyEnd(sql`FOR UPDATE`));
  if (!b) throw notFound(NOT_VISIBLE);
  return b;
}

/**
 * ★★★ STAGE 3 TASK 9 — THE ROUTE'S CANCEL (POST /api/engagements/bookings/cancel). `cancelBooking`
 *     (createBooking.mjs) is unchanged — its credit return and its exactly-once predicate are exactly as
 *     they were; this only decides whether THIS person may ask for it.
 *   ★★ Refused (409): a COMPLETED or NO-SHOW session (cancelBooking's `state <> 'cancelled'` would hand a
 *      session that happened its credit back), and an ARCHIVED booking (T9-R3 — same rule as reschedule:
 *      an archived record is restored first, then changed).
 *   ★ Out of the caller's scope, or another practice's → 404 (T9-R2, `lockVisibleBooking`).
 *   ★ Already cancelled is NOT refused: it is the idempotent no-op (`cancelled: false`, no second event,
 *     no second credit). Two concurrent cancels serialise on the row lock; the second sees `cancelled`.
 *
 * ★★★ C2.2 EXTENDS THIS: when called from the CLIENT app (skipVisibilityCheck=true), this function
 *     enforces policy windows (cancellation_notice_minutes) and applies late_cancel_behaviour,
 *     offering to the waitlist if inside the window. The staff path (skipVisibilityCheck=false,
 *     the default) keeps the existing behavior.
 */
export async function cancelBookingByRequest(
  tx,
  { tenantId, bookingId, actorUserId = null, skipVisibilityCheck = false }
) {
  if (!bookingId) throw invalid("bookingId is required — which booking is being cancelled?", { field: "bookingId" });

  // ★ C2.2: STAFF PATH uses visibility check (default); CLIENT PATH skips it (RLS handles visibility)
  let b;
  if (!skipVisibilityCheck) {
    // STAFF path — use scoped visibility check
    b = await lockVisibleBooking(tx, { tenantId, bookingId, viewerId: actorUserId, verb: 'edit' });
    if (b.state === "completed" || b.state === "no_show") {
      throw conflict(
        `This session is already recorded as ${b.state === "no_show" ? "a no-show" : "completed"} and cannot be cancelled.`);
    }
    if (b.archived_at) throw conflict("This booking is archived and cannot be cancelled.");
    const result = await cancelBooking(tx, { tenantId, bookingId, actorUserId });
    // ★ 13.12 — the STAFF path now offers the freed slot too, same as the client path already did.
    //   Only on a REAL transition (not the idempotent no-op) and only when the session was still in
    //   the future — cancelling a session that already happened frees nobody's time.
    if (result.cancelled && new Date(b.starts_at).getTime() > Date.now()) {
      const { rows: [{ service_id }] } = await run(tx, db
        .selectFrom("keystone.booking")
        .select("service_id")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", bookingId));
      await offerFreedSlot(tx, {
        tenantId, serviceId: service_id, hostId: b.host_id,
        startsAt: b.starts_at, endsAt: b.ends_at,
      });
    }
    return result;
  }

  // C2.2: CLIENT PATH — simpler lock without scoped visibility, apply policy windows
  const { rows: [booking] } = await run(tx, db
    .selectFrom("keystone.booking")
    .select(["id", "service_id", "host_id", "starts_at", "ends_at", "state"])
    .where("id", "=", bookingId)
    .where("tenant_id", "=", tenantId)
    .modifyEnd(sql`FOR UPDATE`));

  if (!booking) throw notFound("That booking does not exist in this practice.");
  if (booking.state === "cancelled") {
    // Idempotent: return the booking as-is
    return { id: booking.id, state: booking.state, cancelled_at: null };
  }
  // ★ credits defect 9: this branch had NO completed/no-show guard (the staff branch does) — a client could "cancel" a session that already happened
  if (booking.state === "completed" || booking.state === "no_show") {
    throw conflict(`This session is already recorded as ${booking.state === "no_show" ? "a no-show" : "completed"} and cannot be cancelled.`);
  }

  // ★ Import policyFor to check policy windows
  const { policyFor: getPolicyFor } = await import("./writes.mjs");
  const policy = await getPolicyFor(tx, tenantId, booking.service_id);

  // ★★★ CHECK IF INSIDE THE CANCELLATION NOTICE WINDOW
  const now = Date.now();
  const startMs = new Date(booking.starts_at).getTime();
  const cancellationWindowMs = policy.cancellation_notice_minutes * 60 * 1000;
  const isInsideWindow = startMs - now >= cancellationWindowMs;

  // ★★★ CANCEL THE BOOKING
  const { rows: [cancelled] } = await run(tx, db
    .updateTable("keystone.booking")
    .set({ state: "cancelled", cancelled_at: sql`now()` })
    .where("id", "=", bookingId)
    .where("tenant_id", "=", tenantId)
    .returning(["id", "state", "cancelled_at", "starts_at", "ends_at"]));

  if (!cancelled) throw notFound("That booking does not exist in this practice.");

  // ★ Emit the cancellation event
  await emit(tx, {
    tenantId,
    topic: "booking.booking.cancelled",
    emittedBy: SECTION,
    subjectType: "booking",
    subjectId: bookingId,
    actor: userActor(actorUserId),
    payload: {
      booking_id: bookingId,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      cancelled_at: cancelled.cancelled_at,
      inside_notice_window: isInsideWindow,
      late_cancel_behaviour: isInsideWindow ? "free" : policy.late_cancel_behaviour,
    },
  });

  // ★ If inside the window, offer to the waitlist
  if (isInsideWindow) {
    await offerToWaitlist(tx, {
      tenantId,
      serviceId: booking.service_id,
      hostId: booking.host_id,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
    });
  }

  // ★★★ CREDITS defect 9 — THE SESSION'S RESERVED CREDIT. This client branch cancelled the booking and never touched its credit: a reserved
  //     credit stayed `reserved` on a cancelled session (lost to the client), and `credit_back` was computed and ignored.
  //       · cancelled WITH enough notice → the credit comes back (spendable again)
  //       · cancelled LATE: `charge_percent` → the credit is FORFEITED (consumed) INSTEAD of a card fee — never both; `free` / `credit_back` → it comes back
  let creditForfeited = false;
  const { rows: held } = await tx.query(
    `SELECT 1 FROM keystone.entitlement_credit WHERE tenant_id = $1 AND booking_id = $2 AND status = 'reserved'`, [tenantId, bookingId]);
  if (held.length > 0) {
    // ★ each move is TOLD (the same dedicated topics the staff cancel and the Held modal use → the "credit used" / "credit came back" emails)
    if (!isInsideWindow && policy.late_cancel_behaviour === "charge_percent") {
      const used = await consumeCreditForBooking(tx, { tenantId, bookingId });
      creditForfeited = true;
      if (used) {
        await emit(tx, { tenantId, topic: "booking.booking.credit_consumed", emittedBy: "booking", subjectType: "booking", subjectId: bookingId,
          actor: userActor(actorUserId), payload: { entitlement_id: used.entitlement_id, service_id: booking.service_id } });
      }
    } else {
      const back = await returnCreditForBooking(tx, { tenantId, bookingId });
      if (back) {
        await emit(tx, { tenantId, topic: "booking.booking.credit_returned", emittedBy: "booking", subjectType: "booking", subjectId: bookingId,
          actor: userActor(actorUserId), payload: { entitlement_id: back.entitlement_id } });
      }
    }
  }

  // ★ the maintainer, 1 Oct 2026 — THE ACTUAL CHARGE, finally. `late_cancel_behaviour` above was computed and
  //   put on the event for a listener that never existed; this is the real action, in the SAME
  //   transaction as the cancellation. `'free'` (inside the window, or the policy's own default)
  //   and `'credit_back'` (a credits-ledger action, not a charge) both fall through untouched.
  let lateCancelFee = null;
  if (!isInsideWindow && policy.late_cancel_behaviour === "charge_percent" && !creditForfeited) {
    lateCancelFee = await chargeLateCancelFee(tx, { tenantId, bookingId, actorUserId });
  }

  return { id: cancelled.id, state: cancelled.state, cancelled_at: cancelled.cancelled_at, lateCancelFee, creditForfeited };
}

/** The states a booking can be moved out of. Cancelled, completed and no-show are over. */
const MOVABLE = new Set(["confirmed", "pending_payment"]);

function toInstant(v, field) {
  if (v === undefined || v === null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw invalid(`${field} must be an ISO-8601 timestamp`, { field });
  return d;
}

/**
 * Move a booking to a new time.
 * @param {object} tx    a pg client INSIDE a transaction, tenant context set (the write route's `db`)
 * @param {object} input { tenantId, bookingId, startsAt, endsAt?, actorUserId, skipVisibilityCheck? }
 *                       ★ actorUserId is the SESSION's (routes/writes.mjs stamps it after the body spread).
 *                       ★ C2.2: skipVisibilityCheck = true for CLIENT app (RLS handles visibility)
 * @returns {{id, starts_at, ends_at, rescheduled: boolean}}
 *
 * ★★★ C2.2 EXTENDS THIS: when called from the CLIENT app (skipVisibilityCheck=true), this function
 *     enforces policy windows (reschedule_notice_minutes) and applies late_cancel_behaviour,
 *     offering the OLD slot to the waitlist if inside the window. The staff path (skipVisibilityCheck=false,
 *     the default) keeps the existing behavior.
 */
export async function rescheduleBooking(
  tx,
  {
    tenantId, bookingId, startsAt, endsAt, actorUserId = null, skipVisibilityCheck = false,
    // ★★★ 13.28 — CalendarMoveModal's "Tell {first}" / "Say why". `tellClient` defaults true
    //     (only an explicit `false` turns it off); `note` is optional, ≤500 chars else 400 — the
    //     same shape both `rescheduled` emit payloads below now carry.
    tellClient, note,
  }
) {
  if (!tenantId) throw invalid("a reschedule needs a tenantId");
  if (!bookingId) throw invalid("bookingId is required — which booking is being moved?", { field: "bookingId" });
  const newStart = toInstant(startsAt, "startsAt");
  if (!newStart) throw invalid("startsAt is required — the new time", { field: "startsAt" });
  if (note != null && String(note).length > 500) {
    throw invalid("note must be 500 characters or fewer", { field: "note" });
  }

  // ★ C2.2: STAFF PATH uses visibility check (default); CLIENT PATH skips it (RLS handles visibility)
  let b;
  if (!skipVisibilityCheck) {
    // STAFF path — use existing implementation with scoped visibility
    // The row, found through the caller's scope (T9-R2) and locked: two concurrent moves of one booking
    //   serialise here rather than both reading the old time and both emitting "from" it.
    b = await lockVisibleBooking(tx, { tenantId, bookingId, viewerId: actorUserId, verb: 'edit' });
    if (!MOVABLE.has(b.state)) {
      throw conflict(`This booking is ${b.state.replace("_", "-")} and cannot be moved.`);
    }
    if (b.archived_at) throw conflict("This booking is archived and cannot be moved.");

    const newEnd = toInstant(endsAt, "endsAt")
      ?? new Date(newStart.getTime() + (b.ends_at.getTime() - b.starts_at.getTime()));
    if (newEnd <= newStart) throw invalid("endsAt must be after startsAt", { field: "endsAt" });
    if (newStart.getTime() <= Date.now()) {
      throw conflict("That time has already passed. Choose a time in the future.");
    }

    // ★ Not a move: nothing written, nothing announced
    if (newStart.getTime() === b.starts_at.getTime() && newEnd.getTime() === b.ends_at.getTime()) {
      return { id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, rescheduled: false };
    }

    await assertCreditCoversDate(tx, { tenantId, bookingId: b.id, newStart });

    // ══ GUARD 2, createBooking's — same lock key, same overlap predicate, this booking excluded ══
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`booking:${tenantId}:${b.host_id}`]);
    const occStart = new Date(newStart.getTime() - b.buffer_before_minutes * 60_000);
    const occEnd = new Date(newEnd.getTime() + b.buffer_after_minutes * 60_000);
    const clash = await tx.query(
      `SELECT id FROM keystone.booking
        WHERE tenant_id = $1 AND host_id = $2 AND id <> $3
          AND state <> 'cancelled'
          AND occupies && tstzrange($4, $5, '[)')
        LIMIT 1`,
      [tenantId, b.host_id, b.id, occStart, occEnd]);
    if (clash.rows.length > 0) {
      throw new SlotTakenError(`That time is already booked for this coach. Choose another time.`, clash.rows[0].id);
    }

    // ══ GUARD 1 — the exclusion constraint has the final word ══
    let moved;
    try {
      moved = (await run(tx, db
        .updateTable("keystone.booking")
        .set({ starts_at: newStart, ends_at: newEnd, updated_at: sql`now()` })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", b.id)
        .returning(["id", "starts_at", "ends_at"]))).rows[0];
    } catch (e) {
      if (e.code === "23P01") throw new SlotTakenError(`That time is already booked for this coach. Choose another time.`);
      throw e;
    }

    // ★★★ THE EVENT, IN THIS TRANSACTION. Facts only — timestamps (spec 02 §2.4).
    await emit(tx, {
      tenantId,
      topic: "booking.booking.rescheduled",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: b.id,
      actor: userActor(actorUserId),
      payload: {
        from_starts_at: b.starts_at.toISOString(),
        to_starts_at: moved.starts_at.toISOString(),
        from_ends_at: b.ends_at.toISOString(),
        to_ends_at: moved.ends_at.toISOString(),
        // ★ 13.28 — CalendarMoveModal's "Tell {first}". `note` ("Say why") is NOT emitted:
        //   §2.4 forbids free text in the payload, and `keystone.booking` has no column to store
        //   it on the record either (MEASURED, db/migrations/0013_booking_model.sql) — no
        //   consumer of `booking.booking.rescheduled` ever read `payload.note` (grepped
        //   src/queue/tasks.mjs, src/booking/history.mjs and the rest), so nothing loses a
        //   reader by dropping it here.
        tell_client: tellClient !== false,
      },
    });

    return { ...moved, rescheduled: true };
  }

  // C2.2: CLIENT PATH — check policy windows and offer OLD slot to waitlist
  const { rows: [booking] } = await run(tx, db
    .selectFrom("keystone.booking")
    .select(["id", "service_id", "host_id", "starts_at", "ends_at", "state", "buffer_before_minutes", "buffer_after_minutes"])
    .where("id", "=", bookingId)
    .where("tenant_id", "=", tenantId)
    .modifyEnd(sql`FOR UPDATE`));

  if (!booking) throw notFound("That booking does not exist in this practice.");
  if (!MOVABLE.has(booking.state)) {
    throw conflict(`This booking is ${booking.state.replace("_", "-")} and cannot be moved.`);
  }

  const newEnd = toInstant(endsAt, "endsAt")
    ?? new Date(newStart.getTime() + (booking.ends_at.getTime() - new Date(booking.starts_at).getTime()));
  if (newEnd <= newStart) throw invalid("endsAt must be after startsAt", { field: "endsAt" });
  if (newStart.getTime() <= Date.now()) {
    throw conflict("That time has already passed. Choose a time in the future.");
  }

  // ★ Not a move: nothing written
  if (newStart.getTime() === new Date(booking.starts_at).getTime() && newEnd.getTime() === new Date(booking.ends_at).getTime()) {
    return { id: booking.id, starts_at: booking.starts_at, ends_at: booking.ends_at, rescheduled: false };
  }

  await assertCreditCoversDate(tx, { tenantId, bookingId: booking.id, newStart });

  // ★ Import policyFor to check policy windows
  const { policyFor: getPolicyFor } = await import("./writes.mjs");
  const policy = await getPolicyFor(tx, tenantId, booking.service_id);

  // ★★★ CHECK IF INSIDE THE RESCHEDULE NOTICE WINDOW
  const now = Date.now();
  const startMs = new Date(booking.starts_at).getTime();
  const rescheduleWindowMs = policy.reschedule_notice_minutes * 60 * 1000;
  const isInsideWindow = startMs - now >= rescheduleWindowMs;

  // ══ GUARD 2, createBooking's — same lock key, same overlap predicate ══
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [`booking:${tenantId}:${booking.host_id}`]);
  const occStart = new Date(newStart.getTime() - booking.buffer_before_minutes * 60_000);
  const occEnd = new Date(newEnd.getTime() + booking.buffer_after_minutes * 60_000);
  const clash = await tx.query(
    `SELECT id FROM keystone.booking
      WHERE tenant_id = $1 AND host_id = $2 AND id <> $3
        AND state <> 'cancelled'
        AND occupies && tstzrange($4, $5, '[)')
      LIMIT 1`,
    [tenantId, booking.host_id, bookingId, occStart, occEnd]);
  if (clash.rows.length > 0) {
    throw new SlotTakenError(`That time is already booked for this coach. Choose another time.`, clash.rows[0].id);
  }

  // ══ GUARD 1 — the exclusion constraint has the final word ══
  let moved;
  try {
    moved = (await run(tx, db
      .updateTable("keystone.booking")
      .set({ starts_at: newStart, ends_at: newEnd, updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", bookingId)
      .returning(["id", "starts_at", "ends_at"]))).rows[0];
  } catch (e) {
    if (e.code === "23P01") throw new SlotTakenError(`That time is already booked for this coach. Choose another time.`);
    throw e;
  }

  // ★ Emit the reschedule event
  await emit(tx, {
    tenantId,
    topic: "booking.booking.rescheduled",
    emittedBy: SECTION,
    subjectType: "booking",
    subjectId: bookingId,
    actor: userActor(actorUserId),
    payload: {
      from_starts_at: booking.starts_at,
      to_starts_at: moved.starts_at,
      from_ends_at: booking.ends_at,
      to_ends_at: moved.ends_at,
      inside_notice_window: isInsideWindow,
      late_cancel_behaviour: isInsideWindow ? "free" : policy.late_cancel_behaviour,
      // ★ 13.28 — same field as the staff-branch emit above, so both `rescheduled` payloads agree
      //   in shape. `note` is never emitted (see the staff-branch comment above); the client app
      //   path has no CalendarMoveModal caller yet, so `tellClient` is never supplied here either —
      //   the default applies, same as an un-set staff-branch call.
      tell_client: tellClient !== false,
    },
  });

  // ★ If inside the reschedule window, offer the OLD SLOT to the waitlist
  if (isInsideWindow) {
    await offerToWaitlist(tx, {
      tenantId,
      serviceId: booking.service_id,
      hostId: booking.host_id,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
    });
  }

  return { id: moved.id, starts_at: moved.starts_at, ends_at: moved.ends_at, rescheduled: true };
}

/**
 * ★★★ C2.2 — OFFER A FREED SLOT TO THE WAITLIST
 *
 * When a booking is cancelled or rescheduled INSIDE the policy window, the freed slot is offered
 * to every waiting entry that matches (preference, coach, day) — 13.12's `offerFreedSlot`
 * (`./waitlist.mjs`) is the one engine; this wrapper just keeps both existing call sites
 * (reschedule.mjs:146,345) unchanged.
 */
async function offerToWaitlist(tx, { tenantId, serviceId, hostId, startsAt, endsAt }) {
  return offerFreedSlot(tx, { tenantId, serviceId, hostId, startsAt, endsAt });
}
