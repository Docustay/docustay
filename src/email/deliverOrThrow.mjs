// src/email/deliverOrThrow.mjs — Stage 4 Task 13 fix round 1 (F526 / review C1).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT WAS WRONG, MEASURED THREE TIMES. `sendViaResend`'s own header is explicit: it "never
//     throws for a provider failure" — a 500, a 429, a timeout, or a network failure all RESOLVE
//     `{ok: false, status, error, kind, ...}` (src/email/resend.mjs:98-108). Three call sites all
//     follow the same BEGIN → verdict → send → COMMIT shape, where the whole point is "a thrown send
//     rolls the platform fact back with it" — and every one of them called `deliver(...)` and moved
//     straight to `await query("COMMIT")` without ever reading the resolved value's `.ok`:
//       src/health/alerts.mjs:60          (notifyTransitions)
//       src/health/workerWatch.mjs:83     (tickWorkerWatch)
//       src/health/dailySummary.mjs:226   (sendDailySummary)
//     So the common real-world failure — an HTTP error response, not a thrown network exception —
//     was recorded and reported as a SUCCESSFUL send in all three places (FINDINGS.md F526). Every
//     existing test in all three files only ever exercised a `send` double that THROWS or resolves
//     `{ok: true}`; none exercised the actual `sendViaResend` contract on a real provider failure.
//
// ★★ ONE HELPER, so the fix — and any future audit of "does this deliver-then-commit shape check the
//    result?" — has exactly one place to look. Callers keep their own BEGIN/COMMIT/ROLLBACK exactly
//    as they were (alerts.mjs is LIVE on production; its rollback-on-throw contract is unchanged) —
//    this only decides whether the call counts as having succeeded AT ALL.
//
// ★ THE REASON CARRIES NO SECRETS. `sendViaResend`'s own `.error` field is already a rendered,
//   bounded (300-char) description built from the HTTP status and the PROVIDER'S own words
//   (resend.mjs:157) — the API key is never in the response body or in `.error`. This helper adds
//   nothing beyond restating `.status` and `.error`; it never touches `.response` (the raw provider
//   body) or any header.

/**
 * Calls `deliver(message)` and, unless the resolved result has `ok === true`, THROWS instead of
 * returning it — carrying a plain reason (the HTTP status and the provider's own words, exactly as
 * `sendViaResend` already renders them). A caller whose `deliver` throws on its own (a network
 * exception, a config error) is unaffected — that already propagates before this ever runs.
 *
 * @param {(msg: object) => Promise<{ok: boolean, status?: number|null, error?: string|null}>} deliver
 * @param {object} message  the same message shape `deliver` already takes
 * @returns {Promise<object>} the resolved result, only when `result.ok === true`
 */
export async function deliverOrThrow(deliver, message) {
  const result = await deliver(message);
  if (result?.ok !== true) {
    const status = result?.status ?? "no status";
    const reason = result?.error ?? "no reason given";
    throw new Error(`email send failed (status ${status}): ${reason}`);
  }
  return result;
}
