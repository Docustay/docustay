// Stage 15 Task 15.24 — VIRTUAL TERMINAL: Create payment intents from practitioner entry
// Stage 20 Task 20.70 — STRIPE TERMINAL READER ACTIONS: process, cancel, display, refund
//
// The virtual terminal is a staff interface for entering charges manually (e.g., phone payment,
// check written after the fact). This module creates the payment intent, captures the payer's
// consent to save their card if requested, and returns the client secret for the frontend to
// complete payment.
//
// Stage 20 Task 20.70 adds the four Stripe Terminal reader action wrappers:
// - process_payment_intent: take a payment on a reader (movesMoney=true)
// - cancel_action: cancel a pending reader action (movesMoney=false)
// - set_reader_display: update the reader's display (movesMoney=false)
// - refund_payment: refund a charge taken on the reader (movesMoney=true)

import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { ensureCustomer } from "./customers.mjs";
import { ChargeRefused } from "./charge.mjs";
import { metadataFor } from "./metadata.mjs";

/**
 * Create a payment intent for the virtual terminal (staff-entered charge).
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   payerUserId: the person being charged
 *   invoiceId: optional invoice to link (null for off-invoice charges)
 *   amountMinor: amount in minor units (must be positive integer)
 *   description: optional description for the charge
 *   saveCard: whether to save the card for future use (default false)
 *   saveCardConsent: explicit consent to save the card (required if saveCard is true)
 *   requestKey: idempotency key (required) — a UUID generated once per form open
 *   actorUserId: the staff member entering the charge
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{clientSecret, publishableKey, paymentIntentId}>}
 */
export async function createTerminalIntent(tx, {
  tenantId, payerUserId, invoiceId = null, amountMinor, description = null,
  saveCard = false, saveCardConsent = false, requestKey, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // Step 1: requestKey is required — a uuid the calling screen generates once per open form
  if (typeof requestKey !== "string" || requestKey.trim().length === 0) {
    throw new Error("requestKey is required — it must be a UUID generated once per form open");
  }

  // Step 2: If saveCard is true but saveCardConsent is NOT true, throw 400
  if (saveCard === true && saveCardConsent !== true) {
    throw new ChargeRefused("Ask them first. It's their card.");
  }

  // Step 3: Ensure the customer exists on the connected Stripe account
  const customerResult = await ensureCustomer(tx, { tenantId, personId: payerUserId, fetchImpl });

  // Step 4: Call stripeConnectedRequest to create the payment intent
  const metadata = metadataFor("terminal_location", {
    practice_id: tenantId,
    location_id: null,
    keystone_payer_id: payerUserId,
    keystone_source: "terminal",
  });

  const form = {
    amount: amountMinor,
    currency: "usd",
    customer: customerResult.customerId,
    payment_method_types: ["card"],
    application_fee_amount: applicationFeeMinor(amountMinor),
    metadata,
  };

  if (description) form.description = description;
  if (saveCard) form.setup_future_usage = "off_session";

  const response = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/payment_intents",
    sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
    form,
    movesMoney: true,
    purpose: "terminal_intent",
    idempotencyKey: `vt:${tenantId}:${requestKey}`,
    actorUserId,
  }, { fetchImpl, env });

  // Step 5: Return the client secret and publishable key
  return {
    clientSecret: response.body.client_secret,
    publishableKey: env.KEYSTONE_STRIPE_PUBLISHABLE_KEY,
    paymentIntentId: response.body.id,
  };
}

/**
 * Process a payment using a Stripe Terminal reader.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   readerId: the ID of the registered Stripe Terminal reader
 *   paymentIntentId: the payment intent to process
 *   amountMinor: optional override amount in minor units
 *   requestKey: idempotency key (required) — a UUID generated once per action
 *   actorUserId: the staff member processing the payment
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{status, body}>}
 */
export async function processPaymentIntent(tx, {
  tenantId, readerId, paymentIntentId, amountMinor = null, requestKey, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof requestKey !== "string" || requestKey.trim().length === 0) {
    throw new Error("requestKey is required — it must be a UUID generated once per action");
  }

  const metadata = metadataFor("terminal_location", {
    practice_id: tenantId,
    location_id: null,
    keystone_payer_id: null,
    keystone_source: "reader",
  });

  const form = {
    payment_intent: paymentIntentId,
  };

  if (amountMinor !== null) {
    form.amount = amountMinor;
  }

  return stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/terminal/readers/${readerId}/process_payment_intent`,
    sdk: (s, o, form, query) => s.terminal.readers.processPaymentIntent(readerId, form, o),
    form,
    movesMoney: true,
    purpose: "reader_process_payment",
    idempotencyKey: `reader:process:${tenantId}:${requestKey}`,
    actorUserId,
  }, { fetchImpl, env });
}

/**
 * Cancel a pending reader action.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   readerId: the ID of the registered Stripe Terminal reader
 *   requestKey: idempotency key (required) — a UUID generated once per action
 *   actorUserId: the staff member canceling the action
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{status, body}>}
 */
export async function cancelAction(tx, {
  tenantId, readerId, requestKey, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof requestKey !== "string" || requestKey.trim().length === 0) {
    throw new Error("requestKey is required — it must be a UUID generated once per action");
  }

  const metadata = metadataFor("terminal_location", {
    practice_id: tenantId,
    location_id: null,
    keystone_payer_id: null,
    keystone_source: "reader",
  });

  const form = {
    metadata,
  };

  return stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/terminal/readers/${readerId}/cancel_action`,
    sdk: (s, o, form, query) => s.terminal.readers.cancelAction(readerId, form, o),
    form,
    movesMoney: false,
    purpose: "reader_cancel_action",
    idempotencyKey: `reader:cancel:${tenantId}:${requestKey}`,
    actorUserId,
  }, { fetchImpl, env });
}

