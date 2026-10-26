// P2.6 — STRIPE CUSTOMER. NO CHARGE. CUSTOMER CREATION ONLY.
//
// ╔════════════════════════════════════════════════════════════════════════════════════╗
// ║ ★★★ HARD LIMIT 1. STRIPE IS LIVE AND PERMANENTLY LIVE. REAL MONEY, ON TY'S CARD.   ║
// ║ No charge, subscription, invoice or payment intent without the maintainer approving it IN THAT ║
// ║ SESSION. Not as part of a phase. Not as a proof. Not "just once to verify".        ║
// ╚════════════════════════════════════════════════════════════════════════════════════╝
//
// ★★ THE LIMIT IS ENFORCED STRUCTURALLY HERE, NOT BY THE COMMENT ABOVE.
// A comment is a request. This module can only reach ONE Stripe endpoint — `POST /v1/customers` —
// because the endpoint is a hardcoded literal and the caller cannot supply one. There is no code
// path through this file that can create a charge, a PaymentIntent, a Subscription or an Invoice,
// so a future edit that tries to add one has to change this file, visibly, in review.
//
// ★ A Stripe CUSTOMER costs nothing. It is a record with an email and a name. Creating one moves
// no money and has no recurring cost. That is why P2.6 is allowed to run automatically at all.
//
// ★★ `already_exists` handling matters here more than anywhere: Stripe returns
// **400 with code `resource_already_exists`, NOT a 409** (see classify.mjs). And a duplicate
// customer is not merely untidy — it is the object an invoice would later be attached to, so two
// of them means a client can be billed against a record nobody is watching.

import { classify, Outcome, isSuccess } from "../classify.mjs";
import { callOutside } from "../../http/outside.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH. `withTenant` + `flagIsOn` open ONE short-lived, tenant-scoped
//     transaction to answer "is stripe_enabled on for this practice", every call, no cache
//     (flags.mjs's own rule: a cache here is CLAUDE.md failure #1 moved from a GUC to a Map).
//     Never the transport — 9.6's `callOutside` move below is untouched.
import { withTenant } from "../../db/index.mjs";
import { flagIsOn } from "../../platform/flags.mjs";
import { metadataFor } from "../../money/metadata.mjs";

// ★ Task 9.6 (CT-064) — Stripe's own default: 20 000 ms (06 §5). `classify.mjs` is untouched: this
//   module still hands it a `{status, code, message}` (or a transport `{code, message}`) shaped
//   error; only the TRANSPORT underneath — the fetch call, its timer and its abort — moved onto
//   `callOutside`. `callOutside` never returns the provider's own network error code, so a
//   transport failure is represented here by a representative code from `classify.mjs`'s own
//   `transport` set (`ETIMEDOUT` on a timeout, `ECONNREFUSED` otherwise) — either lands the same
//   place there: `Outcome.RETRYABLE`.
const STRIPE_TIMEOUT_MS = 20_000;

// ★ The ONLY endpoint this module knows. Not a parameter. Not a template.
const STRIPE_CUSTOMERS_ENDPOINT = "https://api.stripe.com/v1/customers";

// ★ A deny-list as a second, independent barrier. If a future edit ever makes the endpoint
// dynamic, this still refuses anything that moves money. Belt and braces, deliberately.
export const MONEY_MOVING = /\/(charges|payment_intents|subscriptions|invoices|invoiceitems|payment_links|setup_intents|transfers|payouts)\b/i;

export class MoneyMovementRefused extends Error {
  constructor(url) {
    super(
      `REFUSED: this module may only create Stripe CUSTOMERS. Attempted: ${url}\n` +
      `Hard limit 1 — no charge, subscription, invoice or payment intent without the maintainer in-session.`
    );
    this.name = "MoneyMovementRefused";
  }
}

function assertCustomerEndpointOnly(url) {
  if (MONEY_MOVING.test(url)) throw new MoneyMovementRefused(url);
  if (url !== STRIPE_CUSTOMERS_ENDPOINT) throw new MoneyMovementRefused(url);
}

/**
 * Create (or resolve) the Stripe customer for a tenant.
 *
 * @param deps.fetchImpl        injected so this is testable WITHOUT touching live Stripe
 * @param deps.apiKey           read from a secret store at call time; never written to disk
 * @param deps.idempotencyKey   ★ Stripe's own idempotency, per P2.4
 */
