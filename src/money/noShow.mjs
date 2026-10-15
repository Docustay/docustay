// @ts-check
// Stage 15 task 15.30 — NO-SHOW CHARGE LISTENER
//
// ★★★ THIS FUNCTION IS A LISTENER BODY ONLY. It does not register itself.
// Task 15.37 (`planListeners` consumer) registers it via the event listener system.
// Do not call `emit()` here — the booking.booking.completed event has already fired
// and this consumer reads its payload, not generates a new topic.

import { asPracticeOwner } from "./asPracticeOwner.mjs";
import { createInvoice } from "./writes.mjs";
import { createLineItem } from "./writes.mjs";
import { sendInvoice } from "./invoiceSend.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { claimBookingFee } from "./bookingFeeClaim.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same LIMIT, same parameterization).
import { db, run } from "../db/kysely.mjs";

/**
 * ★★★ RAISE A NO-SHOW CHARGE — LISTENER BODY FOR booking.booking.completed.
 *
 * @param tx           the transaction (tenant-scoped)
 * @param ev           the event with { payload: { outcome, charge: {percent, ...}, service_id }, subjectId: bookingId }
 * @param {object} ctx { tenantId }
 *
 * @returns {null | {waived: true} | {invoiceId, amountMinor}} or null if already raised
 */
export async function raiseNoShowCharge(tx, ev, { tenantId }) {
  // ── Branch 1: Not a no-show outcome — nothing to do
  if (ev.payload.outcome !== "no_show") {
    return null;
  }

  const percent = ev.payload.charge.percent;

  // ── Branch 2: Waived — no invoice to raise
  if (percent === 0) {
    return { waived: true };
  }

  const bookingId = ev.subjectId;

  // ★★★ the maintainer, 1 Oct 2026 — THE MERGE, THE OTHER HALF (see settleBooking.mjs's own header for the
  //     full story). This used to check "does an invoice line item already reference this
  //     booking" — which MISSED every no-show settled by CARD or CREDIT through the interactive
  //     modal (neither creates a line item), so this listener would raise a SECOND charge for a
  //     session already paid. `claimBookingFee` is the one shared gate both paths now go through;
  //     claimed here BEFORE any read of the booking, so a lost race costs nothing beyond the claim
  //     row itself.
  const claimed = await claimBookingFee(tx, { tenantId, bookingId, feeType: "no_show" });
  if (!claimed) {
    return null;
  }

  // ── Read the booking as the practice owner ──────────────────────────────────────────────────
  // ★★★ ALL MONEY OPERATIONS RUN AS THE OWNER. A charge decision affects the practice's balance,
  //     never a person's permission to change accounts. The owner is the only role whose permission
  //     to do this cannot be delegated — a staff member can act ON BEHALF OF the owner, but the
  //     owner is the one making the decision.
  const bookingData = await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    const { rows } = await run(ownerTx, db
      .selectFrom("keystone.booking")
      .select(["id", "price_id", "service_id"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", bookingId));
    if (rows.length === 0) throw new Error(`Booking ${bookingId} not found`);
    return rows[0];
  });

  // ── Read the price row to get the session fee amount ────────────────────────────────────────
  const priceData = await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    if (!bookingData.price_id) {
      throw new Error(`Booking ${bookingId} has no price_id snapshot — cannot compute charge`);
    }
    const { rows } = await run(ownerTx, db
      .selectFrom("keystone.price")
      .select(["id", "amount_minor"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", bookingData.price_id));
    if (rows.length === 0) {
      throw new Error(`Price ${bookingData.price_id} not found for booking ${bookingId}`);
    }
    return rows[0];
  });

  // ── Find the paying participant: the client on this booking ──────────────────────────────────
  const clientParticipant = await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    const { rows } = await run(ownerTx, db
      .selectFrom("keystone.booking_participant")
      .select(["id", "app_user_id"])
      .where("tenant_id", "=", tenantId)
      .where("booking_id", "=", bookingId)
      .where("party", "=", "client")
      .limit(1));
    if (rows.length === 0) {
      throw new Error(`No client participant found for booking ${bookingId}`);
    }
    return rows[0];
  });

  // ── Compute the charge amount ──────────────────────────────────────────────────────────────
  const chargeAmount = Math.round(priceData.amount_minor * percent / 100);

  // ── Read the service name for context ──────────────────────────────────────────────────────────
  const serviceName = await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    const { rows } = await run(ownerTx, db
      .selectFrom("keystone.service")
      .select(["name"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", bookingData.service_id));
    if (rows.length === 0) return "Session";
    return rows[0].name;
  });

  // ── Check if client has an active subscription ───────────────────────────────────────────────
  // ★ If active subscription exists, the fee lands on the NEXT INVOICE as a Stripe InvoiceItem.
  //   Otherwise, create a one-off invoice (existing path).
  const { rows: subRows } = await run(tx, db
    // ★ STRIPE MIRROR (0574) — "active" is Stripe's word (subscription_effective).
    .selectFrom("keystone.subscription_effective")
    .select(["id", "stripe_subscription_id"])
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", clientParticipant.app_user_id)
    .where("state", "=", "active")
    .limit(1));

  const hasActiveSubscription = subRows.length > 0;

  if (hasActiveSubscription) {
    // ── FEE PATH 1: SUBSCRIBED → InvoiceItem on next invoice ──────────────────────────────────
    const subscription = subRows[0];

    // Create InvoiceItem on Stripe for the next invoice
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/invoiceitems",
      sdk: (s, o, form, query) => s.invoiceItems.create(form, o),
      form: {
        subscription: subscription.stripe_subscription_id,
        amount: String(chargeAmount),
        description: `Missed session — ${serviceName} (${percent}%)`,
      },
      movesMoney: false,
      purpose: "no_show_invoice_item",
      idempotencyKey: `no_show_item:${tenantId}:${bookingId}`,
    }, {});

    return {
      invoiceId: null,
      amountMinor: chargeAmount,
      path: "invoice_item",
    };
  }

  // ── FEE PATH 2: UNSUBSCRIBED → One-off invoice (existing path) ────────────────────────────
  const invoiceData = await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    return createInvoice(ownerTx, {
      tenantId,
      payerUserId: clientParticipant.app_user_id,
      amountMinor: chargeAmount,
      status: "draft",
      source: "no_show",
      title: "Missed session",
    });
  });

  // ── Create the line item ───────────────────────────────────────────────────────────────────────
  // ★ B-4 (F794) — `bookingId` travels on the line item as a REFERENCE (not a parent; the parent
  //   stays "invoice"), so `src/booking/history.mjs` can find this charge via
  //   `src/money/reads.mjs`'s `chargesForBookings` instead of `booking.invoice_id` (retired, 0513).
  await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    return createLineItem(ownerTx, {
      tenantId,
      parentType: "invoice",
      parentId: invoiceData.id,
      sourceType: "service",
      sourceId: bookingData.service_id,
      nameSnapshot: `Missed session — ${serviceName} (${percent}%)`,
      unitAmountMinor: chargeAmount,
      bookingId,
    });
  });

  // ── Send the invoice ───────────────────────────────────────────────────────────────────────────
  // ★ The invoice is drafted and has a line item, so sendInvoice will transition it to 'open'.
  await asPracticeOwner(tx, tenantId, async (ownerTx) => {
    return sendInvoice(ownerTx, { tenantId, invoiceId: invoiceData.id, actorUserId: null });
  });

  return {
    invoiceId: invoiceData.id,
    amountMinor: chargeAmount,
    path: "one_off",
  };
}
