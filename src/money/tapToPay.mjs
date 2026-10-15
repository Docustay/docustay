// Stage 15 Task 15.25 — TAP TO PAY: Phone-based card-present payments

import { flagIsOn } from "../platform/flags.mjs";
import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { ensureTerminalLocation } from "./devices.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { metadataFor } from "./metadata.mjs";

/**
 * Assert that Tap to Pay is switched on for this practice.
 *
 * @param tx a tenant transaction
 * @param tenantId the practice's id
 * @throws {Error} 403 if tap_to_pay_enabled flag is off
 */
export async function assertTapOn(tx, tenantId) {
  const enabled = await flagIsOn(tx, "tap_to_pay_enabled", tenantId);
  if (!enabled) {
    const err = new Error("Tap to Pay is switched off for this practice.");
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Activate Tap to Pay on a staff member's phone.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   deviceName: friendly name for this phone device
 *   actorUserId: the staff member activating it
 * @param {object} deps optional dependencies for testing
 * @returns {Promise<object>} the created device row
 * @throws {Error} 403 if tap_to_pay_enabled is off
 */
export async function activateTapToPay(tx, { tenantId, deviceName, actorUserId }, deps = {}) {
  // Check flag first
  await assertTapOn(tx, tenantId);

  // Insert device row
  const { rows } = await tx.query(
    `INSERT INTO keystone.device
       (tenant_id, name, kind, app_user_id, state)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tenant_id, name, kind, location_id, state, stripe_reader_id,
               model, serial, app_user_id, last_seen, registered_by, deactivated_at,
               created_at, updated_at`,
    [tenantId, deviceName, "phone", actorUserId, "active"]);

  const device = rows[0];

  // Emit event
  await emit(tx, {
    tenantId,
    topic: "money.tap_to_pay.activated",
    emittedBy: "money",
    subjectType: "device",
    subjectId: device.id,
    actor: userActor(actorUserId),
    // ★ `name` dropped from the payload (§2.4 — no text keys). Already on the record
    //   (`keystone.device.name`, INSERTed above); no consumer of `money.tap_to_pay.activated`
    //   reads `payload.name` (grepped src/, n8n/workflows/) — a listener reads the device's own
    //   name from the current row by `device.id` (subjectId).
    payload: {},
  });

  return device;
}

/**
 * Create a connection token for a Tap to Pay session.
 * This token is used by the Stripe Terminal SDK to connect to the reader on a phone.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 * @param {object} deps optional dependencies for testing
 * @returns {Promise<{secret: string}>}
 * @throws {Error} 403 if tap_to_pay_enabled is off
 */
export async function createConnectionToken(tx, { tenantId }, deps = {}) {
  // Check flag first
  await assertTapOn(tx, tenantId);

  // Get or create the terminal location
  const locationId = await ensureTerminalLocation(tx, { tenantId }, deps);

  const result = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/terminal/connection_tokens",
    sdk: (s, o, form, query) => s.terminal.connectionTokens.create(form, o),
    form: {
      location: locationId,
    },
    movesMoney: false,
    purpose: "connection_token",
    actorUserId: null,
  }, deps);

  return { secret: result.body.secret };
}

/**
 * Create a payment intent for a tap-to-pay charge.
 *
 * @param tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   invoiceId: the invoice being paid
 *   amountMinor: the amount in minor units (cents)
 *   actorUserId: who initiated the charge
 * @returns {Promise<object>} the created payment intent
 * @throws {Error} 403 if tap_to_pay_enabled is off (checked FIRST)
 * @throws {Error} 503 if charges are disabled (via stripeConnectedRequest)
 */
export async function createTapIntent(tx, { tenantId, invoiceId, amountMinor, actorUserId }, deps = {}) {
  // ★ BOTH LOCKS APPLY IN THIS ORDER: platform flag FIRST (403), then charges flag (503).

  // Step 1: Check platform flag FIRST (403)
  await assertTapOn(tx, tenantId);

  // Step 2: Let stripeConnectedRequest check charges flag (503)
  //         It will throw ChargePathDisabled if charges are off, and will emit money.charge.attempted
  const currency = await tx.query(
    `SELECT value FROM keystone.tenant_setting WHERE key = $1`,
    ["money.currency"]);
  const curr = currency.rows.length > 0 ? currency.rows[0].value : "USD";

  const meta = metadataFor("payment_intent", {
    keystone_invoice_id: invoiceId,
    keystone_source: "tap_to_pay",
  });
  const result = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/payment_intents",
    sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
    form: {
      "payment_method_types[]": "card_present",
      capture_method: "automatic",
      amount: amountMinor,
      currency: curr,
      application_fee_amount: applicationFeeMinor(amountMinor),
      ...Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])
      ),
    },
    movesMoney: true,
    purpose: "tap_intent",
    actorUserId,
  }, deps);

  return result.body;
}
