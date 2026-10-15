// P1.13 — STRUCTURED ERROR TAXONOMY + REQUEST IDS.
//
// ★ WHY A CLOSED TAXONOMY RATHER THAN ad-hoc `throw new Error("...")`:
// Callers — including the retry logic in P2's provisioning state machine — have to decide
// whether a failure is worth retrying. That decision cannot be made by pattern-matching on a
// message string. `retryable` is a property of the error KIND, decided once, here.
//
// ★★ A `NoTenantContext` is a 401 and is NEVER retryable. Retrying it would turn a missing
// credential into a hammering loop against the database.

import { randomUUID } from "node:crypto";

/** The closed set. Adding a kind is a deliberate edit, not an accident at a call site. */
export const ErrorKind = Object.freeze({
  VALIDATION: "validation",         // 400 — the request is malformed. Never retryable.
  UNAUTHENTICATED: "unauthenticated", // 401 — no/ bad credential. Never retryable.
  FORBIDDEN: "forbidden",           // 403 — authenticated, not allowed. Never retryable.
  NOT_FOUND: "not_found",           // 404
  CONFLICT: "conflict",             // 409 — idempotency replay mismatch, unique violation
  UNPROCESSABLE: "unprocessable",   // 422 — C1.9 required fields validation. Never retryable.
  RATE_LIMITED: "rate_limited",     // 429 — retryable, AFTER the retry-after interval
  DEPENDENCY: "dependency",         // 502 — a vendor failed. Retryable.
  TIMEOUT: "timeout",               // 504 — retryable, and ★ MAY HAVE SUCCEEDED REMOTELY (see P2.4)
  INTERNAL: "internal",             // 500 — a bug. Not retryable; retrying a bug just repeats it.
});

const STATUS = {
  [ErrorKind.VALIDATION]: 400,
  [ErrorKind.UNAUTHENTICATED]: 401,
  [ErrorKind.FORBIDDEN]: 403,
  [ErrorKind.NOT_FOUND]: 404,
  [ErrorKind.CONFLICT]: 409,
  [ErrorKind.UNPROCESSABLE]: 422,
  [ErrorKind.RATE_LIMITED]: 429,
  [ErrorKind.DEPENDENCY]: 502,
  [ErrorKind.TIMEOUT]: 504,
  [ErrorKind.INTERNAL]: 500,
};

// ★ Retryability is decided ONCE, by kind. Not at the call site, not by reading a message.
const RETRYABLE = new Set([ErrorKind.RATE_LIMITED, ErrorKind.DEPENDENCY, ErrorKind.TIMEOUT]);

// ★ CT-001 / Q0-1 — `fields` is a FLAT object: { "<dotted.path>": "<one sentence>" }. String values,
//   no nesting, no arrays. A screen looks a field up by name and never iterates. Anything else is a
//   programming error and is refused at construction, the way an unknown kind is.
function assertFieldsShape(fields) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("AppError: fields must be a flat object of { \"<dotted.path>\": \"<one sentence>\" }");
  }
  for (const [path, message] of Object.entries(fields)) {
    if (typeof message !== "string") {
      throw new Error(`AppError: fields["${path}"] must be a string (no nesting, no arrays, no numbers)`);
    }
  }
}

// ★ CT-001 / Q0-2 — what a 5xx says to a user. The real message stays on the object for the server log;
//   only the serialised body is generic.
const genericServerMessage = (requestId) =>
  `Something went wrong on our side. The support team can look this up with request id ${requestId ?? "unavailable"}.`;

// ★★ R-5-18 (RULED 21 Sep 2026, Option A) — THE ONE EXEMPTION FROM F479's "A 5xx MESSAGE IS GENERIC".
//   The sign-in page's answer to a misconfigured deployment IS "Sign-in is not configured on this
//   deployment" — an operator diagnostic that names no SQL, table, vendor key or stack. The exemption is
//   membership in this WeakSet, and the ONLY code that adds to it is `configurationStatement()` below: it is
//   not a constructor option, not a property a call site can set, and not a kind. So `internal`,
//   `dependency` and `timeout` (and every `AppError` built any other way) keep the generic sentence.
//   ★ Deliberately NOT a tenth `ErrorKind`: the taxonomy stays closed at nine (test/s5_error_envelope.test.mjs (a)
//   asserts it), and on the wire this is the same `kind: "internal"`, `retryable: false` it was before Stage 5.
const OPERATOR_SAFE = new WeakSet();

