// P19.6 / P19.7 / P19.7a — OUTBOUND WEBHOOKS: ONE ROW PER ATTEMPT, SIGNED PER ENDPOINT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE RULE THIS FILE IS SHAPED BY: **NEVER INFER DELIVERY FROM THE ABSENCE OF AN ERROR.**
//     The delivery row is written with `status='attempted'` **and committed** BEFORE the HTTP call, so
//     a crash mid-flight leaves evidence that we tried. A design that writes the row afterwards
//     records nothing for exactly the deliveries a human most needs to ask about.
//   ★ This is the same ordering `src/email/send.mjs` uses, and for the same reason.
//
// ★★★ THE SIGNATURE IS PER ENDPOINT, NOT PER TENANT AND NOT GLOBAL.
//     A receiver can only verify what it holds a secret for, and one shared secret would mean
//     rotating it for one integration breaks every other. The secret is SEALED via
//     `sealSecret({ purpose: 'webhook_hmac', tenantId })` — AAD on the tenant, so an envelope lifted
//     from one tenant's row cannot be opened in another's context even by code holding the master key.
//
// ★★ P19.7a — `kek_version` TRAVELS WITH THE ENVELOPE. `envelope.mjs` returns `v:1`, which is a FORMAT
//    version and NOT a key identifier, so after a `KEYSTONE_MASTER_KEY` rotation there is no way to
//    tell an old envelope from a new one except by trying to open it — and `SecretOpenError` is
//    deliberately undifferentiated, so you cannot probe. The column is what makes the advertised
//    rotation performable: re-wrap where `kek_version < current`, then bump.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 9 TASK 9.7 (CT-074 / F500) — assertPublicDestination(): AN SSRF GUARD, NOT A SUGGESTION.
//     Until now the ONLY validation on a tenant-supplied webhook URL was `^https://` — no DNS
//     resolution, no private-address check, no redirect policy. A practice's owner could point an
//     endpoint at `169.254.169.254` (a cloud metadata endpoint) or at Railway's own private network,
//     and the worker would sign a request and POST it there on their behalf.
//   ★★ THE GUARD RUNS TWICE, BOTH TIMES SUPPLIED BY THE APPLICATION, NOT A TEST: once when an
//      endpoint is SAVED (`createWebhookEndpoint`, below) so the owner gets an immediate, readable
//      refusal, and again at DELIVERY TIME (`deliverEvent`) so a DNS record that changes after saving
//      does not quietly become a hole.
//   ★ THE REDIRECT IS THE CLASSIC BYPASS. A public host that answers with a 302 to
//     `http://169.254.169.254/` would sail straight through a check that only looked at the URL the
//     owner typed. `redirect: "manual"` plus a re-check on the Location header (`followOneRedirect`,
//     below) closes that — and the underlying transport is never asked to fetch a refused target.
//   ★ It REUSES `isPrivateAddress` (`src/http/trustedIp.mjs:43-48`) rather than writing a second copy
//     of the private-range logic — that function already existed with ZERO callers in `src/`; this is
//     its first real caller.
//
// ★★ WHAT IT DOES NOT DO: decide WHICH events go where (the caller filters on `event_types`), wait for
//    a retry, or throw for a receiver's failure. A failed or timed-out attempt records `next_retry_at`
//    on the 07 schedule (1 min, 5 min, 30 min, 2 h, 12 h — `RETRY_SCHEDULE_SECONDS`, imported from
//    src/events/outbox.mjs) and returns; the per-practice `retry_webhooks` sweep (src/queue/tasks.mjs)
//    re-sends it through this same function once due. The sixth failure sets `dead_at` instead, and the
//    sweep reports it as a job.gave_up platform event. A thrown error invites a bare `catch {}`, and a
//    swallowed catch is how "delivered" comes to mean "we did not look".
//
// ★★★ STAGE 3 TASK 7 (Task 5 review F1) — NEVER A SECOND POST FOR A DELIVERED (event, endpoint).
//     The dispatcher enqueues deliver_webhooks outside its tenant transaction, so a rolled-back dispatch
//     re-runs the listener after the job already POSTed. The guard is HERE, at the delivery end, in the
//     SAME statement that inserts the attempt row: an attempt is only inserted (and so only sent) when the
//     pair has no attempt yet, or its latest failure is DUE for retry — and never once it is delivered or
//     dead. An in-flight attempt (`attempted`) carries no retry time, so it blocks a second sender too.
//     Two senders racing compute the same attempt number and the unique attempt key refuses one; that
//     refusal is reported `skipped`, not sent. Every caller gets this; there is no unguarded path.
//   ★ The event id rides every attempt in the `keystone-event-id` header (and in the body's `id`), the
//     same across retries, so a receiver can drop a duplicate without parsing the body. The signature is
//     recomputed per attempt (it covers a fresh timestamp); the event id is the dedup key.
//   ★ `webhook_endpoint.consecutive_failures` counts failed attempts in a row and resets on a delivery.
//     Nothing pauses or disables an endpoint automatically: no product rule for that exists (the owner
//     pauses one on Settings → Developer), so none is invented here.

