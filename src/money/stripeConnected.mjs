// Stage 15 Task 15.2 — STRIPE CONNECTED ACCOUNT REQUESTS
//
// Handle requests to a practice's connected Stripe account, with all safety guards in place.

import { stripeEnv, productOfTenant } from "../product/stripeFor.mjs";
import Stripe from "stripe";
import {
  chargesEnabled, stripeSecretKey, stripeSecretKeyForConfig, ChargePathDisabled, ChargeServiceDisabled,
} from "./charge.mjs";
export { ChargePathDisabled };
import { flagIsOn } from "../platform/flags.mjs";
import { getConnectAccountState } from "./connect.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { dependency } from "../http/errors.mjs";
import { nextScopedKey } from "./idempotencyScope.mjs";
import { refreshMirrorObject } from "./stripeMirror.mjs";

export const APPLICATION_FEE_BPS = 50;

/**
 * Calculate the application fee for a given amount.
 * @param {number} amountMinor the amount in minor units (must be an integer)
 * @returns {number} the fee in minor units
 * @throws if amountMinor is not an integer
 */
export function applicationFeeMinor(amountMinor) {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`applicationFeeMinor: amount must be an integer, got ${typeof amountMinor}`);
  }
  return Math.round(amountMinor * APPLICATION_FEE_BPS / 10000);
}

export class ConnectNotLive extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectNotLive";
    this.statusCode = 409;
  }
}

/**
 * Is the charge path switched on?
 * @param {object} env environment variables (defaults to process.env)
 * @returns {boolean} true if charges are enabled
 */
export function chargesOn(env = process.env) {
  return chargesEnabled(env);
}

/**
 * Flatten nested objects to form-encoded keys with bracket notation.
 * e.g. { a: { b: { c: "value" } } } → { "a[b][c]": "value" }
 * @param {object} form the object to flatten
 * @returns {string} URL-encoded form string
 */