export class AppError extends Error {
  constructor(kind, message, { detail, fields, cause, requestId } = {}) {
    super(message, { cause });
    if (!STATUS[kind]) throw new Error(`AppError: unknown kind "${kind}"`);
    if (fields !== undefined) assertFieldsShape(fields);
    this.name = "AppError";
    this.kind = kind;
    this.statusCode = STATUS[kind];
    this.retryable = RETRYABLE.has(kind);
    this.detail = detail;
    this.fields = fields;
    this.requestId = requestId;
  }

  /**
   * The client-facing shape — CT-001: `{ error: { kind, message, requestId, retryable, detail?, fields? } }`.
   * ★ `detail` and `fields` are included ONLY for 4xx. A 5xx detail is internal — it can carry a SQL
   * fragment, a table name or a vendor payload, and none of that belongs in a response to a client device.
   * §K3: staff code ships to client devices, so "the client is trusted" is never available here.
   * ★★ A 5xx `message` is REPLACED by the generic sentence (F479). `this.message` is left intact, so the
   * `console.error` in the error sink still logs the real cause — it is withheld from the body, not destroyed.
   * ★ `retryable` is always present: the value `RETRYABLE` decided once, by kind.
   */
  toResponse() {
    const is5xx = this.statusCode >= 500;
    const body = {
      error: {
        kind: this.kind,
        message: is5xx && !OPERATOR_SAFE.has(this) ? genericServerMessage(this.requestId) : this.message,
        requestId: this.requestId,
        retryable: this.retryable,
      },
    };
    if (!is5xx && this.detail !== undefined) body.error.detail = this.detail;
    if (!is5xx && this.fields !== undefined) body.error.fields = this.fields;
    return { status: this.statusCode, body };
  }
}

export const invalid = (message, detail) => new AppError(ErrorKind.VALIDATION, message, { detail });
export const unauthenticated = (message = "not authenticated") => new AppError(ErrorKind.UNAUTHENTICATED, message);
export const forbidden = (message = "not permitted", detail) => new AppError(ErrorKind.FORBIDDEN, message, detail === undefined ? undefined : { detail });
export const notFound = (message = "not found") => new AppError(ErrorKind.NOT_FOUND, message);
/**
 * ★★★ 05 §2b.5 / 7.12a — THE SECOND REFUSAL SHAPE, NEVER CHOSEN BY HAND AT A CALL SITE. A single,
 *     EXISTING record a role's grant puts out of scope answers with exactly `notFound`'s own default
 *     message — a fixed sentence, unchanged by the reason — so the response cannot be used to learn
 *     whether the record exists and is merely out of reach, or never existed at all (the same
 *     enumeration-oracle discipline `src/auth/linkToken.mjs`'s `LINK_TOKEN_REFUSED` applies to a
 *     signed link, applied here to an ordinary session's reads and writes). `outOfScope` is distinct
 *     from `notFound` only in NAME, so the call site that reaches for it (`src/routes/writes.mjs`'s
 *     `assertMay` catch) records ITS OWN reasoning — "this row exists, this role cannot see it" —
 *     rather than reusing a name that means "there was never a row".
 */
export const outOfScope = (message = "not found") => new AppError(ErrorKind.NOT_FOUND, message);
export const conflict = (message, detail) => new AppError(ErrorKind.CONFLICT, message, { detail });
export const unprocessable = (message, detail) => new AppError(ErrorKind.UNPROCESSABLE, message, { detail });
export const rateLimited = (message, detail) => new AppError(ErrorKind.RATE_LIMITED, message, { detail });
export const dependency = (message, cause) => new AppError(ErrorKind.DEPENDENCY, message, { cause });
export const timeout = (message, cause) => new AppError(ErrorKind.TIMEOUT, message, { cause });
export const internal = (message, cause) => new AppError(ErrorKind.INTERNAL, message, { cause });

/**
 * ★★★ F17 §3 — THE CAPABILITY-GATED REFUSAL SHAPE.
 * Returns a 403 with detail {capability, tier, detail} — the single refusal shared across all
 * tier-gated routes so every locked screen dresses the same refusal the same way.
 * @param {string} capability - e.g. "growth.campaigns"
 * @param {string} tier - e.g. "Solo", "Grow", "Professional"
 * @param {string} detail - e.g. "Campaigns are on the Grow tier."
 */
export function refuseTierLocked(capability, tier = "", detail = "") {
  return new AppError(
    ErrorKind.FORBIDDEN,
    `this capability is not available on your tier`,
    { detail: { capability, tier, detail } }
  );
}

