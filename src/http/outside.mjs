// src/http/outside.mjs — Task 9.1 (CT-064). ONE WRAPPER FOR EVERY OUTSIDE CALL.
//
// ★★★ callOutside() NEVER RETRIES (Q9-4 / CC-1). It classifies a provider's answer — or its
//     absence — into a CT-002 ErrorKind and RETURNS. The job layer's single ladder
//     (src/queue/jobPolicy.mjs's JOB_POLICY) is what retries; per-provider variation here is
//     confined to timeoutMs (default 15 s; Stripe passes 20 000).
//
// ★★ AMBIGUOUS is the field that lets src/money/charge.mjs's "unknown_no_reply" case survive the
//    move onto this wrapper (9.6): true when the request was SENT and no reply was read — a
//    timeout, or a network error AFTER the body left — because the charge MAY have happened and a
//    retry with a new idempotency key could double it. FALSE for a connection refused before
//    anything was sent (the request never left; nothing could have happened remotely), and FALSE
//    for ANY reply, including a 5xx — a reply, even a bad one, settles the question.
//
// ★ callOutside NEVER THROWS FOR A PROVIDER FAILURE. It throws only for a programming error: a
//   missing name, a non-absolute url, or a fetchImpl that is not a function — those are bugs in
//   the CALLER, not facts about the outside world, and must not be swallowed into a false
//   "dependency down".
//
// This file has no call sites yet. The nine other fetch sites move onto it in 9.6/9.7.

import { ErrorKind } from "./errors.mjs";
import { assertAllowedUrl, makeGuardedFetch, localDestinationsAllowed } from "./publicDestination.mjs";

// ★ Connect-phase failures: the request never left, so nothing could have happened remotely and a
//   retry cannot duplicate anything. Same set, same reasoning, as src/email/resend.mjs's NEVER_LEFT.
const NEVER_LEFT = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

// ★ The same three kinds src/queue/jobPolicy.mjs's (private) RETRYABLE_KINDS treats as worth
//   another attempt. Not imported — that constant is not exported there — kept in sync by hand,
//   same as jobPolicy.mjs's own comment next to it: retryability is decided once, by kind.
const RETRYABLE_KINDS = new Set([ErrorKind.DEPENDENCY, ErrorKind.TIMEOUT, ErrorKind.RATE_LIMITED]);

