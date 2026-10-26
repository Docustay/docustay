// P18.2 — ★★★ THE RESEND CLIENT. THE FIRST CODE IN THIS PROJECT THAT CONTACTS AN OUTSIDE SERVICE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ ADD-2, MEASURED AND STILL TRUE UNTIL THIS FILE: *"Zero `fetch(` calls exist in `src/`. No external
//    provider is ever contacted."* `createStripeCustomer` and `registerSendingDomain` take an injected
//    `fetchImpl` and were proven against fakes — correct for a gate, and it means **no live call had ever
//    been made.** This module is the same shape, and that is deliberate: the injection is what lets the
//    red-first drive a 500 without asking a real provider to fail.
//
// ★★★ THE API KEY IS READ AT CALL TIME AND THE ABSENCE IS FATAL. Never `process.env.KEY || 'literal'`:
//     a hardcoded fallback turns "this deployment has no credential" into "this deployment silently
//     sends from somebody else's account, or silently sends nothing". The failure must arrive at the
//     first send, loudly, naming the variable.
//
// ★ WHAT THIS MODULE DOES NOT DO: decide whether to send, render anything, or write to the database.
//   It performs one HTTP request and reports what happened. `send.mjs` owns the record.

import { callOutside } from "../http/outside.mjs";
import { captureTarget, captureSend } from "./capture.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH, read fresh every call, no cache (flags.mjs's own rule).
//   ★★ F-PENDING (filed to FINDINGS.md by this task) — `tenantId` below is OPTIONAL and defaults to
//      `null` because `sendViaResend`'s real callers (src/email/send.mjs and others) are OUTSIDE
//      this task's file list (9.13 names only these eight provider modules) and so are not edited
//      here to supply one. When `tenantId` is null the guard is INERT — it does not refuse — which
//      means `resend_enabled` genuinely stops new email only for a caller that passes a tenantId
//      (this module's own test coverage does). A follow-up task must thread `tenantId` through
//      `send.mjs:166` (and the other unguarded callers) before this kill switch is load-bearing for
//      production email. Precedent: F619 left `src/storage/s3.mjs` similarly unconverted by 9.6 for
//      an analogous file-scope reason.
import { withTenant } from "../db/index.mjs";
import { flagIsOn } from "../platform/flags.mjs";

const RESEND_URL = "https://api.resend.com/emails";

/** ★ 03's kinds from Resend's status code: 429 rate_limited · 408 timeout · 5xx dependency · 401/403 forbidden ·
 *  any other 4xx validation (the message itself was refused — sending it again cannot change the answer). */
function kindForStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "dependency";
  if (status === 401 || status === 403) return "forbidden";
  return "validation";
}

// ★★★ R66 (Task 6 fix round 1) — IN DOUBT BY STATUS: a 502 or 504 comes from Resend's EDGE, and the origin behind it
//     may have accepted the message (review I-3). Such an answer is `ambiguous` — the same fact as our own timeout.
//     With the Idempotency-Key it is retried safely; without one (legacy) it would be given up in doubt.
const IN_DOUBT_STATUS = new Set([502, 504]);

// ★★ R66 — Resend's idempotency refusals, told apart by the error's `name` — Resend's machine-readable code, not its
//    prose (MEASURED, resend.com/docs/api-reference/errors, 18 Sep 2026):
//      409 invalid_idempotent_request      the key was used in the last 24 h with a DIFFERENT body. Our body is the
//                                          stored one, so this is a fault in our code — and the first send under the
//                                          key may have gone: in doubt, not retried.
//      409 concurrent_idempotent_requests  a request with the same key is still being processed: in doubt, retried.
//      400 invalid_idempotency_key         the key is not 1–256 characters: a fault in our code (validation).
const IDEMPOTENCY_MISMATCH = "invalid_idempotent_request";
const IDEMPOTENCY_CONCURRENT = "concurrent_idempotent_requests";

/**
 * ★★ R66 — THE EXACT BODY Resend is sent, as text. Built ONCE per delivery (email/send.mjs stores it on the
 *    delivery row) and re-sent byte-identical on every retry under the same Idempotency-Key.
 */
// ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — `html` is OPTIONAL and additive: every existing
//   caller passes only `to/from/subject/text` and gets the exact byte-identical body it always did
//   (Resend accepts `text` alone). The signing email is the first caller to also pass `html`.
// ★ FIX, 30 Sep 2026 (documents "email the signed copy" brief) — `attachments` added, additively:
//   Resend's own shape is `[{filename, content}]` with `content` as BASE64 (not raw bytes — a raw
//   Buffer serialised through JSON.stringify becomes `{"0":137,"1":80,…}`, a per-byte object, which
//   is why the caller must pass base64 text, never a Buffer, here).
export function resendRequestBody({ to, from, subject, text, html = null, replyTo = null, attachments = null, headers = null }) {
  for (const [name, value] of Object.entries({ to, from, subject, text })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`sendViaResend: ${name} is required and must be a non-empty string`);
    }
  }
  if (html !== null && (typeof html !== "string" || html.trim() === "")) {
    throw new Error("sendViaResend: html, when given, must be a non-empty string");
  }
  if (attachments !== null) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      throw new Error("sendViaResend: attachments, when given, must be a non-empty array");
    }
    for (const a of attachments) {
      if (!a || typeof a.filename !== "string" || !a.filename.trim() || typeof a.content !== "string" || !a.content) {
        throw new Error("sendViaResend: each attachment needs a non-empty {filename, content (base64)}");
      }
    }
  }
  return JSON.stringify({
    from, to: [to], subject, text,
    ...(html ? { html } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(attachments ? { attachments } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),   // Launch step 3: List-Unsubscribe on the welcome series
  });
}

export class EmailConfigError extends Error {
  constructor(message) { super(message); this.name = "EmailConfigError"; }
}

/**
 * ★★ THE KEY, AND THE REASON THIS IS A FUNCTION RATHER THAN A MODULE-LEVEL CONSTANT: a constant is read
 *    at import time, so a process that imports this module during startup would fail before the health
 *    check could report WHICH invariant was missing — and a startup crash with no readiness detail is
 *    the thing §P12.6 spent a phase fixing.
 */
export function resendApiKey(env = process.env) {
  const key = env.RESEND_API_KEY;
  if (typeof key !== "string" || key.trim() === "") {
    throw new EmailConfigError(
      // Shown to people on screens (Settings > Email, Add domain), so plain words. There is deliberately NO fallback key: a hardcoded one would make a credential-less deployment send from the wrong account instead of refusing.
      "Email is not set up on this server, so no email can be sent. Whoever runs the server needs to add its email provider key (RESEND_API_KEY) to the app and the worker.");
  }
  return key;
}

/** ★ Is email configured at all? Used to record `skipped` honestly instead of `failed`. */
export function emailIsConfigured(env = process.env) {
  if (captureTarget(env)) return true;   // sandbox capture needs no provider key
  try { resendApiKey(env); return true; } catch { return false; }
}

/**
 * ★★★ ONE REQUEST. Returns a DESCRIPTION of the outcome and never throws for a provider failure.
 *
 * ★★ WHY IT DOES NOT THROW ON A 500: the caller's job is to RECORD what happened, and a thrown error
 *    tempts a caller into a bare `catch {}` — which is precisely how "a send failure inferred from
 *    silence" happens. A returned `{ok: false, status, error}` has to be looked at.
 *  ★ It DOES throw for a missing key (a configuration fault, not a delivery outcome) and for an
 *    unusable argument, because neither is something to record against a message.
 *
 * @returns {Promise<{ok: boolean, status: number|null, providerMessageId: string|null,
 *                     response: unknown, error: string|null}>}
 */