export async function createStripeCustomer({ tenantId, email, name }, deps = {}) {
  // ★★★ Task 9.13 — THE GUARD, AT THE TOP, BEFORE ANYTHING ELSE. A refusal, never a silent
  //     success and never a 500 — the exact shape MOCKUPS §20 / 06 §13 require of a kill switch.
  const stripeEnabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "stripe_enabled", tenantId));
  if (!stripeEnabled) {
    return {
      outcome: "service_disabled",
      externalId: null,
      error: {
        code: "stripe_disabled",
        message: "stripe_enabled is off for this practice — a platform operator turned it off. " +
          "No Stripe customer can be created until it is switched back on.",
      },
    };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const apiKey = deps.apiKey;
  if (!apiKey) {
    // ★ Fail loud. NEVER `process.env.KEY || 'sk_test_...'` — a hardcoded fallback on a LIVE
    // account is how test code reaches production money.
    throw new Error("stripeCustomer: no API key supplied (never use a hardcoded fallback)");
  }

  const url = STRIPE_CUSTOMERS_ENDPOINT;
  assertCustomerEndpointOnly(url);

  const meta = metadataFor("customer", { keystone_tenant_id: tenantId });
  const body = new URLSearchParams({
    email,
    name,
    ...Object.fromEntries(
      Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])
    ),
  });

  const result = await callOutside("stripe", url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // ★ Stripe-native idempotency: a retry after a lost response returns the ORIGINAL
      // customer rather than creating a second one.
      "Idempotency-Key": deps.idempotencyKey ?? `keystone-customer-${tenantId}`,
    },
    body,
  }, { fetchImpl, timeoutMs: STRIPE_TIMEOUT_MS });

  let err = null;
  if (result.status === null) {
    // ★ No reply at all — a timeout or a network failure. `callOutside` classifies it but does not
    //   hand back the provider's own error code, so `classify.mjs` is given a representative one
    //   from its own `transport` set; either lands the request in `Outcome.RETRYABLE`.
    err = {
      code: result.timedOut ? "ETIMEDOUT" : "ECONNREFUSED",
      message: result.timedOut
        ? `stripe did not respond within ${STRIPE_TIMEOUT_MS}ms`
        : "stripe request failed (no reply)",
    };
  } else if (!result.ok) {
    const payload = (result.body && typeof result.body === "object") ? result.body : {};
    err = {
      status: result.status,
      code: payload?.error?.code,
      message: payload?.error?.message ?? `stripe ${result.status}`,
    };
  }

  const outcome = classify("stripe", err);

  if (outcome === Outcome.ALREADY_EXISTS) {
    // ★ RESOLVE THROUGH find(), per P2.4. The object exists at Stripe; we simply never learned
    // its id. Failing here would leave it orphaned and attached to a real tenant.
    const found = await findStripeCustomerByTenant(tenantId, { fetchImpl, apiKey });
    return { outcome, externalId: found?.id ?? null, resolvedByFind: true };
  }

  if (!isSuccess(outcome)) {
    return { outcome, externalId: null, error: err };
  }

  const created = result.body;
  return { outcome: Outcome.SUCCESS, externalId: created.id, resolvedByFind: false };
}

/** Look the customer up by the tenant id we stamped into metadata. */
async function findStripeCustomerByTenant(tenantId, { fetchImpl, apiKey }) {
  const q = encodeURIComponent(`metadata['keystone_tenant_id']:'${tenantId}'`);
  const url = `https://api.stripe.com/v1/customers/search?query=${q}`;
  // ★ Search is a READ. It is exempt from the customers-only endpoint assertion, but still
  // checked against the money-moving deny-list.
  if (MONEY_MOVING.test(url)) throw new MoneyMovementRefused(url);
  const result = await callOutside("stripe", url, { headers: { Authorization: `Bearer ${apiKey}` } },
    { fetchImpl, timeoutMs: STRIPE_TIMEOUT_MS });
  if (!result.ok) return null;
  return result.body?.data?.[0] ?? null;
}

export const __internals = { STRIPE_CUSTOMERS_ENDPOINT, MONEY_MOVING, assertCustomerEndpointOnly };