export function encodeForm(form) {
  const params = new URLSearchParams();

  function flatten(obj, prefix = "") {
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}[${key}]` : key;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        flatten(value, newKey);
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => {
          const itemKey = `${newKey}[${i}]`;
          if (item !== null && typeof item === "object" && !Array.isArray(item)) {
            flatten(item, itemKey);
          } else {
            params.set(itemKey, String(item));
          }
        });
      } else {
        params.set(newKey, String(value));
      }
    }
  }

  flatten(form);
  return params.toString();
}

/**
 * Normalise a path for emission: strip leading slash and replace remaining slashes with dots.
 * e.g. "/payment_intents" → "payment_intents"
 * e.g. "/checkout/sessions" → "checkout.sessions"
 * @param {string} path the raw path with leading slash
 * @returns {string} normalised for emission
 */
function normalisePath(path) {
  return path.replace(/^\//, "").replace(/\//g, ".");
}

/**
 * Make a request to a practice's connected Stripe account.
 *
 * ★★★ SEVEN STEPS, IN THIS EXACT ORDER. The order is a safety order.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   method: "GET", "POST", etc.
 *   path: the API path (with leading slash), e.g. "/payment_intents"
 *   form: optional form data object
 *   query: optional query string params object
 *   idempotencyKey: optional idempotency key for Stripe deduplication
 *   movesMoney: REQUIRED boolean — true if this call moves money (charges), false otherwise (reads)
 *   purpose: a descriptive string for audit (e.g. "create_charge")
 *   actorUserId: optional user id for audit
 *   onAccount: whether to send Stripe-Account header (default true; false for account sessions)
 *   allowUnverified: whether to allow pending/restricted states (default false)
 *   sdk: optional (s, o, form, query) => typed Stripe SDK call (L4.1) — used instead of rawRequest when given; the locks above run either way
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{status, body}>}
 */
/**
 * ★ F889 (found 3 Oct 2026 by the Documents regression on the sandbox): Docustay charges on the platform's OWN Stripe account (no Stripe-Account header), and Stripe refuses any `application_fee_*`
 *   parameter on a direct payment — "You can only apply an 'application_fee' when the request is attempting a direct payment on behalf of another account". Every caller adds the fee (subscriptions,
 *   payment links, tap to pay), so a direct-account practice could not start a subscription, so a signed Family-coaching agreement never started its plan. A platform does not charge itself a fee
 *   on its own account: for a direct account the fee parameters are dropped here, in the one place every Stripe write passes through. Connected accounts keep their fee exactly as before.
 */
export function withoutApplicationFee(form, isDirectAccount) {
  if (!isDirectAccount || !form || typeof form !== "object") return form;
  const { application_fee_percent, application_fee_amount, ...rest } = form;   // eslint-disable-line no-unused-vars
  // Part 30 item 11 — a hosted Checkout Session carries its fee one level down; Stripe refuses it on a platform's own account just the same (found by the run against real Stripe's test API)
  delete rest["payment_intent_data[application_fee_amount]"]; delete rest["subscription_data[application_fee_percent]"];
  delete rest.refund_application_fee;   // a platform charging on its own account took no fee, so a refund has none to return (Stripe refuses the flag there: found 7 Oct 2026, B9 refund proof)
  return rest;
}

export async function stripeConnectedRequest(tx, {
  tenantId, method, path, form = null, query = null, idempotencyKey = null,
  movesMoney, purpose, actorUserId = null, onAccount = true, allowUnverified = false, sdk = null,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // ★★★ STEP 1: movesMoney must be explicitly true or false
  if (typeof movesMoney !== "boolean") {
    throw new Error("movesMoney is required and must be a boolean (true for charges, false for reads)");
  }

  // ★★★ STEP 2: Check if stripe_enabled flag is on
  const stripeEnabled = await flagIsOn(tx, "stripe_enabled", tenantId);
  if (!stripeEnabled) {
    throw new ChargeServiceDisabled(
      "stripe_enabled is off for this practice — a platform operator turned it off. No Stripe " +
      "request can be made until it is switched back on.");
  }

  // ★★★ STEP 3: Check Connect account state
  const connectState = await getConnectAccountState(tx, tenantId);
  if (connectState.state === "not_connected") {
    throw new ConnectNotLive("Connect Stripe before attempting any transaction.");
  }
  if (!allowUnverified && (connectState.state === "pending" || connectState.state === "restricted")) {
    throw new ConnectNotLive("Connect Stripe before attempting any transaction.");
  }
  // allowUnverified allows pending and restricted to pass through
  const acct = connectState.stripeAccountId;
  // ★ Docustay special case (connect.mjs's isDirectStripeAccountTenant) — this key already resolves
  //   directly to this account, so the Stripe-Account header must NOT be sent (a plain merchant
  //   key has no Connect scope to use it with, and Stripe rejects it). onAccount is forced off
  //   regardless of what the caller passed.
  if (connectState.isDirectAccount) { onAccount = false; form = withoutApplicationFee(form, true); }

  // ★★★ STEP 4: If movesMoney is true, emit the charge attempt event FIRST, then check if charges are enabled
  if (movesMoney === true) {
    // 4a: EMIT FIRST
    await emit(tx, {
      tenantId,
      topic: "money.charge.attempted",
      emittedBy: "money",
      subjectType: "payment",
      subjectId: tenantId,
      actor: userActor(actorUserId),
      payload: {
        purpose,
        path: normalisePath(path),
        amount_minor: form?.amount ?? null,
      },
    });

    // 4b: ONLY THEN check if charges are enabled
    if (!chargesEnabled(env)) {
      throw new ChargePathDisabled(
        `the Stripe charge path is OFF, so no card was charged. ★ This is the SHIPPED state and it ` +
        `is deliberate: no charge without a person approving it in the session it happens in. The ` +
        `attempt has been recorded as money.charge.attempted.`);
    }
  }

  // ★★★ STEP 5: Get the secret key — HARD LIMIT 1's live-charge approval applies ONLY when this
  //   call moves money (the maintainer's ruling, 29 Sep 2026 — the charge path was always the intended scope,
  //   specs/00-foundations/08-environments-and-test-mode.md §2). A config/read call (movesMoney:
  //   false) still needs a real, well-formed key — it just doesn't need a person's live-charge
  //   approval to read a balance or create a Product.
  //   Which ACCOUNT's key: a Docustay workspace uses Docustay's own Stripe account once it has one; every other workspace the Docustay key, exactly as before (src/product/stripeFor.mjs).
  const keyEnv = stripeEnv(await productOfTenant(tx, tenantId), env);
  const key = movesMoney ? stripeSecretKey(keyEnv) : stripeSecretKeyForConfig(keyEnv);

  // ★★★ STEP 6: Call Stripe
  if (!idempotencyKey && method !== "GET") idempotencyKey = nextScopedKey(purpose);

  // fetchImpl already defaults to globalThis.fetch (STEP 6's function signature), read fresh on
  // every call — so tests that stub globalThis.fetch or pass deps.fetchImpl keep intercepting;
  // this never falls through to the SDK's default Node http client.
  const stripe = new Stripe(key, {
    apiVersion: "2026-09-30.endive",
    maxNetworkRetries: 2,
    httpClient: Stripe.createFetchHttpClient(fetchImpl),
  });

  // rawRequest only accepts a `params` argument for POST — the SDK throws "rawRequest only
  // supports params on POST requests" otherwise (node_modules/stripe/cjs/RequestSender.js:361-364).
  // query keeps going onto the path as a query string, exactly as before, so the GET+query
  // callers (payouts.mjs, paymentMethods.mjs ×2) are unaffected.
  const rawPath = "/v1" + path + (method !== "POST" && query ? "?" + encodeForm(query) : "");
  const rawParams = method === "POST" ? (form ?? {}) : null;

  let result;
  try {
    const opts = { stripeAccount: onAccount ? acct : undefined, idempotencyKey, timeout: 20000 };
    // ★ L4.1 — a caller that names its typed SDK call gets it; every lock above ran either way.
    const body = sdk
      ? await sdk(stripe, opts, form ?? {}, query ?? {})
      : await stripe.rawRequest(method, rawPath, rawParams, opts);
    result = { ok: true, status: body?.lastResponse?.statusCode ?? body?.lastResponse?.status ?? 200, body };
  } catch (err) {
    result = {
      ok: false,
      status: err?.statusCode ?? null,
      body: { error: { message: err?.message ?? String(err) } },
    };
  }

  // ★★★ STEP 7: Handle errors
  if (!result.ok) {
    throw dependency(
      result.body?.error?.message ?? `Stripe returned ${result.status}`
    );
  }

  // ★★★ specs/STRIPE-MIRROR.md §3.3 — a WRITE is followed by a mirror refresh from Stripe's own
  //     response, so the very next screen read shows what Stripe now says, never the platform's
  //     assumption of what the write did. Production only (or KEYSTONE_STRIPE_MIRROR_REFRESH=on):
  //     tests inject fake fetches and must not open a real Stripe/database connection. Never throws.
  if (method !== "GET" && (process.env.NODE_ENV === "production" || process.env.KEYSTONE_STRIPE_MIRROR_REFRESH === "on")) {
    const b = result.body ?? {};
    const ids = new Set([b.id, typeof b.charge === "string" ? b.charge : null,
      typeof b.invoice === "string" ? b.invoice : null].filter((x) => typeof x === "string" && /^[a-z]+_/.test(x)));
    for (const id of ids) await refreshMirrorObject(id);
  }

  return { status: result.status, body: result.body };
}
