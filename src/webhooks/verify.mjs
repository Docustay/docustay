// P19.5a / U29 — VERIFY THE SIGNATURE **BEFORE** RESOLVING THE TENANT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE DEFECT THIS CLOSES, MEASURED IN THE CODE IT REPLACES.
//     `src/paths/index.mjs:96-101` — `handleWebhook({provider, externalRef})` — was a `Map.get` on
//     `${provider}:${externalRef}` with **NO HMAC, NO TIMESTAMP AND NO REPLAY WINDOW**, while the
//     header of that very file (line 13) describes the webhook path as *"signed vendor payload"*.
//     Nothing signed anything.
//
// ★★★ WHY THAT IS NOT "A MISSING CHECK" BUT A TENANCY FAILURE:
//     **RESOLVING A TENANT FROM UNVERIFIED, ATTACKER-CONTROLLED INPUT IS TENANT SELECTION BY THE
//     ATTACKER.** `externalRef` arrives in the request BODY. Anyone who knows (or guesses) a Stripe
//     customer id could therefore choose which tenant's context the rest of the handler executes in
//     — on the path that carries live payment events. Every RLS policy downstream would then be
//     working perfectly, and scoping to the tenant the attacker named.
//
// ★★★ THE ORDERING CONSTRAINT, AND IT IS FORCED BY THE DATA, NOT A PREFERENCE:
//     `externalRef` lives in the body, so the body must be READ before the tenant exists. But
//     signature verification needs **only the raw bytes and a per-provider secret** — it needs no
//     tenant at all. So it goes FIRST: **verify → parse → resolve.**
//   ★ It must verify the RAW BYTES, never a re-serialised object: `JSON.parse` then
//     `JSON.stringify` reorders keys and changes whitespace, so the HMAC of the round-tripped body
//     is a different HMAC. A verifier that re-serialises rejects every genuine payload and then gets
//     "fixed" by being switched off.
//
// ★★ WHAT LIVES WHERE: the signing secrets are per provider and live in **Google Secret Manager**
//    (`STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVE_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`), surfaced to
//    the process as environment variables. This module reads them at call time and **fails loud** if
//    one is absent — never `process.env.X || 'literal'`, because a fallback secret verifies nothing
//    while appearing to.

import { createHmac, timingSafeEqual } from "node:crypto";

// ★★★ S2 TASK 3 — `documenso` REMOVED (01 default 9: Documenso is retired; ADD6-1 had already
//     deleted its verifier and its signing path, but the NAME stayed here so an inbound Documenso
//     payload failed closed with its own message rather than falling through to "unknown provider").
//     Removing it does NOT weaken that refusal: the FIRST check in `verifyWebhookSignature` below
//     (`!PROVIDERS.includes(provider)`) is the general fail-closed guard for ANY name not on this
//     list — it is not documenso-specific, and there is no default-allow branch anywhere after it.
//     A `documenso` payload now fails there, as "unknown provider", instead of failing one line
//     later in `webhookSigningSecret` as "no signature verifier" — same outcome, same shape, one
//     fewer special case naming a vendor that no longer exists anywhere else in this file.
/**
 * ★ The providers THIS MODULE accepts.
 * ★★★ FIX ROUND 1, M3 — this no longer matches `keystone_auth.webhook_source`'s own CHECK
 *   constraint. [MEASURED] `db/migrations/0045_api_token_and_webhook_source.sql:124` still reads
 *   `CHECK (provider IN ('stripe','documenso','resend'))` — the DATABASE will still accept a
 *   `documenso` row today. That is not a live gap: nothing can reach that INSERT with `documenso`
 *   any more (this file's own `PROVIDERS.includes` guard refuses it before any row is ever routed),
 *   but the two lists disagree, and dropping 'documenso' from the CHECK is a migration, which this
 *   fix round was explicitly told not to write. Left for whoever owns that migration next.
 */
export const PROVIDERS = Object.freeze(["stripe", "resend"]);

/**
 * ★★ FIVE MINUTES, AND THE REASON IS REPLAY.
 *    A signature alone proves the payload was genuine ONCE. Without a timestamp window a captured
 *    payload stays valid forever, so a recorded `payment_intent.succeeded` could be re-posted to
 *    credit an invoice again. Stripe and Svix both sign a timestamp for exactly this reason; the
 *    window is what makes the signature perishable.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export class WebhookUnverified extends Error {
  constructor(reason) {
    // ★★★ ONE MESSAGE FOR EVERY FAILURE MODE, AND THE DETAIL KEPT OFF THE WIRE.
    //     "bad signature" vs "stale timestamp" vs "unknown provider" tells a forger which half of an
    //     attempt was right. `reason` is for OUR logs; it must never reach a response body.
    super("the webhook signature could not be verified");
    this.name = "WebhookUnverified";
    this.reason = reason;
    this.statusCode = 400;
  }
}
export class WebhookConfigError extends Error {
  constructor(message) { super(message); this.name = "WebhookConfigError"; this.statusCode = 500; }
}

/** The env var carrying each provider's signing secret. Named per provider — never one shared key. */
export const SECRET_VARS = Object.freeze({
  stripe: "STRIPE_WEBHOOK_SECRET",
  resend: "RESEND_WEBHOOK_SECRET",
});