export async function sendViaResend(
  { to, from, subject, text, html = null, replyTo = null, attachments = null, headers = null, rawBody = null, idempotencyKey = null, tenantId = null },
  { fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 15_000 } = {}
) {
  // Launch step 8 — THE LAST LINE FOR A DEMO: a caller that names the workspace and reaches this door for a demo workspace has its message held (recorded for the demo inbox), never sent
  if (tenantId !== null && !rawBody) { const h = await heldAtTheDoor(tenantId, { to, subject, text, html }); if (h) return { ok: true, status: 200, providerMessageId: h.providerMessageId, response: { held: true }, error: null, kind: null, ambiguous: false, retryAfterSeconds: null, providerMessage: null, networkCode: null, timeoutMs: null }; }
  // sandbox mail capture: the message goes to the capture server and nowhere else (see capture.mjs)
  if (captureTarget(env)) {
    const m = rawBody ? JSON.parse(rawBody) : { from, to: [to], subject, text, html, reply_to: replyTo, attachments, headers };
    return captureSend({ to: Array.isArray(m.to) ? m.to[0] : m.to, from: m.from, subject: m.subject, text: m.text, html: m.html ?? null, headers: m.headers ?? null, replyTo: m.reply_to ?? null, attachments: m.attachments ?? null }, { env });
  }
  // ★★★ Task 9.13 — THE GUARD, AT THE TOP. Only checked when a caller supplies `tenantId` — see
  //     the import comment above for why that is currently every caller in `test/kill_switches.test.mjs`
  //     and no caller in production yet.
  if (tenantId !== null) {
    const resendEnabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "resend_enabled", tenantId));
    if (!resendEnabled) {
      return {
        ok: false, status: null, providerMessageId: null, response: null,
        error: "resend_enabled is off for this practice — a platform operator turned it off. No " +
          "email can be sent until it is switched back on.",
        kind: "forbidden", ambiguous: false, retryAfterSeconds: null, providerMessage: null,
        networkCode: null, timeoutMs: null,
      };
    }
  }
  const key = resendApiKey(env);                  // ★ throws EmailConfigError, by design
  // ★ R66: a caller that stored the body (a notification delivery) passes it whole; everyone else passes fields.
  if (rawBody !== null && (typeof rawBody !== "string" || rawBody.trim() === "")) {
    throw new Error("sendViaResend: rawBody, when given, must be the non-empty JSON text to send");
  }
  const requestBody = rawBody ?? resendRequestBody({ to, from, subject, text, html, replyTo, attachments, headers });
  // ★★★ THE BACKSTOP (QUEUE §12.1, sandbox): outside production, the provider is NEVER called for a recipient that is
  //     not an allowlisted test inbox. `redirectForEnvironment` already rewrites most callers' recipients before they
  //     get here, but a caller that skips it (the lead alert in routes/publicLeads.mjs sends to a fixed address) would
  //     otherwise email a real person from a sandbox. This is the one place ALL mail passes, so the guarantee lives here.
  if (env.KEYSTONE_ENVIRONMENT !== "production") {
    const allowed = new Set([...String(env.KEYSTONE_EMAIL_ALLOWLIST ?? "").split(","), env.KEYSTONE_STAGING_INBOX ?? ""]
      .map((a) => a.trim().toLowerCase()).filter(Boolean));
    let recipients = [];
    try { const b = JSON.parse(requestBody); recipients = [].concat(b?.to ?? []); } catch { recipients = [].concat(to ?? []); }
    const stray = recipients.map((r) => String(r).toLowerCase()).filter((r) => !allowed.has(r.replace(/^.*<([^>]+)>.*$/, "$1")));
    if (stray.length > 0 || recipients.length === 0) {
      return {
        ok: false, status: null, providerMessageId: null, response: null,
        error: `not sent: this is ${JSON.stringify(env.KEYSTONE_ENVIRONMENT ?? null)}, not production, and ` +
          `${stray.length} recipient(s) are not in KEYSTONE_EMAIL_ALLOWLIST / KEYSTONE_STAGING_INBOX`,
        kind: "forbidden", ambiguous: false, retryAfterSeconds: null, providerMessage: null, networkCode: null, timeoutMs: null,
      };
    }
  }
  if (idempotencyKey !== null && (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 256)) {
    throw new Error("sendViaResend: idempotencyKey must be 1–256 characters (Resend's limit)");
  }

  // ★★ Task 9.6 (CT-064) — the transport (the timer, the abort, the fetch itself) moved onto
  //    `callOutside`. Resend's OWN business meaning — which status is in-doubt, which is an
  //    idempotency-key collision — is still decided HERE, from the raw status/body `callOutside`
  //    hands back, exactly as before: a change of transport, not of contract. This function's
  //    return shape is unchanged field-for-field; `send.mjs` (9.9's, not opened by this task) reads
  //    it exactly as it did before this move.
  const result = await callOutside("resend", RESEND_URL, {
    method: "POST",
    headers: {
      // ★ The key goes in a HEADER and is never logged, never echoed, never put in a body that a
      //   request log might record whole.
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // ★★ R66 — the same key and the same bytes on every attempt: Resend sends it once and replays its id.
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: requestBody,
  }, { fetchImpl, timeoutMs });

  if (result.status === null) {
    // ★ A network failure, a DNS failure or our own timer firing. Reported the same way a 500 is,
    //   because to the person waiting for the email they are the same event.
    // ★★★ Stage 4 Task 6 — BUT NOT RETRIED THE SAME WAY. Whether the request LEFT decides whether a
    //     retry could send the email twice (02 §2.6). `callOutside`'s `ambiguous` field carries that
    //     distinction, and it also carries the transport's own code as `networkCode` (null when our timer fired).
    return {
      ok: false, status: null, providerMessageId: null, response: null,
      error: result.timedOut
        ? `resend did not respond within ${timeoutMs}ms`
        : `resend request failed (${result.kind ?? "dependency"})`,
      kind: result.timedOut ? "timeout" : "dependency",
      ambiguous: result.ambiguous, retryAfterSeconds: null, providerMessage: null, networkCode: result.networkCode ?? null,
      // ★ Only when OUR timer fired — a dropped connection is not a timeout and its reason must not say so.
      timeoutMs: result.timedOut ? timeoutMs : null,
    };
  }

  const body = result.body;
  if (!result.ok) {
    const name = typeof body?.name === "string" ? body.name : null;
    const mismatch = result.status === 409 && name === IDEMPOTENCY_MISMATCH;
    const concurrent = result.status === 409 && name === IDEMPOTENCY_CONCURRENT;
    const inDoubt = IN_DOUBT_STATUS.has(result.status) || mismatch || concurrent;
    const rawText = typeof body === "string" ? body : (body == null ? "" : JSON.stringify(body));
    return {
      ok: false, status: result.status, providerMessageId: null, response: body,
      // ★★ THE PROVIDER'S OWN WORDS, not a re-description. Substring-matching a vendor message to
      //    classify it is forbidden (errors.mjs:1-9); inventing our own text here would be the same
      //    mistake from the other end — two descriptions of one failure, free to drift apart.
      error: `resend responded ${result.status}: ${(body?.message ?? rawText ?? "").toString().slice(0, 300)}`,
      // ★ Stage 4 Task 6 — the failure's CLASS, decided from the status code (never the message), and the
      //   provider's Retry-After when it sent one.
      kind: mismatch ? "internal" : concurrent ? "dependency" : result.status === 504 ? "timeout" : kindForStatus(result.status),
      // ★ R66: in doubt — the message may have been accepted (behind a 502/504, or under the key already used).
      ambiguous: inDoubt, idempotencyMismatch: mismatch,
      retryAfterSeconds: result.status === 429 ? result.retryAfterSeconds : null,
      providerMessage: (body?.message ?? rawText ?? "").toString().slice(0, 300),
    };
  }
  return {
    ok: true, status: result.status,
    providerMessageId: typeof body?.id === "string" ? body.id : null,
    response: body, error: null, kind: null, ambiguous: false, retryAfterSeconds: null, providerMessage: null,
  };
}

/** Is this workspace a demo? Then record the message for its inbox and say so (null otherwise). Dynamic imports keep this file's own imports as they were. */
async function heldAtTheDoor(tenantId, message) {
  try {
    const { isDemoTenantId } = await import("../product/demo.mjs");
    if (!(await isDemoTenantId(tenantId))) return null;
    const { withTenant } = await import("../db/index.mjs"); const { holdMail } = await import("../product/demoHold.mjs");
    return await withTenant(tenantId, (tx) => holdMail(tx, message));
  } catch { return null; }
}