import { createHmac, createHash, randomUUID } from "node:crypto";
import { Webhook as StandardWebhook } from "standardwebhooks";
import { promises as dns } from "node:dns";
import { sealSecret, openSecret, CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
import { AppError, ErrorKind } from "../http/errors.mjs";
import { RETRY_SCHEDULE_SECONDS, LISTENER_MAX_ATTEMPTS } from "../events/outbox.mjs";
import { callOutside } from "../http/outside.mjs";
import { isPrivateAddress, isValidIp, normalise as normaliseAddress } from "../http/trustedIp.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH. `pool` (deliverEvent's own param, below) is a per-query shim,
//     not a branded tenant transaction (src/webhooks/subscribers.mjs:107), so it cannot be handed to
//     `flagIsOn` directly — a fresh, short-lived tenant transaction answers the one question, read
//     fresh every call, no cache (flags.mjs's own rule).
import { withTenant } from "../db/index.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { samplePayloadFor } from "./samplePayloads.mjs";   // R13-D230: a test send has the real event's shape

// ★ Task 9.2 moved the KEK generation constant to src/secrets/envelope.mjs (CT-063) and left a
//   second copy here "until Stage 9 task 9.7 deletes it and imports this one" — this is that
//   deletion. Re-exported because db/gates/p19_outbound_webhooks.mjs imports it from THIS module.
export { CURRENT_KEK_VERSION };
export const SIGNATURE_HEADER = "keystone-signature";
export const TIMESTAMP_HEADER = "keystone-timestamp";
/** ★ Stage 3 Task 7 — the event id, identical on every attempt: the receiver's duplicate key. */
const EVENT_ID_HEADER = "keystone-event-id";
/** ★ Fix round 1 (T7-R1) — the error kind stored when an endpoint's signing secret cannot be opened. */
const SECRET_UNAVAILABLE = "secret_unavailable";
/**
 * ★ Fix round 1 — an attempt still `attempted` this long after it started was abandoned mid-send (the worker
 *   died): the send itself is aborted at DELIVERY_TIMEOUT_MS, so nothing live can be older than that plus a
 *   margin for the outcome write. 5 minutes is 20× the timeout.
 */
export const STALE_ATTEMPT_SECONDS = 300;
/** ★ Six attempts: the first, then one after each wait in 07's schedule. The same count as a listener's. */
const WEBHOOK_MAX_ATTEMPTS = LISTENER_MAX_ATTEMPTS;
export const DELIVERY_TIMEOUT_MS = 15_000;

/**
 * ★★★ THIS EXTENDS `AppError` BECAUSE THE PREVIOUS VERSION DID NOT, AND THAT COST A 500.
 *
 *   [MEASURED at the P10 close, `db/gates/p21c_route_role_matrix.mjs`] `POST
 *   /api/developer/webhook-endpoints` returned **500 for EVERY role** — super_admin, tenant_admin
 *   and a foreign tenant's admin alike. The refusal itself was correct: the URL in the fixture was
 *   `http://`, and an HMAC does not hide a body carrying client names and amounts. What was wrong
 *   was the STATUS. This class extended plain `Error` and carried `this.statusCode = 400` as an own
 *   property — **and nothing reads that.** `src/http/errors.mjs` dispatches on `kind` through
 *   `AppError`, so an unrecognised throw falls through to INTERNAL.
 *
 * ★★★ THE CLASS OF DEFECT IS DUPLICATE-TRUTH, NOT A TYPO. P8.5 invented a SECOND error vocabulary
 *     one directory from the first, and the two disagreed about how an error becomes a response.
 *     A hand-written `statusCode` that looks exactly like the real thing is worse than no status at
 *     all: it reads, in review, as though the case had been handled.
 *
 * ★★ AND THE PRODUCT CONSEQUENCE IS NOT COSMETIC. A 500 says *"we broke"* — it is not retryable by
 *    contract, it pages, and `AppError.toResponse()` deliberately STRIPS `detail` from 5xx so the
 *    caller could not even see which rule they had broken. The operator who typed an `http://` URL
 *    got a server error with the reason removed. As a 400 they get the sentence.
 *
 * ★ `instanceof WebhookEndpointInvalid` still holds — `db/gates/p19_outbound_webhooks.mjs:273`
 *   asserts exactly that, and it keeps passing. Subclassing satisfies both truths; replacing the
 *   class with a bare `invalid()` would have satisfied the handler and broken the gate.
 */
export class WebhookEndpointInvalid extends AppError {
  constructor(message) {
    super(ErrorKind.VALIDATION, message);
    this.name = "WebhookEndpointInvalid";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CT-074 / F500 — assertPublicDestination(url)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ Only 443 — the DEFAULT https port — is allowed. Nothing in CT-074 names a second one. */
const ALLOWED_PORTS = new Set([443]);

/**
 * ★ `isPrivateAddress` (reused, not rewritten) covers private/loopback/link-local/unique-local, but
 *   NOT the unspecified address (`0.0.0.0`, `::`) — that is not "private", it is "no address at all",
 *   and a socket connect to it can mean "this host" on some stacks. Refused here, explicitly, rather
 *   than folded into `isPrivateAddress`'s logic, which this task must not rewrite.
 */
const UNSPECIFIED_ADDRESSES = new Set(["0.0.0.0", "::"]);

function isBlockedAddress(rawAddress) {
  const address = (normaliseAddress(rawAddress) ?? String(rawAddress ?? "")).toLowerCase();
  return isPrivateAddress(address) || UNSPECIFIED_ADDRESSES.has(address);
}

/** ★ Strip the [ ] a URL's `.hostname` puts around a literal IPv6 host before handing it to DNS. */
function bareHostname(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * The default resolver: real DNS (or an immediate return for a literal IP — no lookup needed, and
 * none is attempted). `assertPublicDestination`'s `resolve` option overrides this, which is how
 * `test/webhook_ssrf_guard.test.mjs` proves every refused class with NO real DNS traffic.
 */
async function defaultResolve(hostname) {
  if (isValidIp(hostname)) return [hostname];
  const found = await dns.lookup(hostname, { all: true, verbatim: true });
  return found.map((r) => r.address);
}

/**
 * ★★★ THE GUARD. Order matters — it is the order CT-074 specifies: the URL must parse, the scheme
 *     must be exactly `https:`, the host must resolve, every resolved address must be public, and
 *     the port must be an allowed one. Throws `WebhookEndpointInvalid` (a CT-001 `kind: "validation"`
 *     error) naming the reason in plain language. NEVER throws anything else — a resolver failure is
 *     itself a refusal, not a crash.
 *
 * @param {string} url
 * @param {{resolve?: (hostname: string) => Promise<string[]>}} [opts] - `resolve` is the ONLY
 *   injection point, so a test can prove every refused class without a real DNS query.
 */
export async function assertPublicDestination(url, { resolve = defaultResolve } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    throw new WebhookEndpointInvalid("that is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new WebhookEndpointInvalid(
      "a webhook address must start with https://. The events can include names and amounts, and plain http:// would send them where anyone on the way can read them.");
  }
  // ★ Round 3 (W1-7): https://user:pass@host/ — credentials in the address are refused (they would be stored in the clear and sent as a Basic header, and they hide which host is really addressed).
  if (parsed.username || parsed.password) throw new WebhookEndpointInvalid("the address must not contain a username or password");
  const hostname = bareHostname(parsed.hostname); // ★ resolve() always sees a bare host, v4 or v6
  let addresses;
  try {
    addresses = await resolve(hostname);
  } catch {
    addresses = [];
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new WebhookEndpointInvalid("that hostname could not be resolved");
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new WebhookEndpointInvalid("that address is on a private network (such as localhost or an office network), which Docustay cannot reach. Use a public https address; while you are developing, a tunnel that gives your laptop a public address works.");
    }
  }
  const port = parsed.port ? Number(parsed.port) : 443;
  if (!ALLOWED_PORTS.has(port)) {
    throw new WebhookEndpointInvalid(`that address uses a port (${port}) that is not allowed for a webhook destination`);
  }
  return Object.freeze({ url: parsed.toString(), hostname: parsed.hostname, addresses: [...addresses] });
}

/**
 * ★★★ THE REDIRECT BYPASS, CLOSED. Wraps a `fetchImpl` so it is safe to pass to `callOutside` with
 *     `redirect: "manual"`: the first hop is fetched manually; if it is a 3xx, the Location header is
 *     resolved to an absolute URL and re-checked with `assertPublicDestination` BEFORE it is ever
 *     followed — a public host that redirects to `169.254.169.254` is refused, and the real transport
 *     (`fetchImpl`) is never called a second time for that target. At most ONE redirect is followed.
 *   ★ `callOutside`'s own return shape carries no header and no message, only a `kind` — so a refusal
 *     discovered HERE is reported back through `onRefusal`, a plain closure, not through the thing
 *     `callOutside` catches and reclassifies as a generic "dependency" failure.
 */
function followOneRedirect(fetchImpl, resolve, onRefusal) {
  return async (url, init) => {
    const first = await fetchImpl(url, { ...init, redirect: "manual" });
    if (first.status < 300 || first.status >= 400) return first;
    const location = first.headers?.get?.("location");
    if (!location) return first; // ★ a 3xx with no Location is not a redirect to follow
    let target;
    try {
      target = new URL(location, url).toString();
    } catch {
      onRefusal("the redirect target is not a valid URL");
      throw new Error("ssrf_redirect_blocked");
    }
    try {
      await assertPublicDestination(target, { resolve });
    } catch (e) {
      onRefusal(e instanceof AppError ? e.message : String(e?.message ?? e));
      throw new Error("ssrf_redirect_blocked"); // ★ the real fetchImpl is NEVER called for `target`
    }
    return fetchImpl(target, { ...init, redirect: "manual" });
  };
}

/**
 * ★★★ SIGN THE TIMESTAMP **AND** THE BODY, IN ONE MAC.
 *     `t=<unix>,v1=<hex>` over `${t}.${body}` — the same construction Stripe uses, and for the same
 *     reason: a MAC over the body alone is replayable forever, because nothing in the signed material
 *     says when it was made. Putting `t` inside the MAC is what makes the signature perishable.
 *   ★ Receivers are told to compare in constant time and to reject a stale `t`; that instruction only
 *     means anything if `t` is covered by the MAC, which is why it is not a separate header alone.
 */
export function signPayload({ body, secret, timestampSeconds = Math.floor(Date.now() / 1000) }) {
  if (typeof body !== "string") throw new WebhookEndpointInvalid("sign the serialised body, as a string");
  const v1 = createHmac("sha256", secret).update(`${timestampSeconds}.`).update(body).digest("hex");
  return { header: `t=${timestampSeconds},v1=${v1}`, timestampSeconds, v1 };
}

/** The digest stored on the delivery row — proves what was signed without keeping the payload twice. */
export const bodySha256 = (body) => createHash("sha256").update(body, "utf8").digest();

/**
 * ★ §25.6 — THE STANDARD WEBHOOKS HEADERS, IN ADDITION TO the platform's own (a receiver can verify either).
 *   webhook-id = the event id; webhook-timestamp = the same unix second as keystone-timestamp; webhook-signature = `v1,<base64 HMAC-SHA256 of "id.timestamp.body">`,
 *   made by the `standardwebhooks` library (MIT). The key is the secret's bytes after `whsec_` (Node's base64 decoder reads the URL-safe alphabet our secrets use).
 *   A receiver using a Standard Webhooks library passes `whsec_` + the secret with "-" swapped for "+" and "_" for "/" (documented on the Developers page).
 */
export function standardHeaders({ secret, previousSecret = null, eventId, body, timestampSeconds }) {
  const sign = (sec) => new StandardWebhook(Uint8Array.from(Buffer.from(String(sec).replace(/^whsec_/, ""), "base64")), { format: "raw" }).sign(String(eventId), new Date(timestampSeconds * 1000), body);
  // FP-F5 — while a rotation window is open the header carries BOTH signatures (space-separated, as the Standard Webhooks spec allows): a receiver that knows either secret verifies
  return { "webhook-id": String(eventId), "webhook-timestamp": String(timestampSeconds), "webhook-signature": previousSecret ? `${sign(secret)} ${sign(previousSecret)}` : sign(secret) };
}

/** The previous secret of an endpoint that is inside its rotation window, or null (also null if it can no longer be opened). */
export function previousEndpointSecret(row, { tenantId, now = Date.now() }) {
  if (!row?.previous_secret_envelope || !row.previous_secret_expires_at || new Date(row.previous_secret_expires_at).getTime() <= now) return null;
  try { return openSecret(row.previous_secret_envelope, { tenantId, purpose: "webhook_hmac" }); } catch { return null; }
}

/**
 * FP-F5 — rotate an endpoint's secret. The new secret is returned ONCE; the old one keeps signing alongside it for `windowHours` (1–168, default 24), then stops.
 * @returns {{ fingerprint: string, previousValidUntil: string }}
 */
export async function rotateEndpointSecret(tx, { tenantId, id, secret, windowHours = 24 }) {
  const hours = Math.min(Math.max(Math.round(Number(windowHours) || 24), 1), 168);
  const envelope = sealSecret({ plaintext: secret, tenantId, purpose: "webhook_hmac" });
  const { rows: [r] } = await tx.query(
    `UPDATE keystone.webhook_endpoint
        SET previous_secret_envelope = secret_envelope, previous_secret_expires_at = now() + make_interval(hours => $3),
            secret_envelope = $4, secret_fingerprint = $5, kek_version = $6, secret_rotated_at = now(), updated_at = now()
      WHERE id = $1 AND tenant_id = $2 RETURNING secret_fingerprint, previous_secret_expires_at`,
    [id, tenantId, hours, envelope, envelope.fingerprint ?? createHash("sha256").update(secret).digest("hex").slice(0, 16), CURRENT_KEK_VERSION]);
  if (!r) return null;
  return Object.freeze({ fingerprint: r.secret_fingerprint, previousValidUntil: r.previous_secret_expires_at instanceof Date ? r.previous_secret_expires_at.toISOString() : r.previous_secret_expires_at });
}

/**
 * ★ Create an endpoint. The secret is generated here, sealed, and returned ONCE so it can be shown to
 *   the human — the same "shown once" rule as an API token, and for the same reason.
 * ★★★ CT-074 / F500 — SAVE-TIME SSRF CHECK. `assertPublicDestination` folds in the `https://` check
 *   this replaces AND resolves the host AND refuses a private/loopback/link-local/unique-local/
 *   unspecified address, so the owner gets an immediate, readable refusal rather than a silent hole.
 */
/** FP-D4 — a RELAY endpoint is never called over the network: its signed deliveries are stored for `docustay listen` to fetch. Its address is this reserved host (the .invalid TLD cannot resolve). */
export const RELAY_HOST = "relay.docustay.invalid";
export const isRelayUrl = (url) => { try { return new URL(String(url)).hostname === RELAY_HOST; } catch { return false; } };

export async function createWebhookEndpoint(tx, {
  tenantId, url, name, eventTypes, secret, fingerprintFrom, resolveHost,
} = {}) {
  if (!isRelayUrl(url)) await assertPublicDestination(url, { resolve: resolveHost });
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    throw new WebhookEndpointInvalid("an endpoint with no event types would receive nothing");
  }
  // Run 8 R8-69: a second endpoint for the same address answered the database's own "unique violation"; say it in words (the unique index stays the guard)
  const { rowCount: taken } = await tx.query(`SELECT 1 FROM keystone.webhook_endpoint WHERE tenant_id = $1 AND lower(url) = lower($2) AND NOT (status = 'disabled' AND disabled_reason = 'removed')`, [tenantId, url]);
  if (taken) throw new AppError(ErrorKind.CONFLICT, "A webhook for this address already exists. Edit that one, or use a different address.", { detail: { field: "url", code: "webhook_url_taken" } });
  const envelope = sealSecret({ plaintext: secret, tenantId, purpose: "webhook_hmac" });
  const { rows } = await tx.query(
    `INSERT INTO keystone.webhook_endpoint
       (tenant_id, url, name, event_types, secret_envelope, secret_fingerprint, kek_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, secret_fingerprint, kek_version`,
    [tenantId, url, name, eventTypes, envelope,
     fingerprintFrom ?? envelope.fingerprint ?? createHash("sha256").update(secret).digest("hex").slice(0, 16),
     CURRENT_KEK_VERSION]);
  return Object.freeze({ id: rows[0].id, fingerprint: rows[0].secret_fingerprint, kekVersion: rows[0].kek_version });
}

/** ★ Open an endpoint's secret. AAD on (tenantId, purpose) — a lifted envelope will not open. */
export function endpointSecret(row, { tenantId }) {
  return openSecret(row.secret_envelope, { tenantId, purpose: "webhook_hmac" });
}


/**
 * ★★★ DELIVER ONE EVENT TO ONE ENDPOINT, RECORDING EVERY ATTEMPT.
 *
 * Sequence, and the order is the assertion:
 *   1 · ONE statement: read the pair's attempts; INSERT the next one with `status='attempted'` ONLY IF the
 *       pair is not delivered, not dead, and either has no attempt yet or has a retry that is due; and
 *       clear that due `next_retry_at` so no other sweep picks it up. The UNIQUE (tenant, endpoint, event,
 *       attempt) index is what makes two concurrent senders safe; a read-then-write check would not be.
 *       Nothing inserted → nothing sent → `{ outcome: 'skipped' }`. ★ A SAMPLE event (read from its own
 *       row in the same statement) is never inserted, so never sent (02 §2.9, Stage 3 Task 8).
 *   2 · COMMIT, so the evidence survives a crash in step 3
 *   3 · POST (with the event id header)
 *   4 · UPDATE with the outcome — and, for a failure, `next_retry_at` on the 07 schedule, or `dead_at`
 *       after the last attempt — and the endpoint's consecutive-failure counter, in the same statement.
 *
 * @returns a described outcome. NEVER throws for a receiver's failure.
 */
/** ★ Stage 3 Task 8 — the reason every webhook path gives for refusing a sample event (02 §2.9). */
export const SAMPLE_REFUSAL = "sample event — never delivered to a webhook (spec 02 §2.9)";
/** ★★★ Task 9.13 — the reason given when a platform operator has turned `webhooks_enabled` off. */
export const SERVICE_DISABLED_REFUSAL =
  "webhooks_enabled is off for this practice — a platform operator turned it off (refused before delivery)";

export async function deliverEvent({ pool, tenantId, endpoint, event, body, nowSeconds, replay = null }, {
  fetchImpl = globalThis.fetch, commit = null, resolveHost,
} = {}) {
  // ★★★ Task 9.13 — THE GUARD, AT THE TOP, BEFORE SIGNING AND BEFORE ANY DELIVERY ROW IS CLAIMED.
  //     Same "never a silent success and never a 500" refusal shape SAMPLE_REFUSAL already uses
  //     below — no delivery row is written, exactly like a sample event, and the transport is
  //     never reached.
  const webhooksEnabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "webhooks_enabled", tenantId));
  if (!webhooksEnabled) {
    return Object.freeze({ endpointId: endpoint.id, outcome: "skipped", reason: SERVICE_DISABLED_REFUSAL, attempts: 0 });
  }
  // ★★ Fix round 1 (review T7-R1) — A SECRET THAT WILL NOT OPEN STILL ADVANCES THE ROW. It used to throw
  //    here, BEFORE the claim: the due row kept its next_retry_at, never reached dead, and sat at the head of
  //    the sweep's ORDER BY next_retry_at LIMIT — enough of them silently stopped every retry in the practice.
  //    Now the attempt is claimed like any other, recorded `failed` with `secret_unavailable`, NOT sent, and
  //    rescheduled (or dead) on the 07 schedule. Stored as the fixed code `secret_unavailable` only — never the envelope, the error name or its message.
  let signed, standard = {};
  try {
    const secret = endpointSecret(endpoint, { tenantId });
    signed = signPayload({ body, secret, ...(nowSeconds ? { timestampSeconds: nowSeconds } : {}) });
    const previous = previousEndpointSecret(endpoint, { tenantId });
    if (previous) signed = { ...signed, header: `${signed.header},v1=${signPayload({ body, secret: previous, timestampSeconds: signed.timestampSeconds }).v1}` };   // FP-F5: both signatures while the window is open
    standard = standardHeaders({ secret, previousSecret: previous, eventId: event.id, body, timestampSeconds: signed.timestampSeconds });
  } catch (e) {
    signed = { header: SECRET_UNAVAILABLE, timestampSeconds: null, unavailable: SECRET_UNAVAILABLE }; // ★ the fixed code only — no error name or message
  }
  const digest = bodySha256(body);

  let claim;
  try {
    ({ rows: [claim] } = await pool.query(
      `WITH prior AS (
         SELECT coalesce(max(attempt), 0) AS n,
                coalesce(bool_or(status = 'delivered'), false) AS delivered,
                coalesce(bool_or(dead_at IS NOT NULL), false) AS dead,
                coalesce(bool_or(next_retry_at IS NOT NULL AND next_retry_at <= now()), false) AS due,
                coalesce(bool_or(status = 'attempted'), false) AS inflight
           FROM keystone.webhook_delivery
          WHERE tenant_id = $1 AND endpoint_id = $2 AND event_id = $3
       ), src AS (
         -- ★★ Stage 3 Task 8: the LAST door. The event's own row says whether it is sample — read here, in
         --    the claiming statement, so no caller can forget it (02 §2.9). A missing row reads as sample:
         --    webhook_delivery.event_id REFERENCES event, so the insert could not succeed anyway.
         SELECT coalesce((SELECT sample FROM keystone.event WHERE tenant_id = $1 AND id = $3), true) AS sample
       ), ins AS (
         INSERT INTO keystone.webhook_delivery
           (tenant_id, endpoint_id, event_id, attempt, request_url, request_signature, request_body_sha256, replay_of, replayed_by)
         SELECT $1, $2, $3, prior.n + 1, $4, $5, $6, $8::uuid, $9::uuid FROM prior, src
          WHERE NOT src.sample
            AND CASE WHEN $8::uuid IS NOT NULL
                     -- ★ §25.5 an EXPLICIT replay (a person clicked it): allowed even after delivery or death, but never while an attempt is in flight, and capped
                     THEN NOT prior.inflight AND prior.n < 200
                     -- every AUTOMATIC attempt keeps the guard: never a second POST for a delivered (event, endpoint)
                     ELSE NOT prior.delivered AND NOT prior.dead AND prior.n < $7 AND (prior.n = 0 OR prior.due) END
         RETURNING id, attempt
       ), clr AS (
         UPDATE keystone.webhook_delivery d SET next_retry_at = NULL
          WHERE d.tenant_id = $1 AND d.endpoint_id = $2 AND d.event_id = $3 AND d.next_retry_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM ins)
       )
       SELECT ins.id, ins.attempt, prior.n, prior.delivered, prior.dead, prior.due, src.sample
         FROM prior CROSS JOIN src LEFT JOIN ins ON true`,
      // ★★ `endpoint.url` is copied INTO the row here, at attempt time. It is never read back by join.
      [tenantId, endpoint.id, event.id, endpoint.url, signed.header, digest, WEBHOOK_MAX_ATTEMPTS, replay?.of ?? null, replay?.by ?? null]));
  } catch (e) {
    // ★ Another sender inserted this attempt number first — it is sending; this one must not.
    if (e.code === "23505") {
      return Object.freeze({ endpointId: endpoint.id, outcome: "skipped", reason: "another attempt is in flight" });
    }
    throw e;
  }
  if (!claim?.id) {
    const reason = claim?.sample ? SAMPLE_REFUSAL
      : claim?.delivered ? "already delivered"
      : claim?.dead ? "given up after the last attempt"
      : replay ? "an attempt is already in flight, or this delivery has been replayed too many times"
      : claim?.n >= WEBHOOK_MAX_ATTEMPTS ? "no attempts left"
      : "an attempt is in flight or its retry is not yet due";
    return Object.freeze({ endpointId: endpoint.id, outcome: "skipped", reason, attempts: claim?.n ?? 0 });
  }
  const deliveryId = claim.id;
  const attempt = claim.attempt;
  if (commit) await commit();            // ★ the evidence is durable BEFORE the network call

  const started = Date.now();
  let outcome = "failed", err = null, excerpt = null, headersOut = null, responseStatus = null;
  if (signed.unavailable) {
    err = signed.unavailable;            // ★ recorded as a failed attempt; nothing is sent unsigned
  } else {
    // ★★★ CT-074 / F500 — DELIVERY-TIME RE-CHECK. The destination may have been public when the
    //   endpoint was saved (createWebhookEndpoint, above) and resolve privately NOW — a DNS record
    //   that changed, or a rebind. This is the second of the two required checks. Nothing is sent
    //   when it refuses; the reason is recorded exactly like a `secret_unavailable` failure is.
    let destinationError = null;
    if (!isRelayUrl(endpoint.url)) {
      try {
        await assertPublicDestination(endpoint.url, { resolve: resolveHost });
      } catch (e) {
        destinationError = e instanceof AppError ? e.message : String(e?.message ?? e);
      }
    }
    if (destinationError) {
      err = destinationError;
    } else if (isRelayUrl(endpoint.url)) {
      // FP-D4 — keep the signed delivery for the developer's `docustay listen`; the same headers a real receiver would get, so the signature checks out on their laptop
      try {
        await pool.query(
          `INSERT INTO keystone.webhook_relay_event (tenant_id, endpoint_id, event_id, topic, headers, body) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
          [tenantId, endpoint.id, event.id, event.topic ?? null, JSON.stringify({
            "content-type": "application/json", [SIGNATURE_HEADER]: signed.header, [TIMESTAMP_HEADER]: String(signed.timestampSeconds), [EVENT_ID_HEADER]: String(event.id), ...standard, ...(replay ? { "keystone-replay": "true" } : {}) }), body]);
        if (Math.random() < 0.02) await pool.query(`DELETE FROM keystone.webhook_relay_event WHERE tenant_id = $1 AND created_at < now() - interval '24 hours'`, [tenantId]);
        outcome = "delivered"; responseStatus = 202;
      } catch (e) { err = `relay: ${e.code ?? e.name}`; }
    } else {
      // ★★★ THE DELIVERY CALL, THROUGH callOutside (Task 9.1 / CT-064). `redirect: "manual"` plus
      //   `followOneRedirect` (above) is what re-checks a redirect target before it is followed —
      //   callOutside's own return carries no header and no message, so a refusal found inside the
      //   wrapper is reported back through `onRefusal`, not through callOutside's `kind`.
      let redirectRefusal = null;
      try {
        const result = await callOutside("webhook", endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [SIGNATURE_HEADER]: signed.header,
            [TIMESTAMP_HEADER]: String(signed.timestampSeconds),
            [EVENT_ID_HEADER]: String(event.id),
            ...standard,                                   // §25.6: webhook-id / webhook-timestamp / webhook-signature (Standard Webhooks)
            ...(replay ? { "keystone-replay": "true" } : {}),
          },
          body,
          redirect: "manual",
        }, {
          fetchImpl: followOneRedirect(fetchImpl, resolveHost, (reason) => { redirectRefusal = reason; }),
          timeoutMs: DELIVERY_TIMEOUT_MS,
        });
        if (redirectRefusal) {
          err = redirectRefusal;         // ★ nothing was sent to the redirect target — F500's point
        } else if (result.status == null) {
          // ★★ A TIMEOUT IS ITS OWN STATUS, not "failed". The receiver may have processed it and been
          //   slow to answer; a human deciding whether to re-send needs those two cases apart.
          outcome = result.timedOut ? "timed_out" : "failed";
          err = result.timedOut ? "TimeoutError: timed out" : "dependency: request could not be completed";
        } else {
          responseStatus = result.status;
          excerpt = result.body == null ? null
            : (typeof result.body === "string" ? result.body : JSON.stringify(result.body)).slice(0, 4096);
          outcome = result.ok ? "delivered" : "failed";
          if (!result.ok) err = `receiver returned ${result.status}`;
        }
      } catch (e) {
        // ★ callOutside only throws for a programming error at the call site — not a receiver failure.
        err = `${e.name}: ${e.message}`;
      }
    }
  }
  const duration = Date.now() - started;

  // ★★ The outcome, the next retry (07 schedule) or `dead`, and the endpoint's failure counter — ONE
  //    statement, so a crash cannot leave a failed attempt with no retry and no death.
  const { rows: [after] } = await pool.query(
    `WITH d AS (
       UPDATE keystone.webhook_delivery
          SET status=$2, response_status=$3, response_headers=$4, response_body_excerpt=$5,
              error=$6, completed_at=now(), duration_ms=$7,
              next_retry_at = CASE WHEN $2 <> 'delivered' AND attempt < $9 AND replay_of IS NULL
                                   THEN now() + make_interval(secs => ($10::int[])[attempt]) END,
              dead_at = CASE WHEN $2 <> 'delivered' AND attempt >= $9 AND replay_of IS NULL THEN now() END
        -- ★ Fix round 1: only an attempt still in flight takes an outcome. If the stale-attempt reaper
        --   (subscribers.mjs) already closed it as abandoned, a late answer does not overwrite that.
        WHERE id=$1 AND tenant_id=$8 AND status = 'attempted'
        RETURNING endpoint_id, next_retry_at, dead_at, replay_of
     ), e AS (
       UPDATE keystone.webhook_endpoint w
          SET consecutive_failures = CASE WHEN $2 = 'delivered' THEN 0 ELSE w.consecutive_failures + 1 END
         FROM d
        WHERE w.id = d.endpoint_id AND w.tenant_id = $8
          AND ($2 = 'delivered' OR d.replay_of IS NULL)      -- ★ a failed REPLAY must not count toward auto-disabling the endpoint
          AND ($2 <> 'delivered' OR w.consecutive_failures <> 0)
     )
     SELECT next_retry_at, dead_at FROM d`,
    [deliveryId, outcome, responseStatus, headersOut, excerpt, err, duration, tenantId,
     WEBHOOK_MAX_ATTEMPTS, [...RETRY_SCHEDULE_SECONDS]]);

  return Object.freeze({
    endpointId: endpoint.id, deliveryId, attempt, outcome, status: responseStatus, durationMs: duration,
    error: err, signature: signed.header, nextRetryAt: after?.next_retry_at ?? null, dead: Boolean(after?.dead_at),
  });
}

/**
 * FP-D1 — SEND A TEST EVENT. A sample event, signed exactly like a real one, sent to one endpoint right now; the answer is returned to the screen. Nothing is stored (no event, no delivery row, no retry) and the
 * endpoint's failure counter is not touched: a test must never count toward disabling an endpoint. The body says `test: true`, so a receiver can tell it from a real event.
 * @returns {{ outcome: 'delivered'|'failed'|'timed_out'|'skipped', status: number|null, durationMs: number, responseExcerpt: string|null, error: string|null, topic: string, eventId: string }}
 */
// R13-D197: a test send is listed under the webhook's deliveries (test: true), like Stripe's test events. One row, no payload.
export async function recordTestSend(db, { tenantId, endpointId, out }) {
  await db.query(`INSERT INTO keystone.webhook_test_send (tenant_id, endpoint_id, event_id, topic, status, response_status, error) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId, endpointId, out.eventId, out.topic, out.outcome, out.status, out.error ? String(out.error).slice(0, 1000) : null]);
  return out;
}

export async function sendTestEvent({ tenantId, endpoint, topic = null, nowSeconds, resolveHost, tx = null }, { fetchImpl = globalThis.fetch } = {}) {
  const webhooksEnabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "webhooks_enabled", tenantId));
  const eventId = randomUUID();
  // R13-D205: a topic the webhook does not listen to is refused by name, never swapped for another one
  if (topic && !(endpoint.event_types ?? []).includes(topic)) throw new AppError(ErrorKind.VALIDATION, `this webhook does not listen to ${topic}; it listens to ${(endpoint.event_types ?? []).join(", ") || "no topics"}`, { detail: { field: "topic", allowed: endpoint.event_types ?? [] } });
  const chosen = topic ?? (endpoint.event_types ?? [])[0] ?? "documents.document.executed";
  const base = { topic: chosen, eventId, status: null, durationMs: 0, responseExcerpt: null, error: null };
  if (!webhooksEnabled) return Object.freeze({ ...base, outcome: "skipped", error: SERVICE_DISABLED_REFUSAL });
  // R13-D230: the sample has the real event's shape for the chosen topic (src/webhooks/samplePayloads.mjs); built once, so the HTTP and the relay path both send it
  const sample = samplePayloadFor(chosen);
  const body = JSON.stringify({
    id: eventId, topic: chosen, subject_type: sample.subject_type, subject_id: sample.subject_type ? randomUUID() : null,
    payload: sample.payload,
    emitted_at: new Date().toISOString(),
  });
  let signed, standard;
  try {
    const secret = endpointSecret(endpoint, { tenantId });
    signed = signPayload({ body, secret, ...(nowSeconds ? { timestampSeconds: nowSeconds } : {}) });
    const previous = previousEndpointSecret(endpoint, { tenantId });
    if (previous) signed = { ...signed, header: `${signed.header},v1=${signPayload({ body, secret: previous, timestampSeconds: signed.timestampSeconds }).v1}` };
    standard = standardHeaders({ secret, previousSecret: previous, eventId, body, timestampSeconds: signed.timestampSeconds });
  } catch { return Object.freeze({ ...base, outcome: "failed", error: SECRET_UNAVAILABLE }); }
  if (isRelayUrl(endpoint.url)) {
    // FP-D4 — a relay endpoint keeps the test for `docustay listen`, signed exactly like a real delivery
    if (!tx) return Object.freeze({ ...base, outcome: "failed", error: "relay endpoints need a database handle" });
    await tx.query(`INSERT INTO keystone.webhook_relay_event (tenant_id, endpoint_id, event_id, topic, headers, body) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [tenantId, endpoint.id, eventId, chosen, JSON.stringify({ "content-type": "application/json", [SIGNATURE_HEADER]: signed.header, [TIMESTAMP_HEADER]: String(signed.timestampSeconds), [EVENT_ID_HEADER]: eventId, "docustay-test": "true", ...standard }), body]);
    return Object.freeze({ ...base, outcome: "delivered", status: 202, responseExcerpt: "stored for docustay listen" });
  }
  try { await assertPublicDestination(endpoint.url, { resolve: resolveHost }); }
  catch (e) { return Object.freeze({ ...base, outcome: "failed", error: e instanceof AppError ? e.message : String(e?.message ?? e) }); }
  const started = Date.now();
  let refusal = null;
  const result = await callOutside("webhook", endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signed.header, [TIMESTAMP_HEADER]: String(signed.timestampSeconds), [EVENT_ID_HEADER]: eventId, "docustay-test": "true", ...standard },
    body, redirect: "manual",
  }, { fetchImpl: followOneRedirect(fetchImpl, resolveHost, (reason) => { refusal = reason; }), timeoutMs: DELIVERY_TIMEOUT_MS });
  const durationMs = Date.now() - started;
  if (refusal) return Object.freeze({ ...base, outcome: "failed", durationMs, error: refusal });
  if (result.status == null) return Object.freeze({ ...base, outcome: result.timedOut ? "timed_out" : "failed", durationMs, error: result.timedOut ? "TimeoutError: timed out" : "dependency: request could not be completed" });
  const excerpt = result.body == null ? null : (typeof result.body === "string" ? result.body : JSON.stringify(result.body)).slice(0, 4000);
  return Object.freeze({ ...base, outcome: result.ok ? "delivered" : "failed", status: result.status, durationMs, responseExcerpt: excerpt, error: result.ok ? null : `receiver returned ${result.status}` });
}