/** ★ Secondary secrets for providers that support webhook secret rotation. When primary verification
 *  fails, the secondary is tried as a fallback (if set). This supports planned secret rotation without
 *  dropping events during the transition window. */
const SECONDARY_SECRET_VARS = Object.freeze({
  stripe: "STRIPE_CONNECT_WEBHOOK_SECRET",
});

/** Docustay's own Stripe account: one signing secret per endpoint (its own events; its Connect accounts' events). Same URL, different secret. */
const DOCUSTAY_SECRET_VARS = Object.freeze({
  stripe: ["KEYSTONE_DOCUSTAY_STRIPE_WEBHOOK_SECRET", "KEYSTONE_DOCUSTAY_STRIPE_CONNECT_WEBHOOK_SECRET"],
});

/**
 * ★ Read a provider's signing secret, or fail loudly.
 * ★★ S2 TASK 3 — `documenso` is no longer in `PROVIDERS` at all (it is fully retired, 01 default 9),
 *    so it never reaches this function: it is refused one line earlier, by the `PROVIDERS.includes`
 *    check below, as an unknown provider. Any OTHER name that is in `PROVIDERS` but has no entry in
 *    `SECRET_VARS` still hits the branch just below — an unverifiable inbound path is refused rather
 *    than trusted, and there is no default-allow case anywhere in this file.
 */
export function webhookSigningSecret(provider, env = process.env) {
  if (!PROVIDERS.includes(provider)) {
    throw new WebhookConfigError(`"${provider}" is not a known webhook provider`);
  }
  const varName = SECRET_VARS[provider];
  if (!varName) {
    throw new WebhookConfigError(
      `provider "${provider}" has no signature verifier — an unverifiable inbound path is refused ` +
      `rather than trusted, and there is no default-allow case.`);
  }
  const secret = env[varName];
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new WebhookConfigError(
      `${varName} is not set, so ${provider} webhooks cannot be verified and are all refused. ★ There ` +
      `is deliberately NO fallback: a hardcoded secret would verify nothing while appearing to. The ` +
      `value lives in Google Secret Manager under that name.`);
  }
  return secret.trim();
}

/** ★ Constant-time hex/base64 comparison. A `===` on a digest leaks its prefix through timing. */
function safeEqual(a, b) {
  const ba = Buffer.from(a, "utf8"), bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * ★★★ STRIPE. Header: `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`
 *     The signed payload is `${t}.${rawBody}` — the timestamp is INSIDE the MAC, which is what stops
 *     an attacker replaying an old body under a fresh timestamp.
 *   ★ MULTIPLE `v1` values are legal and must ALL be considered: during a secret rotation Stripe
 *     signs with both. Accepting only the first would reject half the traffic mid-rotation and look
 *     like an outage.
 */
function verifyStripe({ rawBody, headers, secret, nowSeconds, toleranceSeconds }) {
  const header = headers["stripe-signature"] ?? headers["Stripe-Signature"];
  if (!header) throw new WebhookUnverified("no Stripe-Signature header");
  const parts = String(header).split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const v1s = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || v1s.length === 0) throw new WebhookUnverified("Stripe-Signature has no t= or v1=");
  if (!/^\d+$/.test(t)) throw new WebhookUnverified("Stripe-Signature t= is not an integer");

  const age = Math.abs(nowSeconds - Number(t));
  if (age > toleranceSeconds) {
    throw new WebhookUnverified(`timestamp is ${age}s away, outside the ${toleranceSeconds}s window`);
  }
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  if (!v1s.some((v) => safeEqual(v, expected))) throw new WebhookUnverified("no v1 signature matched");
  return { provider: "stripe", signedAtSeconds: Number(t) };
}

/**
 * ★★★ RESEND uses SVIX. Headers: `svix-id`, `svix-timestamp`, `svix-signature: v1,<base64>[ v1,<b64>]`
 *     Signed payload is `${svix-id}.${svix-timestamp}.${rawBody}`, and the SECRET is base64 after
 *     stripping the `whsec_` prefix — **a common and silent mistake is HMAC-ing the prefixed string**,
 *     which produces a digest that never matches and reads as "Resend is sending bad signatures".
 */
