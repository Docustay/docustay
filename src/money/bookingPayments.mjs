// Stage 15 Task 15.31 — BOOKING PAYMENT STEP
//
// Handle payment collection for public bookings: free, card-on-file setup, deposit, and full payment.

import { ensureCustomer } from "./customers.mjs";
import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { metadataFor } from "./metadata.mjs";

/**
 * Execute the payment step for a booking based on the payment mode.
 *
 * @param {object} tx database transaction
 * @param {object} options
 *   tenantId: practice id
 *   bookingId: the booking's id
 *   payerUserId: the person paying (the client)
 *   paymentMode: 'free' | 'card_on_file' | 'deposit' | 'pay_in_full'
 *   depositMinor: deposit amount in minor units (for 'deposit' mode)
 *   priceMinor: full service price in minor units (for 'pay_in_full' mode)
 * @returns {Promise<{kind, clientSecret} | null>}
 *   - null for 'free' (no payment needed)
 *   - {kind: "setup", clientSecret: "..."} for 'card_on_file' (SetupIntent)
 *   - {kind: "payment_intent", clientSecret: "..."} for 'deposit' or 'pay_in_full'
 * @throws {ChargePathDisabled} if 'deposit' or 'pay_in_full' with charges off
 */
export async function bookingPaymentStep(tx, {
  tenantId,
  bookingId,
  payerUserId,
  paymentMode,
  depositMinor = null,
  priceMinor = null,
}) {
  // ── Free bookings need no payment ──
  if (paymentMode === "free") {
    return null;
  }

  // ── Card on file: SetupIntent for future charges ──
  if (paymentMode === "card_on_file") {
    // Ensure the customer exists on Stripe
    const customer = await ensureCustomer(tx, { tenantId, personId: payerUserId });

    // Call Stripe to create a SetupIntent
    const meta = metadataFor("setup_intent", { keystone_booking_id: bookingId });
    const form = {
      customer: customer.customerId,
      usage: "off_session",
    };
    for (const [k, v] of Object.entries(meta)) {
      form[`metadata[${k}]`] = v;
    }
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/setup_intents",
      sdk: (s, o, form, query) => s.setupIntents.create(form, o),
      form,
      movesMoney: false,
      purpose: "booking_card_on_file",
    });

    return {
      kind: "setup",
      clientSecret: body.client_secret,
    };
  }

  // ── Deposit: PaymentIntent for deposit amount ──
  if (paymentMode === "deposit") {
    const meta = metadataFor("payment_intent", { keystone_booking_id: bookingId });
    const form = {
      amount: depositMinor,
      currency: "usd",
      application_fee_amount: applicationFeeMinor(depositMinor),
    };
    for (const [k, v] of Object.entries(meta)) {
      form[`metadata[${k}]`] = v;
    }
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/payment_intents",
      sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
      form,
      idempotencyKey: `book:${tenantId}:${bookingId}`,
      movesMoney: true,
      purpose: "booking_deposit",
    });

    return {
      kind: "payment_intent",
      clientSecret: body.client_secret,
    };
  }

  // ── Pay in full: PaymentIntent for full amount ──
  if (paymentMode === "pay_in_full") {
    const meta = metadataFor("payment_intent", { keystone_booking_id: bookingId });
    const form = {
      amount: priceMinor,
      currency: "usd",
      application_fee_amount: applicationFeeMinor(priceMinor),
    };
    for (const [k, v] of Object.entries(meta)) {
      form[`metadata[${k}]`] = v;
    }
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/payment_intents",
      sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
      form,
      idempotencyKey: `book:${tenantId}:${bookingId}`,
      movesMoney: true,
      purpose: "booking_pay_in_full",
    });

    return {
      kind: "payment_intent",
      clientSecret: body.client_secret,
    };
  }

  throw new Error(`Unknown paymentMode: ${paymentMode}`);
}