/** Retry-After is either delta-seconds or an HTTP date (RFC 9110 §10.2.3). Unreadable → null. */
function parseRetryAfter(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const at = Date.parse(s);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

/** The provider's body, read once: parsed JSON when it is JSON, the raw text otherwise, null when empty. */
async function readBody(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function errCode(e) {
  return e?.code ?? e?.cause?.code ?? null;
}

/**
 * One wrapper for every outside call. Gives it a time limit, maps its outcome to a CT-002
 * ErrorKind, honours Retry-After (either header form), and NEVER retries and NEVER throws for a
 * provider failure — only for a programming error at the call site.
 *
 * @param {string} name - the service label the scrubber and logger key on (e.g. "stripe", "resend").
 * @param {string} url - an absolute http(s) URL.
 * @param {RequestInit} init - passed through to fetchImpl, minus any caller-supplied `signal`
 *   (this wrapper owns the abort signal so the time limit is guaranteed).
 * @param {{fetchImpl?: Function, timeoutMs?: number, retryAfterFrom?: string, raw?: boolean, guard?: {allowLocal?: boolean, maxBytes?: number}}} [opts]
 *   `guard` (security audit run 5, S-5, 10 Oct 2026): opt-in, default off. For a destination an ORGANISATION named (its own AI endpoint) rather than one of ours: the address must be https
 *   (http only when KEYSTONE_ENVIRONMENT is "local"), carry no credentials, and — resolved at connect time, see src/http/publicDestination.mjs — be a PUBLIC address; a redirect is never
 *   followed (the 3xx comes back as it is); the body stops being read at `maxBytes` (default 2 MiB). A destination that is refused returns `{ ok:false, kind:"validation", refused:true }`
 *   and nothing is sent. With an injected `fetchImpl` (a test double) only the as-written checks run and `redirect: "manual"` is added to the request.
 *   `raw` (9.6 Part 2 / F619, CT-064): opt-in, default false. Every existing caller omits it and gets
 *   the byte-for-byte unchanged shape below. Only `src/storage/s3.mjs` passes `raw: true` — see the
 *   `raw === true` branch's own doc note further down.
 * @returns {Promise<Readonly<{ok: boolean, status: number|null, body: any, kind: string|null,
 *   retryable: boolean, retryAfterSeconds: number|null, ambiguous: boolean, timedOut: boolean,
 *   durationMs: number}>>}
 */
export async function callOutside(name, url, init, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  retryAfterFrom = "retry-after",
  raw = false,
  guard = null,
} = {}) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("callOutside: name is required (the service label the scrubber and logger key on)");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`callOutside: url must be an absolute http(s) URL, got: ${String(url)}`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`callOutside: url must be an absolute http(s) URL, got: ${String(url)}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("callOutside: fetchImpl must be a function");
  }

  const started = Date.now();
  // ★ S-5: the destination was named by an organisation. Nothing is sent to one that is not public.
  const refusal = () => Object.freeze({
    ok: false, status: null, body: null, kind: ErrorKind.VALIDATION, retryable: false, retryAfterSeconds: null,
    ambiguous: false, timedOut: false, durationMs: Date.now() - started, refused: true,
  });
  let sendWith = fetchImpl, sendInit = init;
  if (guard) {
    const allowLocal = guard.allowLocal ?? localDestinationsAllowed();
    try { assertAllowedUrl(parsedUrl, { allowLocal }); } catch { return refusal(); }
    if (fetchImpl === globalThis.fetch) sendWith = makeGuardedFetch({ allowLocal, maxBytes: guard.maxBytes ?? 2 * 1024 * 1024 });
    else sendInit = { ...init, redirect: "manual" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await sendWith(url, { ...sendInit, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if (guard && (e?.code === "DESTINATION_REFUSED" || e?.cause?.code === "DESTINATION_REFUSED")) return refusal();
    const durationMs = Date.now() - started;
    // ★ An AbortError is only ever raised by the signal this wrapper owns (its own timer), so it IS the time limit firing
    //   even when the abort reaches us as the thrown error rather than as the signal's state (a fetch that is wrapped or stubbed).
    const timedOut = controller.signal.aborted === true || e?.name === "AbortError" || e?.name === "TimeoutError";
    const neverLeft = !timedOut && NEVER_LEFT.has(errCode(e));
    return Object.freeze({
      ok: false,
      status: null,
      body: null,
      // ★ 9.6 Part 2 / F619: only a `raw: true` caller (src/storage/s3.mjs) gets a `headers` key at
      //   all on this branch — no HTTP response was ever read, so it is `null`, not `{}`. Every
      //   `raw: false`/omitted caller keeps the exact shape CT-064 already documents: no `headers` key.
      ...(raw ? { headers: null } : {}),
      kind: timedOut ? ErrorKind.TIMEOUT : ErrorKind.DEPENDENCY,
      retryable: true,
      retryAfterSeconds: null,
      ambiguous: !neverLeft,
      timedOut,
      // ★ The transport's own code (undici/Node), so a caller can say WHAT broke (e.g. UND_ERR_SOCKET) without matching message text. Only on this branch; null when it timed out.
      networkCode: timedOut ? null : (errCode(e) ?? null),
      durationMs,
    });
  }
  clearTimeout(timer);
  const durationMs = Date.now() - started;

  // ★ 9.6 Part 2 / F619: `raw: true` is the ONLY branch that reads the response as bytes and exposes
  //   headers — every other caller (Stripe, Resend, n8n, the webhook, charge.mjs, senders.mjs) never
  //   passes it and this whole block is unreachable for them; their body/shape is untouched below.
  const body = raw
    ? await res.arrayBuffer().then(Buffer.from).catch(() => null)
    : await readBody(res);
  const headers = raw ? Object.fromEntries(res.headers?.entries?.() ?? []) : undefined;
  const retryAfterSeconds = parseRetryAfter(res.headers?.get?.(retryAfterFrom));

  let kind = null;
  if (res.status === 429) kind = ErrorKind.RATE_LIMITED;
  else if (res.status >= 500) kind = ErrorKind.DEPENDENCY;
  // Any other status — including every other 4xx — is a clean answer from the provider, not a
  // dependency failure: kind stays null and retryable stays false.

  return Object.freeze({
    ok: res.ok,
    status: res.status,
    body,
    // ★ `raw: false`/omitted: no `headers` key at all (not even `undefined`-valued) — spreading
    //   `undefined` into an object literal adds no own property, so CT-064's nine-field shape for
    //   every non-`raw` caller stays byte-for-byte what it was before this task.
    ...(raw ? { headers } : {}),
    kind,
    retryable: kind != null && RETRYABLE_KINDS.has(kind),
    retryAfterSeconds,
    ambiguous: false,
    timedOut: false,
    durationMs,
  });
}
