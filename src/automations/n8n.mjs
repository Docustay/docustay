// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A9.2 — TALKING TO n8n. **KEYSTONE CALLS n8n; A TENANT NEVER DOES.**
//
// ★★★ DOES A TENANT TOGGLE THEIR OWN? **YES FOR CONTENT, NO FOR DELIVERY.** [TY, RULED]
//     ✓ A practice may turn THEIR OWN notifications on and off — it is their relationship with
//       their clients.
//     ✗ A practice may NOT reach n8n directly and **must never hold the n8n API key.** The toggle is
//       a KEYSTONE setting; Keystone is what calls n8n.
//   ★★ SO THERE ARE TWO DIFFERENT SWITCHES AND THEY ARE NOT THE SAME THING:
//       · the PLATFORM switch  — n8n's own `active` flag on the workflow. Operator-only. Off means
//         the automation does not exist for anybody.
//       · the TENANT switch    — `automations.<key>.enabled` in `tenant_setting`, read BY the
//         workflow. Off means it does not run for that practice.
//     A screen that showed one and called it the other would let a practice believe they had turned
//     something on that the platform has switched off.
//
// ★★★ THE SWITCH'S SOURCE OF TRUTH IS n8n's OWN `active` FLAG — READ IT TO RENDER THE ROW, so the
//     screen cannot drift from reality. A cached copy in our database would be a second answer to
//     "is this running", and the stale one always wins the moment somebody changes it in n8n.
//
// ★★★ THE API KEY'S MASTER COPY LIVES IN **GOOGLE SECRET MANAGER**, NEVER IN THE BROWSER AND NEVER
//     IN A TENANT'S REACH. ★ TASK 9.14 (CT-096): the RUNTIME copy this process reads is a CT-061
//     SEALED ENVELOPE (`KEYSTONE_N8N_SERVICE_ENVELOPE`), opened fresh at call time — see `KEY()`,
//     below — never the plaintext key sitting in the environment. It is never returned by any route.
//   ★ FAIL LOUD. A missing key THROWS rather than defaulting to "everything is off": reporting
//     every automation as inactive because a credential is absent would be a lie the operator acts
//     on. `sendingAddress()` and `loadMasterKey()` already set that precedent in this codebase.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { callOutside } from "../http/outside.mjs";
// ★★★ TASK 9.14 (CT-096) — the credential is a CT-061 envelope, never a raw key in the environment.
import { openSecret } from "../secrets/envelope.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH for `sendEvent` only (below). `workflowStates`/`setWorkflowActive`
//     are the OPERATOR'S OWN platform-wide workflow management — no practice initiates them and
//     there is no tenantId to check a PER-PRACTICE flag against — so they stay ungated, deliberately.
import { withTenant } from "../db/index.mjs";
import { flagIsOn } from "../platform/flags.mjs";

const BASE = () => process.env.KEYSTONE_N8N_URL ?? null;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 9.14 (CT-096) — THE CREDENTIAL SOURCE. `KEYSTONE_N8N_API_KEY` IS RETIRED, NOT KEPT AS A
//     FALLBACK. CONTRACTS.md:1918-1929 (CT-096, from CC-8) ruled this in terms: "The env var is
//     retired in the same task, or the product has two sources of one secret." A "local only"
//     fallback is exactly how one secret grows a second, differently-rotated source — so `KEY()` now
//     reads ONE thing: a CT-061 envelope, purpose `n8n_service` (already a CT-062 member).
//   ★ RUNTIME COPY: 06 §"Platform credentials" already places every platform-wide secret's runtime
//     copy in a Railway service variable (GSM master → Railway variable, same as `KEYSTONE_MASTER_KEY`
//     itself) — `KEYSTONE_N8N_SERVICE_ENVELOPE` holds the SEALED envelope (its ten CT-061 keys, as
//     JSON), never the plaintext key. There is no database row for this credential: unlike
//     `webhook_hmac` (opened inside the OWNING TENANT's own transaction, `src/webhooks/outbound.mjs`)
//     this is a single, platform-wide secret with no per-request tenant context to open it inside —
//     migration 0219 adds only the sink's delivery bookkeeping table (§6 of the task), not a storage
//     table for this credential.
//   ★★ AAD CONTEXT: `sealSecret`/`openSecret` bind `purpose` AND `tenantId` into the AAD (CT-061's
//     whole point — see envelope.mjs's header). "Held against the platform tenant" (CT-096) means
//     this credential is NOT scoped to any one practice, unlike every other CT-062 purpose in this
//     codebase; it is sealed and opened under the fixed, non-secret label below rather than a real
//     `keystone.tenant.id` — there is deliberately no DB lookup here (this file has never imported the
//     db layer, and adding one only to resolve an AAD label would be a bigger architectural change
//     than this task's file list allows). The label carries no secrecy of its own — the AAD's job is
//     BINDING (so a copied ciphertext cannot be replayed under a different context), not secrecy —
//     it only has to be the same string at seal time and open time, which the operator's own
//     provisioning step must use when it calls `sealSecret` to produce the value that goes into
//     `KEYSTONE_N8N_SERVICE_ENVELOPE`.
//   ★ "OPENED ONLY INSIDE THE SEND PATH" (CT-096): never cached at module load or held across calls —
//     opened fresh every time `call()` is about to make an HTTP request, exactly like `loadMasterKey`
//     is read fresh rather than memoized. A decrypt failure (tampering, or `KEYSTONE_MASTER_KEY`
//     rotated without this value being re-wrapped) is NOT swallowed into "not configured" — it
//     propagates as `SecretOpenError`, which already names neither tenant nor purpose's VALUE, only
//     their names — "FAIL LOUD", the same rule this file's own header already states for the key.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const N8N_CREDENTIAL_CONTEXT = "platform";