/**
 * ★ R-5-18 — a 503 whose message is a CONFIGURATION STATEMENT and goes to the client verbatim.
 * ★★ USE ONLY for a fixed, hand-written sentence about how this deployment is set up ("Sign-in is not
 *   configured on this deployment"). NEVER pass a caught error's message, a query, a path, an env value or
 *   anything built from data — that is exactly what F479's generic-500 rule exists to withhold.
 * Wire shape: `kind: "internal"`, status 503, `retryable: false` (a missing setting does not fix itself on
 * retry), no `detail`/`fields`. `requestId` is stamped by `toAppError` / the caller like any other error.
 */
export function configurationStatement(message, { requestId } = {}) {
  if (typeof message !== "string" || message.length === 0) {
    throw new Error("configurationStatement: a non-empty fixed sentence is required");
  }
  const e = new AppError(ErrorKind.INTERNAL, message, { requestId });
  e.statusCode = 503;
  OPERATOR_SAFE.add(e);
  return e;
}

/** Request id: honour an inbound one so a trace survives across services, else mint one. */
export function resolveRequestId(headers = {}) {
  const inbound = headers["x-request-id"] ?? headers["X-Request-Id"];
  // ★ Validate rather than trusting it — an unbounded header echoed into every log line is a log
  // injection vector and a storage problem.
  if (typeof inbound === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(inbound)) return inbound;
  return randomUUID();
}

