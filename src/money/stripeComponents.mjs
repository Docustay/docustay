// Stage 15 Task 15.26 — STRIPE COMPONENT SESSIONS
//
// Handle requests for Stripe Account Sessions, which embed hosted components for
// practices to manage their own Stripe account (without landing on Stripe directly).
// ★ These sessions are short-lived and handed straight to the browser — nothing is stored.

import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { createConnectAccount, connectAccount, getConnectAccountState } from "./connect.mjs";

/**
 * The 16 Stripe Account Session component types, by surface.
 * ★★★ These key names and component names are exactly Stripe's own.
 */
export const SURFACE_COMPONENTS = Object.freeze({
  onboarding: ["account_onboarding"],
  notification: ["notification_banner"],
  payment_methods: ["payment_method_settings"],
  disputes: ["disputes_list"],
  payouts: ["payouts"],
  payouts_list: ["payouts_list"],
  payout_details: ["payout_details"],
  balances: ["balances"],
  documents: ["documents"],
  hardware_shop: ["terminal_hardware_shop"],
  hardware_orders: ["terminal_hardware_orders"],
  reconcile: ["payout_reconciliation_report"],
  instant_payout: ["instant_payouts_promotion"],
  payments: ["payments"],
  payment_details: ["payment_details"],
  account_management: ["account_management"],
  tax_settings: ["tax_settings"],
  tax_registrations: ["tax_registrations"],
  tax_threshold_monitoring: ["tax_threshold_monitoring"],
});

/**
 * Create a component session for a practice's connected Stripe account.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   surface: the component surface name (must be a key in SURFACE_COMPONENTS)
 *   actorUserId: optional user id for audit
 * @returns {Promise<{clientSecret, publishableKey, components}>}
 * @throws {Error} with status 400 if surface is unknown
 * @throws {ConnectNotLive} with status 409 if Connect account is not ready (unless onboarding)
 */
export async function createComponentSession(tx, { tenantId, surface, actorUserId = null }) {
  // ★ STEP 1: Validate surface
  if (!(surface in SURFACE_COMPONENTS)) {
    const err = new Error(`surface unknown: ${surface}`);
    err.statusCode = 400;
    throw err;
  }

  // ★ STEP 2: Check Connect account state
  const connectState = await getConnectAccountState(tx, tenantId);

  // ★ STEP 3: If no Connect account yet AND surface is onboarding, create it
  if (connectState.state === "not_connected" && surface === "onboarding") {
    const { stripeAccountId } = await createConnectAccount();
    await connectAccount(tx, {
      tenantId,
      stripeAccountId,
      state: "pending",
      actorUserId,
    });
    connectState.state = "pending";
    connectState.stripeAccountId = stripeAccountId;
  }

  // ★ STEP 4: Call stripeConnectedRequest to create the account session
  const acct = connectState.stripeAccountId;
  const components = SURFACE_COMPONENTS[surface];

  // Build the form with component enablement and conditional features
  const form = { account: acct };
  for (const component of components) {
    form[`components[${component}][enabled]`] = true;

    // Add features for payments and payment_details surfaces only
    if (surface === 'payments' || surface === 'payment_details') {
      form[`components[${component}][features][refund_management]`] = true;
      form[`components[${component}][features][dispute_management]`] = true;
      form[`components[${component}][features][capture_payments]`] = false;
    }
  }

  const response = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/account_sessions",
    sdk: (s, o, form, query) => s.accountSessions.create(form, o),
    form,
    movesMoney: false,
    onAccount: false,
    allowUnverified: true,
    purpose: "component_session",
    actorUserId,
  });

  // ★ STEP 5: Return the session details
  return {
    clientSecret: response.body.client_secret,
    publishableKey: process.env.KEYSTONE_STRIPE_PUBLISHABLE_KEY,
    components,
  };
}
