// src/http/turnstile.mjs — Task 9.8 (CT-073). AN INVISIBLE BOT CHECK THAT FAILS OPEN.
//
// ★★★ THE RULING THIS FILE IMPLEMENTS (the maintainer, 17 Sep 2026): if Cloudflare cannot be reached, the
//     submit is ACCEPTED — under a tighter per-form/per-IP limit (`formSubmitLimiter`,
//     `src/http/rateLimit.mjs`) — and marked "unverified". A token Cloudflare actively REJECTS is
//     still refused. Fail-open covers OUTAGES, not an answer that says "no".
//
// ★★ THREE OUTCOMES, and the difference between them is the whole point:
//   passed      — Cloudflare answered and accepted the token.               → accept, verified.
//   rejected    — Cloudflare answered and rejected the token.               → REFUSE (403).
//   unreachable — Cloudflare could not be reached, or gave no usable verdict → accept, unverified.
// A MISSING token (a browser that never loaded the widget) is treated as `unreachable`, not
// `rejected` — a client-side script failure must not lock a real visitor out of a public form.
//
// ★ Routed through `callOutside()` (task 9.1, CT-064) rather than a bare `fetch`, at the default
//   15 s time limit — the same wrapper every other outside call in this codebase uses, so a
//   Turnstile outage is classified the same way a Stripe or Resend outage is.
//
// ★★★ NEVER LOG OR STORE THE TOKEN OR THE SECRET KEY. Neither is read back from `callOutside`'s
//     result here, and neither is written to a log line, an event payload or a response body
//     anywhere in this file. The caller (the route handler) must hold to the same rule.

import { callOutside } from "./outside.mjs";
import { dependency } from "./errors.mjs";

// ★ Cloudflare's one verification endpoint. Not read from env — this is a fixed vendor URL, not a
//   deployment-specific setting (unlike the site/secret keys, which vary per environment).
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * verifyTurnstile(token, ip, opts) → `{ ok, reason }`, `reason` one of "passed" | "rejected" |
 * "unreachable". NEVER THROWS for a provider failure — only `callOutside`'s own programming-error
 * throws (a non-function `fetchImpl`, etc.) can escape this function, exactly as `callOutside`
 * itself never throws for a provider failure.
 *
 * @param {string} token - the widget's response token. A missing/empty token is `unreachable`.
 * @param {string|null} ip - the caller's IP, forwarded to Cloudflare as `remoteip` (optional there).
 * @param {{secretKey?: string, fetchImpl?: Function, url?: string, timeoutMs?: number}} [opts]
 */
export async function verifyTurnstile(token, ip, {
  secretKey = process.env.TURNSTILE_SECRET_KEY,
  fetchImpl,
  url = SITEVERIFY_URL,
  timeoutMs,
} = {}) {
  // ★ A missing token is `unreachable`, never `rejected` — see the file banner. This also covers
  //   the caller passing `null`/`undefined`/a non-string by mistake.
  if (typeof token !== "string" || token.length === 0) {
    return Object.freeze({ ok: false, reason: "unreachable" });
  }

  // ★ No secret key configured means the check CANNOT be performed — structurally the same as
  //   Cloudflare being unreachable, not an active rejection. This is a deployment-configuration
  //   gap, not something a visitor did.
  if (typeof secretKey !== "string" || secretKey.length === 0) {
    return Object.freeze({ ok: false, reason: "unreachable" });
  }

  const callOpts = { ...(fetchImpl ? { fetchImpl } : {}), ...(timeoutMs ? { timeoutMs } : {}) };
  const result = await callOutside("turnstile", url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: secretKey,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    }),
  }, callOpts);

  // ★ `callOutside` classifies a timeout, a network error and a 5xx/429 the same way every other
  //   adopter reads it — `kind` is one of "timeout" | "dependency" | "rate_limited". All three mean
  //   Cloudflare could not be reached in any way that yields a verdict.
  if (result.kind === "timeout" || result.kind === "dependency" || result.kind === "rate_limited") {
    return Object.freeze({ ok: false, reason: "unreachable" });
  }

  // ★ Cloudflare replied, but not with a 200 and a readable JSON object — e.g. a malformed request
  //   on our side, or an unexpected shape. There is no verdict to read here either, so this is
  //   `unreachable` too: fail-open covers "we cannot tell", not just "nothing answered".
  if (result.status !== 200 || result.body === null || typeof result.body !== "object" || Array.isArray(result.body)) {
    return Object.freeze({ ok: false, reason: "unreachable" });
  }

  // ★ THE ONLY PATH THAT REFUSES A SUBMIT. Cloudflare answered cleanly and said `success: false` —
  //   an active rejection, not an outage — so fail-open does not apply.
  if (result.body.success === true) {
    return Object.freeze({ ok: true, reason: "passed" });
  }
  return Object.freeze({ ok: false, reason: "rejected" });
}

/** What the sign-up page may know: the PUBLIC site key (never the secret), and only when this deployment has one. */
export function botCheckPublicConfig(env = process.env) {
  const siteKey = typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY.trim() : "";
  return siteKey ? { turnstile: { siteKey } } : {};
}

/**
 * ★ Run 4 (10 Oct 2026) — a deployment that is LIVE must not run its sign-up with the bot check silently missing. On production, with the check switched on but no secret key set, sign-up is refused
 *   (a visible, fixable "paused") instead of quietly accepting everyone as "unverified". Anywhere else (local, sandbox, self-host) a missing key keeps the old, forgiving behaviour.
 *   Cloudflare being down is still fail-open (the maintainer's ruling of 17 Sep): that is an outage, this is a configuration gap.
 */
export function assertBotCheckConfigured(env = process.env) {
  if (env.KEYSTONE_ENVIRONMENT === "production" && !(typeof env.TURNSTILE_SECRET_KEY === "string" && env.TURNSTILE_SECRET_KEY.length > 0)) {
    throw dependency("Sign-up is paused for a moment while we finish setting up its protection. Please try again shortly.");
  }
}