/** Normalise anything thrown into an AppError, so the boundary always returns the same shape. */
export function toAppError(err, requestId) {
  if (err instanceof AppError) {
    if (requestId && !err.requestId) err.requestId = requestId;
    return err;
  }
  if (err?.name === "NoTenantContext") {
    return new AppError(ErrorKind.UNAUTHENTICATED, err.message, { requestId });
  }
  // ★★★ TASK 11.19 — THE PRACTICE-LESS CHAIN'S THREE NAMED 403s. Name-based, exactly like the case
  //   above, so `src/paths/index.mjs` keeps its no-imports property. A class name this function does
  //   not know becomes a 500 — the failure 11.19 exists to remove — so all three names are listed.
  if (["PracticeChainRefused", "PlatformGrantRequired", "PlatformSessionRequired"].includes(err?.name)) {
    return new AppError(ErrorKind.FORBIDDEN, err.message, { requestId });
  }
  // ★★★ A CALLER'S BAD INPUT IS A 400, NOT A 500 — ADDED AT P21C.2, WHICH MEASURED THE OPPOSITE.
  //     MEASURED: `POST /api/developer/api-keys` with a missing `name` returned **500** to seven of
  //     eight identities. The handler had correctly refused — `TokenError: a token needs a name` from
  //     `src/auth/apiToken.mjs:185` — but `TokenError` is neither an AppError nor a Postgres code, so
  //     it fell through to INTERNAL.
  //   ★★ That is worse than cosmetic. A 500 tells the caller "we broke" when the truth is "you left a
  //      field out", it is the one status a client is entitled to retry blindly, and it makes a REAL
  //      server fault indistinguishable from a bad request in the logs. ★ Mapping it to VALIDATION is
  //      a correctness fix, not a loosening: the request is still refused, and now for the right reason.
  //   ★ `TokenConfigError` is deliberately NOT mapped. That one means the PEPPER is missing or too
  //     short — a server misconfiguration the caller cannot fix, where 500 is the honest answer.
  if (err?.name === "TokenError") {
    return new AppError(ErrorKind.VALIDATION, err.message, { requestId });
  }
  // ★ The money guards' own refusals (src/money/stripeConnected.mjs, src/money/charge.mjs) carry their
  //   status already — "connect Stripe first" is a state of the practice, not our fault — and fell
  //   through to a 500 with a support request id.
  if (err?.name === "ConnectNotLive") {
    return new AppError(ErrorKind.CONFLICT, err.message, { requestId });
  }
  if (err?.name === "ChargeServiceDisabled") {
    return new AppError(ErrorKind.FORBIDDEN, err.message, { requestId });
  }
  // ★ No object storage on this deployment is a CONFIGURATION fact, not a crash — a 503 with a fixed
  //   sentence (R-5-18), never the caught message (it names env vars). Was a 500 on every page load
  //   of the sidebar logo wherever storage is not set up (local dev, 26 Sep 2026).
  if (err?.name === "StorageConfigError") {
    const e = configurationStatement("File storage is not configured on this deployment", { requestId });
    return e;
  }
  // ★ F479 (second half) — a bad webhook signature is a 401, not a 500. Matched by `name` so this module
  //   does not import `src/webhooks/verify.mjs`. The class's own `reason` (which failure mode) is for the
  //   server log and is deliberately NOT copied here: one message for every mode, no oracle for a forger.
  if (err?.name === "WebhookUnverified") {
    return new AppError(ErrorKind.UNAUTHENTICATED, "the webhook signature did not verify", { requestId });
  }
  // ★ Postgres error codes worth classifying rather than burying as a 500.
  // ★★ 23502 (not_null_violation) IS THE CALLER'S OMISSION, NOT A SERVER FAULT — added at P21C.2
  //    alongside a specific fix in `setBookingPolicy`. The specific fix names the field, which is the
  //    better message; this is the NET, so the next route that forgets to validate a required field
  //    returns 400 rather than 500 while nobody is looking. ★ Two mechanisms for one rule, deliberately.
  if (err?.code === "23502") {
    return new AppError(ErrorKind.VALIDATION,
      `a required field was missing: ${err.column ?? "unknown column"}` +
      (err.table ? ` on ${err.table}` : ""), { requestId });
  }
  if (err?.code === "23505") return new AppError(ErrorKind.CONFLICT, "unique violation", { requestId });
  if (err?.code === "23503") return new AppError(ErrorKind.CONFLICT, "referenced row missing", { requestId });
  if (err?.code === "42501") return new AppError(ErrorKind.FORBIDDEN, "insufficient privilege", { requestId });
  // ★ A malformed id in a URL (a typo, a truncated link) is "there is no such record", not our fault: Postgres refuses the text as a uuid (22P02). Found 8 Oct 2026 by sweeping eight Docustay routes that answered 500 for /…/not-a-uuid while their siblings answered 400.
  if (err?.code === "22P02" && /\buuid\b/i.test(String(err?.message ?? ""))) return new AppError(ErrorKind.NOT_FOUND, "not found", { requestId });
  // ★ Round 3 (W1-6) — Postgres cannot store a NUL character in text or jsonb. A caller who typed one (or sent \u0000 in JSON) made a bad request: 400 with a plain sentence, not a 500.
  if ((err?.code === "22021" || err?.code === "22P05") && /0x00|u0000/i.test(String(err?.message ?? ""))) {
    return new AppError(ErrorKind.VALIDATION, "text cannot contain a NUL character", { requestId });
  }
  // ★ Round 3 (W1-6) — Hono's own HTTPException (thrown by its body validator and middleware) carries the status it means. It used to fall through to a 500: an invalid JSON body, a body that is not JSON at all, an empty body.
  //   Duck-typed (a status and getResponse()) so this module imports nothing from hono.
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 && typeof err?.getResponse === "function") {
    const text = String(err.message ?? "");
    if (err.status === 400 && /malformed json/i.test(text)) return new AppError(ErrorKind.VALIDATION, "The request body is not valid JSON", { requestId });
    if (err.status === 415) return new AppError(ErrorKind.VALIDATION, "The request body must be JSON: send Content-Type: application/json", { requestId });
    if (err.status === 401) return new AppError(ErrorKind.UNAUTHENTICATED, text || "sign in required", { requestId });
    if (err.status === 403) return new AppError(ErrorKind.FORBIDDEN, text || "not allowed", { requestId });
    if (err.status === 404) return new AppError(ErrorKind.NOT_FOUND, text || "not found", { requestId });
    if (err.status === 409) return new AppError(ErrorKind.CONFLICT, text || "conflict", { requestId });
    return new AppError(ErrorKind.VALIDATION, text || "the request is not valid", { requestId });
  }
  return new AppError(ErrorKind.INTERNAL, err?.message ?? "internal error", { cause: err, requestId });
}

/**
 * ★ Round 3 (W1-6) — a handler that reads its own body (`await c.req.json()`) throws a bare SyntaxError for malformed JSON. That is the CALLER's mistake only when the request really was a JSON body:
 *   a write method with a JSON content type. Returns the 400 for that case and null for anything else (a SyntaxError from the server's own parsing stays a 500, so a real fault is never dressed up as a bad request).
 */
export function jsonBodyFault(err, { method = "", contentType = "", requestId } = {}) {
  if (!(err instanceof SyntaxError)) return null;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(String(method).toUpperCase())) return null;
  if (!/json/i.test(String(contentType))) return null;
  if (!/json/i.test(String(err.message ?? ""))) return null;
  return new AppError(ErrorKind.VALIDATION, "The request body is not valid JSON", { requestId });
}
