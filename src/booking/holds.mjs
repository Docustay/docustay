// @ts-check
// B-3 — the two moves out of `pending_signature`.
// ★★★ CONTRACTS.md (specs/de-code/CONTRACTS.md) §3, verbatim:
//   `confirmHeldBookings(tx, { tenantId, instanceId })` → `{ confirmed: [bookingId] }` — every
//     `pending_signature` booking held by that instance (`document_instance.hold_booking_id`, 0524) → `confirmed`; emits
//     `booking.booking.confirmed`.
//   `releaseExpiredHolds(tx, { tenantId, now })` → `{ released: [bookingId] }` — `pending_signature`
//     with `hold_expires_at < now` → `cancelled`, `cancellation_reason='signature_not_received'`;
//     credit returned (`returnCreditForBooking`); emits `booking.booking.hold_released`.
// Topics `booking.booking.held` / `booking.booking.hold_released` already exist in
// `src/events/topics.mjs` TOPICS.booking (T0.1) — nothing here adds to that catalogue.
//
// ★ EXACTLY-ONCE BY THE SAME IDIOM `createBooking.mjs`'s own `cancelBooking` already uses: the
//   transition is expressed as an UPDATE whose own WHERE re-asserts the state it is moving FROM, and
//   its `rowCount` (via `RETURNING id`) is the only thing that decides whether the credit-return/
//   event for that row fires. A second call, or two callers racing the same row, updates zero rows
//   the second time and does nothing further — it does not need a lock to be safe.

import { emit } from "../events/outbox.mjs";
import { returnCreditForBooking } from "../money/credits.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { heldBookingIdFor } from "../documents/api.mjs";

/**
 * confirmHeldBookings(tx, { tenantId, instanceId }) → { confirmed: [bookingId] }
 *
 * Called when `instanceId` (a coaching-agreement document) is executed — every booking that was
 * held waiting for THIS instance moves to `confirmed`.
 */
export async function confirmHeldBookings(tx, { tenantId, instanceId }) {
  // ★ R15 (RECONCILE, 0524) — the pointer is on the document: the booking this executed instance holds.
  //   Visible with no viewer through 0524's `system_hold_read` (executed + hold_booking_id set).
  const heldBookingId = await heldBookingIdFor(tx, { tenantId, instanceId });
  const { rows } = heldBookingId
    ? await run(tx, db
        .selectFrom("keystone.booking")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("state", "=", "pending_signature")
        .where("id", "=", heldBookingId))
    : { rows: [] };

  const confirmed = [];
  for (const { id: bookingId } of rows) {
    const { rowCount } = await tx.query(
      `UPDATE keystone.booking
          SET state = 'confirmed'
        WHERE tenant_id = $1 AND id = $2 AND state = 'pending_signature'
        RETURNING id`,
      [tenantId, bookingId]);
    if (rowCount === 0) continue; // ★ raced with something else — already moved on, nothing to do.

    await emit(tx, {
      tenantId,
      topic: "booking.booking.confirmed",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: bookingId,
      actor: "worker",
      payload: { hold_instance_id: instanceId },
    });
    confirmed.push(bookingId);
  }
  return { confirmed };
}

/**
 * releaseExpiredHolds(tx, { tenantId, now }) → { released: [bookingId] }
 *
 * The sweep's own call — every `pending_signature` booking whose hold expired before `now` is
 * cancelled with a reason that names WHY (not a generic cancellation), and any credit reserved
 * against it comes back, same as any other cancelled booking (`cancelBooking`'s own reasoning).
 */
export async function releaseExpiredHolds(tx, { tenantId, now }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("state", "=", "pending_signature")
    .where("hold_expires_at", "<", now));

  const released = [];
  for (const { id: bookingId } of rows) {
    const { rowCount } = await tx.query(
      `UPDATE keystone.booking
          SET state = 'cancelled', cancelled_at = now(), cancellation_reason = 'signature_not_received'
        WHERE tenant_id = $1 AND id = $2 AND state = 'pending_signature'
        RETURNING id`,
      [tenantId, bookingId]);
    if (rowCount === 0) continue; // ★ raced — already moved on (confirmed or cancelled elsewhere).

    const creditReturned = await returnCreditForBooking(tx, { tenantId, bookingId });

    await emit(tx, {
      tenantId,
      topic: "booking.booking.hold_released",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: bookingId,
      actor: "worker",
      // ★ FIX, 30 Sep 2026 ("credit-used/returned email" brief) — `credit_returned` carries the
      //   entitlement so a listener can email the client without re-deriving it (the credit row is
      //   already cleared to 'returned' by the time anything downstream could look it up).
      payload: {
        cancellation_reason: "signature_not_received",
        credit_returned: creditReturned ? { entitlement_id: creditReturned.entitlement_id } : null,
      },
    });

    // ★ FIX, 30 Sep 2026 — same dedicated topic as the cancel path (createBooking.mjs): a
    //   released hold has no OTHER client-facing email today, but the same "one topic, one email"
    //   shape applies — the credit-returned fact gets its own event either way.
    if (creditReturned) {
      await emit(tx, {
        tenantId,
        topic: "booking.booking.credit_returned",
        emittedBy: "booking",
        subjectType: "booking",
        subjectId: bookingId,
        actor: "worker",
        payload: { entitlement_id: creditReturned.entitlement_id },
      });
    }
    released.push(bookingId);
  }
  return { released };
}