function verifyResend({ rawBody, headers, secret, nowSeconds, toleranceSeconds }) {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sig = headers["svix-signature"];
  if (!id || !ts || !sig) throw new WebhookUnverified("missing svix-id / svix-timestamp / svix-signature");
  if (!/^\d+$/.test(String(ts))) throw new WebhookUnverified("svix-timestamp is not an integer");
  const age = Math.abs(nowSeconds - Number(ts));
  if (age > toleranceSeconds) {
    throw new WebhookUnverified(`timestamp is ${age}s away, outside the ${toleranceSeconds}s window`);
  }
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${ts}.`).update(rawBody).digest("base64");
  // ★ The header may carry several space-separated `v<ver>,<sig>` pairs — again, rotation.
  const offered = String(sig).split(" ").map((s) => s.split(",")).filter(([v]) => v === "v1").map(([, s]) => s);
  if (offered.length === 0) throw new WebhookUnverified("svix-signature carries no v1 entry");
  if (!offered.some((s) => safeEqual(s, expected))) throw new WebhookUnverified("no v1 signature matched");
  return { provider: "resend", signedAtSeconds: Number(ts) };
}

const VERIFIERS = Object.freeze({ stripe: verifyStripe, resend: verifyResend });

/**
 * ★★★ VERIFY. Call this on the RAW BYTES, before `JSON.parse`, before any tenant lookup.
 *
 * @param {object} a
 * @param {string} a.provider
 * @param {Buffer|string} a.rawBody  ★ THE BYTES AS RECEIVED. Not an object, not a re-serialisation.
 * @param {Record<string,string>} a.headers  lower-cased keys preferred; both cases handled for Stripe
 * @returns {{provider: string, signedAtSeconds: number}}
 * @throws {WebhookUnverified} for every rejection, with the same message and a private `reason`
 */
export function verifyWebhookSignature({
  provider, rawBody, headers = {},
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  env = process.env,
} = {}) {
  // ★★ FAIL CLOSED ON SHAPE FIRST. An unknown provider must never reach a default-allow branch —
  //    that is the shape in which "we added a provider and forgot the verifier" becomes an open door.
  if (!PROVIDERS.includes(provider)) throw new WebhookUnverified(`unknown provider "${provider}"`);
  const verify = VERIFIERS[provider];
  if (!verify) throw new WebhookUnverified(`no verifier for provider "${provider}" — refusing`);
  if (rawBody === undefined || rawBody === null) throw new WebhookUnverified("no raw body to verify");
  if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) {
    // ★★★ THIS REFUSAL IS LOAD-BEARING. An OBJECT here means the caller already parsed, so the bytes
    //     that were signed are gone and anything we compute is a MAC over OUR serialisation, not
    //     theirs. It would fail for genuine payloads and could be "fixed" by loosening the compare.
    throw new WebhookUnverified(
      "rawBody must be the bytes as received (Buffer or string) — an already-parsed object cannot be verified");
  }
  const secret = webhookSigningSecret(provider, env);   // throws WebhookConfigError if unset
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[String(k).toLowerCase()] = v;

  let primaryError;
  try {
    return verify({ rawBody, headers: lower, secret, nowSeconds, toleranceSeconds });
  } catch (err) {
    if (!(err instanceof WebhookUnverified)) throw err;
    primaryError = err;
  }

  // ★ If primary verification failed and a secondary secret is available, try it as a fallback.
  // This supports planned secret rotation without dropping events during the transition window.
  const secondaryVarName = SECONDARY_SECRET_VARS[provider];
  if (secondaryVarName && typeof env[secondaryVarName] === "string" && env[secondaryVarName].trim() !== "") {
    try {
      const secondarySecret = env[secondaryVarName].trim();
      return verify({ rawBody, headers: lower, secret: secondarySecret, nowSeconds, toleranceSeconds });
    } catch (err) {
      if (!(err instanceof WebhookUnverified)) throw err;
      // Fall through to rethrow the original error
    }
  }

  // ★ Docustay's OWN Stripe account (13 Oct 2026): its two endpoints (own events, and its Connect accounts) each have their own signing secret. They are tried after the Docustay ones and
  //   the result says which account signed it, so the the platform mirror (which only knows the Docustay secret) is not asked to verify a Docustay event.
  for (const varName of DOCUSTAY_SECRET_VARS[provider] ?? []) {
    const v = env[varName];
    if (typeof v !== "string" || v.trim() === "") continue;
    try {
      return { ...verify({ rawBody, headers: lower, secret: v.trim(), nowSeconds, toleranceSeconds }), account: "docustay" };
    } catch (err) {
      if (!(err instanceof WebhookUnverified)) throw err;
    }
  }

  // ★ Rethrow the original error (same message, so no oracle distinguishes "wrong secondary" from "none set")
  throw primaryError;
}