/**
 * Set the display content on a Stripe Terminal reader.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   readerId: the ID of the registered Stripe Terminal reader
 *   displayType: the type of display content (e.g., "receipt", "text")
 *   displayText: optional text to display
 *   requestKey: idempotency key (required) — a UUID generated once per action
 *   actorUserId: the staff member setting the display
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{status, body}>}
 */
export async function setReaderDisplay(tx, {
  tenantId, readerId, displayType = null, displayText = null, requestKey, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof requestKey !== "string" || requestKey.trim().length === 0) {
    throw new Error("requestKey is required — it must be a UUID generated once per action");
  }

  const metadata = metadataFor("terminal_location", {
    practice_id: tenantId,
    location_id: null,
    keystone_payer_id: null,
    keystone_source: "reader",
  });

  const form = {
    metadata,
  };

  if (displayType) {
    form.type = displayType;
  }

  if (displayText) {
    form.text = displayText;
  }

  return stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/terminal/readers/${readerId}/set_reader_display`,
    sdk: (s, o, form, query) => s.terminal.readers.setReaderDisplay(readerId, form, o),
    form,
    movesMoney: false,
    purpose: "reader_set_display",
    idempotencyKey: `reader:display:${tenantId}:${requestKey}`,
    actorUserId,
  }, { fetchImpl, env });
}

/**
 * Refund a charge taken on a Stripe Terminal reader.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   chargeId: the ID of the charge to refund
 *   amountMinor: optional partial refund amount in minor units
 *   reason: optional refund reason
 *   requestKey: idempotency key (required) — a UUID generated once per action
 *   actorUserId: the staff member requesting the refund
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{status, body}>}
 */
// ★ the maintainer, 29 Sep 2026 — F: SLIDEUP-AUDIT.md / WIRING-MAP.md §3 W5 name a SECOND, distinct control —
//   "Refund on reader (card present)" — whose real Stripe endpoint is the dedicated
//   `POST /terminal/readers/{reader}/refund_payment`, separate from this function's own
//   `/charges/{charge}/refunds` (which is correct for a REGULAR refund, reader-taken or not — a
//   charge id alone is enough for that, and it stays the default). The dedicated reader endpoint
//   additionally re-presents the card at the reader for a card-present refund rather than debiting
//   the original payment method electronically — genuinely different from a plain charge refund,
//   not a copy of it. No UI control calls either "card present" path yet (grepped src/lib for
//   "card present"/"cardPresent" — no match), so this is additive: an existing caller passing only
//   `chargeId` is completely unaffected; a future card-present control passes `readerId` too.
export async function refundPayment(tx, {
  tenantId, chargeId, readerId = null, amountMinor = null, reason = null, requestKey, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof requestKey !== "string" || requestKey.trim().length === 0) {
    throw new Error("requestKey is required — it must be a UUID generated once per action");
  }

  const metadata = metadataFor("terminal_location", {
    practice_id: tenantId,
    location_id: null,
    keystone_payer_id: null,
    keystone_source: "reader",
  });

  const form = {
    metadata,
  };

  if (amountMinor !== null) {
    form.amount = amountMinor;
  }

  if (reason) {
    form.reason = reason;
  }

  if (readerId) {
    form.charge = chargeId;
    return stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/terminal/readers/${readerId}/refund_payment`,
      sdk: (s, o, form, query) => s.terminal.readers.refundPayment(readerId, form, o),
      form,
      movesMoney: true,
      purpose: "reader_refund_payment_card_present",
      idempotencyKey: `reader:refund:${tenantId}:${requestKey}`,
      actorUserId,
    }, { fetchImpl, env });
  }

  return stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/charges/${chargeId}/refunds`,
    form,
    movesMoney: true,
    purpose: "reader_refund_payment",
    idempotencyKey: `reader:refund:${tenantId}:${requestKey}`,
    actorUserId,
  }, { fetchImpl, env });
}