function KEY() {
  const raw = process.env.KEYSTONE_N8N_SERVICE_ENVELOPE ?? null;
  if (!raw) return null;
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return null; }
  return openSecret(envelope, { tenantId: N8N_CREDENTIAL_CONTEXT, purpose: "n8n_service" });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 9.14 — `N8nUnavailable`'s MAPPING. Carries the SAME classification `callOutside` already
//     computed (`kind`/`retryable`/`retryAfterSeconds`) so a caller — the outbox sink, below — can
//     decide whether to retry without re-deriving a classification `callOutside` already made. 9.6's
//     transport shape (the `callOutside` call itself, its timeout, its headers) is unchanged; only
//     what this class carries, and what `call()`'s two throw sites attach to it, are this task's.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export class N8nUnavailable extends Error {
  constructor(message, { kind = null, retryable = false, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "N8nUnavailable";
    this.kind = kind;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** ★ One place that decides whether we can talk to n8n at all, so no caller invents a fallback. */
export function assertConfigured() {
  if (!BASE() || !KEY()) {
    // ★ Names the PURPOSE ("n8n_service", CT-062) and the two env vars — never the value, because
    //   there is no value to name at this point: either var is simply absent.
    throw new N8nUnavailable(
      "n8n is not configured for this deployment: KEYSTONE_N8N_URL and a sealed envelope for " +
      "purpose \"n8n_service\" (KEYSTONE_N8N_SERVICE_ENVELOPE) are both required. " +
      "Automations cannot be read or toggled until it is. This is reported rather than shown as " +
      "'everything is off', because those are different facts and only one of them is fixable by " +
      "a practice.");
  }
}

// ★ Task 9.6 (CT-064) — the transport moved onto `callOutside` (15 s default, 06 §5). `N8nUnavailable`
//   is still what this function throws for every provider failure — settings.mjs (9.11's file) catches
//   it by `instanceof` and nothing else changes for that caller — but the message is now mapped from
//   `callOutside`'s classification instead of built from a raw thrown error.
async function call(path, init = {}, fetchImpl = fetch) {
  assertConfigured();
  const result = await callOutside("n8n", `${BASE().replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { accept: "application/json", "X-N8N-API-KEY": KEY(), ...(init.headers ?? {}) },
  }, { fetchImpl, timeoutMs: 15_000 });

  if (result.status === null) {
    // ★ No reply at all — mapped from callOutside's kind, not a raw throw. TASK 9.14: the kind,
    //   retryable and retryAfterSeconds callOutside already computed travel WITH the error, so a
    //   caller (the outbox sink) can decide whether to retry without re-deriving them.
    throw new N8nUnavailable(
      result.timedOut
        ? "n8n did not respond within 15000ms"
        : `n8n could not be reached (${result.kind ?? "dependency"})`,
      { kind: result.kind ?? "dependency", retryable: result.retryable, retryAfterSeconds: result.retryAfterSeconds });
  }
  // ★ Same normalisation the old bare-fetch code did: a non-JSON body becomes `{message: text}` so
  //   `body?.message` below reads the same either way.
  const body = (result.body && typeof result.body === "object")
    ? result.body
    : (typeof result.body === "string" && result.body ? { message: result.body.slice(0, 500) } : null);
  if (!result.ok) {
    // ★★ n8n's OWN message, not a re-worded one — the same rule this codebase applies to itself.
    //   TASK 9.14: `kind` is null for a clean-but-unsuccessful answer (any 4xx besides 429) — not
    //   retryable — and RATE_LIMITED (honouring Retry-After) or DEPENDENCY for a 429/5xx.
    throw new N8nUnavailable(`n8n answered ${result.status}: ${body?.message ?? "no detail"}`,
      { kind: result.kind, retryable: result.retryable, retryAfterSeconds: result.retryAfterSeconds });
  }
  return body;
}

/**
 * ★★★ THE PLATFORM VIEW: every workflow n8n knows about, with its REAL `active` flag.
 *   Returned as a map keyed by workflow name so a caller joins it to the catalogue by name rather
 *   than storing n8n's internal ids — ★ a tenant must never see an internal id, and an id we cached
 *   would be a second copy of something n8n owns.
 */
export async function workflowStates(fetchImpl = fetch) {
  const body = await call("/api/v1/workflows", {}, fetchImpl);
  const out = new Map();
  for (const w of body?.data ?? []) out.set(w.name, { id: w.id, active: Boolean(w.active) });
  return out;
}

/**
 * ★★ ACTIVATE / DEACTIVATE — THE PLATFORM SWITCH, AND IT IS OPERATOR-ONLY.
 *   This is NOT what a practice presses. A practice's toggle writes `automations.<key>.enabled` in
 *   their own `tenant_setting`, which the workflow reads; this turns the workflow off for everyone.
 */
export async function setWorkflowActive(workflowId, active, fetchImpl = fetch) {
  return call(`/api/v1/workflows/${encodeURIComponent(workflowId)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" }, fetchImpl);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 9.14 (CT-096, Q9-6) — THE SEND ENDPOINT. The ONLY function in this file that tells n8n
//     something HAPPENED, as distinct from `workflowStates`/`setWorkflowActive` above, which ask n8n
//     ABOUT its own workflow catalogue. `src/events/outbox.mjs`'s n8n sink (the same task's other
//     named part) is this function's only caller — §X4's "sections never call each other" means the
//     sink decides WHETHER to send (the flag, sample, replay-window checks); this function only
//     knows HOW.
//   ★ Reuses `call()` — the SAME `callOutside("n8n", …, {timeoutMs: 15_000})` wrapper, the SAME
//     credential source, the SAME `N8nUnavailable` mapping (kind/retryable/retryAfterSeconds) — so
//     there is exactly one place that talks HTTP to n8n, not a second copy for "sending".
//   ★ THE BODY CARRIES ONLY WHAT THE EVENT ITSELF CARRIES. Never the n8n key (that is a request
//     HEADER, built inside `call()`, never the body) and never anything this function invents.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Post one outbox event to n8n's inbound webhook.
 * @param {{id: string, tenant_id: string, topic: string, payload: object, actor: string,
 *   subject_type: (string|null), subject_id: (string|null), created_at: (Date|string)}} event
 * @throws {N8nUnavailable} mapped from `callOutside`'s classification — dependency/timeout/
 *   rate_limited (honouring Retry-After on a 429) — never a raw fetch error.
 */
export async function sendEvent(event, fetchImpl = fetch) {
  // ★★★ Task 9.13 — THE GUARD, AT THE TOP. Defense-in-depth: the outbox n8n sink (9.14's, the
  //     only production caller) already checks `flagIsOn(tx, "n8n_send", tenantId)` before ever
  //     reaching this function, but a guard that only lives in the caller is a guard a future
  //     caller can skip by omission — so this entry point checks for itself too, fresh, no cache.
  const n8nEnabled = await withTenant(event.tenant_id, (tx) => flagIsOn(tx, "n8n_send", event.tenant_id));
  if (!n8nEnabled) {
    throw new N8nUnavailable(
      "n8n_send is off for this practice — a platform operator turned it off. No event is sent " +
      "to n8n until it is switched back on.",
      { kind: "forbidden", retryable: false, retryAfterSeconds: null });
  }
  return call("/webhook/keystone-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: event.id,
      tenant_id: event.tenant_id,
      topic: event.topic,
      actor: event.actor,
      subject_type: event.subject_type ?? null,
      subject_id: event.subject_id ?? null,
      payload: event.payload ?? {},
      created_at: event.created_at,
    }),
  }, fetchImpl);
}
