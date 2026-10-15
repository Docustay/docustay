// P2.4 — PER-PROVIDER RESULT CLASSIFICATION.
//
// ★★★ §P2: "`already_exists` MUST classify as SUCCESS and resolve through find(). This is the
// single most important line of error handling in the system: a timeout that a naive classifier
// reads as non_retryable leaves a live orphaned tenant holding the customer's chosen name."
//
// The failure this prevents, concretely:
//   1. We call Stripe/Twenty/Resend to create X for a new tenant.
//   2. The call SUCCEEDS remotely, and the response is lost — timeout, dropped socket, a deploy.
//   3. We retry. The provider says 409 already_exists.
//   4. ★ A naive classifier calls that an error → the run fails → an operator "cleans up" →
//      but the object IS live at the provider, now orphaned, holding the customer's subdomain
//      or email domain, and the vendors above cannot delete it (§P2's compensation table).
//
// So: already_exists is SUCCESS, and the step then resolves the object through find() to learn
// the id it failed to capture the first time.
//
// ★ A TIMEOUT IS NOT A FAILURE. It is an UNKNOWN. The remote side may well have succeeded. It is
// retryable precisely because the retry will hit already_exists and resolve.

export const Outcome = Object.freeze({
  SUCCESS: "success",
  ALREADY_EXISTS: "already_exists", // ★ a flavour of SUCCESS — see isSuccess()
  RETRYABLE: "retryable",
  AWAITING_HUMAN: "awaiting_human",
  FATAL: "fatal",
});

/** ★ already_exists counts as success. This single line is the point of the file. */
export const isSuccess = (o) => o === Outcome.SUCCESS || o === Outcome.ALREADY_EXISTS;

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const CONFLICT_HTTP = new Set([409]);

/**
 * Classify a provider result.
 * `err` may be an HTTP-ish error ({status, code, message}) or a transport error.
 * ★ S2 TASK 3 — `documenso` was the only provider this function ever special-cased into
 *   `Outcome.AWAITING_HUMAN`, and it is retired (01 default 9). No live path returns AWAITING_HUMAN
 *   today; the value stays exported and handled by `executeStep`/`skipReason` for a future step that
 *   is genuinely human-only, rather than being removed along with the vendor that first needed it.
 */
export function classify(providerName, err) {
  if (!err) return Outcome.SUCCESS;

  // ── transport-level: no response at all ───────────────────────────────────
  // ★ These are the dangerous ones: the request may have been fully processed remotely.
  const transport = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ABORT_ERR", "UND_ERR_CONNECT_TIMEOUT"]);
  if (transport.has(err.code) || err.name === "AbortError" || /timeout/i.test(err.message ?? "")) {
    return Outcome.RETRYABLE;
  }

  const status = err.status ?? err.statusCode;

  // ── provider-specific already-exists shapes ───────────────────────────────
  // ★ Each provider spells it differently, which is exactly why this is per-provider and not a
  // single regex over `message`.
  switch (providerName) {
    case "stripe":
      // Stripe returns 400 with code `resource_already_exists`, NOT a 409.
      if (err.code === "resource_already_exists") return Outcome.ALREADY_EXISTS;
      // ★ An idempotency key replayed against a DIFFERENT body is a client bug, not a retry.
      if (err.code === "idempotency_key_in_use") return Outcome.RETRYABLE;
      break;
    case "twenty":
      if (CONFLICT_HTTP.has(status)) return Outcome.ALREADY_EXISTS;
      if (/already (exists|taken)|duplicate/i.test(err.message ?? "")) return Outcome.ALREADY_EXISTS;
      break;
    case "resend":
      // Resend returns 422 with a name collision for an existing domain.
      if (status === 422 && /already (exists|registered)/i.test(err.message ?? "")) return Outcome.ALREADY_EXISTS;
      if (CONFLICT_HTTP.has(status)) return Outcome.ALREADY_EXISTS;
      break;
    default:
      if (CONFLICT_HTTP.has(status)) return Outcome.ALREADY_EXISTS;
  }

  if (RETRYABLE_HTTP.has(status)) return Outcome.RETRYABLE;

  // ★ 4xx other than the conflicts above is a real client error — retrying repeats the mistake.
  if (typeof status === "number" && status >= 400 && status < 500) return Outcome.FATAL;

  return Outcome.FATAL;
}

/**
 * ★ Backoff with FULL JITTER. Deterministic exponential backoff makes every replica retry at the
 * same instant after a shared outage — a thundering herd that keeps the dependency down. `rand`
 * is injectable so this is testable.
 */
export function backoffMs(attempt, { baseMs = 500, capMs = 60_000, rand = Math.random } = {}) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(rand() * exp);
}
