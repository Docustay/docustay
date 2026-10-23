// P1.9–P1.12 — THE FOUR ENTRY PATHS.
//
// ★★★ §P1: "Y1 is four separate mutation checks, not one. Twenty's measured defect was precisely
// that API KEYS BYPASSED the member-relative predicate — the predicate was silently dropped and
// the query ran with no WHERE clause. Checking the browser path and declaring the gate proven is
// how that ships."
//
// Each path resolves the tenant by a DIFFERENT mechanism, and that is exactly why one proof does
// not cover the others:
//
//   browser  — signed session cookie        → tenant from the session record
//   apiToken — Authorization: Bearer <tok>  → tenant from the token record   ← Twenty's hole
//   webhook  — signed vendor payload        → tenant from a provider mapping; NO user at all
//   worker   — queue job                    → tenant from the job envelope;  NO request at all
//
// ★ EVERY path funnels into withTenant(). None of them may build a query itself. The whole
// design is that there is one door, and these are four keys to the same door — not four doors.

// ★ P12.15 — `__withoutTenantContextForGatesOnly` is NO LONGER IMPORTED HERE. It was only
//   ever used to build `noContextRunners`, which has moved to db/gates/. Application code
//   must not so much as name the escape hatch; the lint now enforces that.
import { withTenant, withOperator } from "../db/index.mjs";
import { verifyWebhookSignature } from "../webhooks/verify.mjs";
import { checkKeyLimitAside } from "../http/rateLimit.mjs";

/** Thrown when a path cannot establish a tenant. Never fall back to "no context and carry on". */
export class NoTenantContext extends Error {
  constructor(path, detail) {
    super(`${path}: could not resolve a tenant (${detail})`);
    this.name = "NoTenantContext";
    this.statusCode = 401;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 11.19 — THREE NAMED 403s, so a practice-less/operator mismatch never falls through to a
// raw `withTenant`/`withOperator` throw and surfaces as a 500. Same shape as `NoTenantContext`
// above, no imports.
// ─────────────────────────────────────────────────────────────────────────────
/** An operator session (no practice) reached a practice-chained route. */
export class PracticeChainRefused extends Error {
  constructor() {
    super("This is an operator session. Platform's practice screens need the session you signed in with.");
    this.name = "PracticeChainRefused";
    this.statusCode = 403;
  }
}
/** A session with no live operator grant reached the platform path. */
export class PlatformGrantRequired extends Error {
  constructor() {
    super("This session does not hold a live operator grant.");
    this.name = "PlatformGrantRequired";
    this.statusCode = 403;
  }
}
/** A session that resolved a practice (an ordinary browser session) reached the platform path. */
export class PlatformSessionRequired extends Error {
  constructor() {
    super("Open Platform from this sign-in first.");
    this.name = "PlatformSessionRequired";
    this.statusCode = 403;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-ins for the stores each path reads. The RESOLUTION SHAPE is what matters for
// the Y1 gates — swapping these for real tables later does not change the isolation argument,
// because isolation is enforced in Postgres, not here.
// ─────────────────────────────────────────────────────────────────────────────
const sessions = new Map();      // sessionId  -> { tenantId, userId }
const apiTokens = new Map();     // token      -> { tenantId }
const webhookRoutes = new Map(); // provider+ref -> { tenantId }
const queueJobs = [];            // { tenantId, kind, payload }

export const __stores = { sessions, apiTokens, webhookRoutes, queueJobs };

// ─────────────────────────────────────────────────────────────────────────────
// P1.9 — BROWSER SESSION PATH
// ─────────────────────────────────────────────────────────────────────────────
// ★★★ P13.2b — THE SESSION STORE IS NOW PLUGGABLE, AND THE MAP IS THE FALLBACK, NOT THE TRUTH.
// ADD2-4's correction stands: "swapping these for real tables later does not change the isolation
// argument" is true of ENFORCEMENT and VACUOUS about RESOLUTION — and resolution is 100% of what
// the Map does. A Map.get cannot expire, cannot be revoked, and has no relation to protect.
// ★ Phase 13 installs a resolver backed by `keystone_auth.session`. The Y1 gates install none and
//   keep using the Map, so their four-path isolation proof is unchanged.
// ★★ WHEN A RESOLVER IS INSTALLED THE MAP IS NOT CONSULTED AT ALL. A "try the Map, then the
//    database" chain would let an in-memory entry SHADOW a revoked session — which is precisely
//    the revocation hole choosing a session table was meant to close.
let sessionResolver = null;
// ★ P19.5a — the webhook routing table lives in Postgres; this is the seam the app installs.
let webhookResolver = null;
let apiTokenResolver = null;

/** Install the real store. Called once at boot by src/auth/install.mjs. */
export function installSessionResolver(fn) { sessionResolver = fn; }

export async function handleBrowserRequest({ sessionId }, fn) {
  const session = sessionResolver
    ? await sessionResolver(sessionId)
    : (sessionId ? sessions.get(sessionId) : undefined);
  if (!session) throw new NoTenantContext("browser", "no valid session");
  // ★★★ TASK 11.19 — THE DEFENSIVE REFUSAL. An operator session (`openPlatformSession`,
  //     src/auth/operatorSession.mjs) is minted with `tenantId: null` on purpose (11-B1's door):
  //     it is not inside any practice. Without this guard such a session reaching ANY
  //     practice-chained route would fall through to `withTenant(null, …)`'s raw UUID-shape
  //     throw below — a 500, not a 403 with a name. This protects every practice route, not only
  //     the platform ones.
  if (!session.tenantId) throw new PracticeChainRefused();
  // ★★★ THE SESSION HAS ALWAYS CARRIED `userId` AND THIS CALL USED TO DROP IT. Two live policies
  //     — document_instance's SELECT predicate and app_user's staff_write/staff_delete — read
  //     `keystone.current_user_id()`, which was therefore NULL on every request in the project's
  //     history. See the block in db/index.mjs for what that silently broke.
  //     ★ The BROWSER path is the only one of the four that HAS a user. webhook and worker
  //       deliberately pass none: a vendor payload has no viewer, and inventing one would be
  //       tenant selection's cousin — viewer selection by the caller.
  // ★★★ TASK 7.6 — `operatorGrantId` travels the same way `userId` always has: from the resolved
  //     session, straight through to `withTenant`'s third `set_config`. webhook and worker still
  //     pass none, for the same reason they pass no userId.
  return withTenant(session.tenantId, fn, {
    userId: session.userId ?? null,
    operatorGrantId: session.operatorGrantId ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 11.19 — PLATFORM PATH: THE PRACTICE-LESS CHAIN.
// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 11-B1 — THE DOOR IS NARROW, AND IT IS ENFORCED TWICE. A live `operatorGrantId` ALONE is not
//     enough to admit here: `keystone.resolve_session` finds the grant from the person's
//     `firebase_uid` with no predicate on the session's kind or practice, so a grant-holder's
//     ORDINARY browser session carries one too. Admitting that would make `POST /api/platform/session`
//     optional and take the operator session's expiry and the F629 audit write with it. This chain
//     applies the SAME two-part condition, in the SAME order, that 11.1's door (src/superadmin/
//     namespace.mjs) already applies — word-for-word its R2 and R1 sentences — so the door and the
//     chain never describe the same fact two ways, and the pair can only ever admit-then-refuse,
//     never the reverse.
//     ★ Written as its OWN function, never `handleBrowserRequest` with a flag — this file's own
//       stated rule for why the API-token path is separate (`:91-93` above).
export async function handlePlatformRequest({ sessionId }, fn) {
  const session = sessionResolver
    ? await sessionResolver(sessionId)
    : (sessionId ? sessions.get(sessionId) : undefined);
  if (!session) throw new NoTenantContext("platform", "no valid session");
  // ★ R2's sentence, word-for-word: no live operator grant on this session.
  if (!session.operatorGrantId) throw new PlatformGrantRequired();
  // ★ R1's sentence, word-for-word: this session resolved a practice — it is an ordinary browser
  //   session that happens to be held by a grant-holder, not a Platform session. Without this
  //   the chain would serve cross-practice rows to a day-to-day session even though 11.1's door
  //   already refuses it at the front — and a second, looser copy of a rule is how the strict
  //   copy gets deleted later as "redundant".
  if ((session.tenantId ?? null) !== null) throw new PlatformSessionRequired();
  return withOperator(session.operatorGrantId, fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// P1.10 — API TOKEN PATH  ★ THE ONE THAT BROKE IN TWENTY
// ─────────────────────────────────────────────────────────────────────────────
// ★ It is written as its own function, NOT as `handleBrowserRequest` with a different lookup,
// precisely so that a change to one cannot silently "fix" or "break" the other. Twenty's bug was
// that the token path skipped the predicate the session path applied. Two call sites, two gates.
// ★★★ 5.10 — `scope` IS THE ROUTE'S ENTRY IN `ROUTE_SCOPES` (CT-016 / Q0-9), PASSED ALL THE WAY DOWN TO
//     `keystone.authorize_api_token`. `null` means "a valid key, no scope needed"; a string is the scope the
//     key must hold. The route (src/routes/developer.mjs) is what refuses an UNMAPPED path — this layer only
//     carries whatever it was handed, so a missing argument reads as "no scope" here and never as a hole in
//     the route table.
export async function handleApiTokenRequest({ authorization, scope = undefined }, fn) {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  const token = m?.[1];
  if (!token) throw new NoTenantContext("apiToken", "no valid API token");
  // ★★★ P19.11 — THE RESOLVER IS NOW THE DATABASE, AND THE MAP IS THE GATE SEAM.
  //     [MEASURED before this change] this path read ONLY the in-memory `apiTokens` Map, so no real
  //     key could ever authenticate: a Map cannot expire, cannot be revoked, and does not survive a
  //     restart — the same three failures P13.2b recorded about the session Map.
  //   ★★ WHEN A RESOLVER IS INSTALLED THE MAP IS NOT CONSULTED AT ALL. A "try the Map, then the
  //      database" chain would let an in-memory entry SHADOW a REVOKED key, which is precisely the
  //      revocation hole `api_token.revoked_at` exists to close.
  //   ★ The Y1 gates install no resolver and keep using the Map, so their four-path isolation proof
  //     is unchanged.
  // ★★★ 5.10 — BOTH BRANCHES ARE NORMALISED TO THE SAME SHAPE. `resolveTenantForToken` now answers
  //     `{ tenantId, tokenId, environment, scopes }` or `null` (5.8), and the Y1 gate seam's Map has always
  //     held `{ tenantId }` objects, so one `?.tenantId` reads both. Reading the resolver's answer as a bare
  //     uuid string — as this line used to — would hand `withTenant` an OBJECT and surface as a confusing RLS
  //     failure three calls later.
  const resolved = apiTokenResolver ? await apiTokenResolver(token, scope) : apiTokens.get(token);
  const tenantId = resolved?.tenantId ?? null;
  if (!tenantId) throw new NoTenantContext("apiToken", "no valid API token");
  // ★★★ 7.29 — every key request is counted AGAINST THAT KEY (R-5-17). `tokenId` is supplied by the
  //     APPLICATION: `resolved` comes from the installed resolver (installApiTokenResolver, called at
  //     boot by src/auth/install.mjs) on every real request; the Y1 gate seam's Map holds only
  //     { tenantId } and no production request touches it. AFTER the credential resolved and INSIDE
  //     the tenant transaction, so an invalid key never gets this far — an unauthenticated flood
  //     creates no counter rows (the per-IP limiter bounds that).
  const tokenId = resolved?.tokenId ?? null;
  return withTenant(tenantId, async (db) => {
    // ★★★ 7.23 / Q7-19 — THE ACTOR, SET ONCE, IN THE ONE PLACE EVERY KEY REQUEST PASSES THROUGH.
    //     `emit` substitutes `api_key:<token_id>` for `'system'` when this GUC is non-empty (7.24),
    //     so the audit trail names the key without threading a second actor through the 59
    //     `userActor(...)` call sites.
    //   ★★ THE PUBLIC token_id, NEVER THE SECRET. It is an opaque handle: `api_token.token_id` is
    //      Crockford base32 and is the same value `subject` carries (src/auth/install.mjs).
    //   ★★ `true` = TRANSACTION-LOCAL. It dies with this transaction and cannot leak onto the
    //      pooled connection the next request receives — which is the whole reason for the third
    //      argument. A session-level set_config here would relabel a browser write as a key's.
    //   ★ It is issued HERE and not in `withTenant` on purpose: src/db/index.mjs is 7.6's band, and
    //     the browser path must never set this GUC at all.
    //   ★ BEFORE the limiter, so the actor is in place for anything the limiter itself writes.
    if (tokenId) {
      await db.query(`SELECT set_config('keystone.actor_api_key', $1, true)`, [tokenId]);
    }
    // FP-F8 — the key's window is handed to the route as a second argument so it can say how much is left
    const rate = tokenId ? await checkKeyLimitAside(tenantId, tokenId) : null;
    return fn(db, rate === null ? null : { limit: 600, remaining: Math.max(0, 600 - rate), resetSeconds: Math.ceil((60_000 - (Date.now() % 60_000)) / 1000) });
  });
}

/** D-020 — WHO IS THIS KEY, for the API-call log only. A refused call (a 400 raised by request validation before the key is checked, a key without the route's scope) never reaches the point where
 *  `handleApiTokenRequest` notes the workspace, so it used to vanish from the developer's log. This asks the same resolver, with NO scope required, who a still-valid key belongs to.
 *  It decides nothing: it never lets a call in, and a wrong, revoked or expired key resolves to null (no workspace can be named for it, so it stays unlogged). */
export async function recognizeApiToken(authorization) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token || !apiTokenResolver) return null;
    const r = await apiTokenResolver(token, null);
    return r?.tenantId ? { tenantId: r.tenantId, tokenId: r.tokenId ?? null } : null;
  } catch { return null; }
}

/** ★ Installed at boot so the token path resolves through `keystone.resolve_api_token`. */
export function installApiTokenResolver(fn) { apiTokenResolver = fn; }
/** Whether a real (database) key resolver is installed; without one (a bare test app) the routes' own in-memory check decides. */
export const apiTokenResolverInstalled = () => apiTokenResolver !== null;

// ─────────────────────────────────────────────────────────────────────────────
// P1.11 — WEBHOOK PATH
// ─────────────────────────────────────────────────────────────────────────────
// ★ A webhook arrives with NO user and NO session. That is why it gets its own gate: the
// temptation to "just run it as a system user with full access" is strongest here, and a system
// user with full access is the absence of tenancy.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P19.5a / U29 — THE SIGNATURE IS VERIFIED **BEFORE** THE TENANT IS RESOLVED.
//
//     WHAT THIS REPLACED, MEASURED: a bare `webhookRoutes.get(`${provider}:${externalRef}`)` with
//     **no HMAC, no timestamp and no replay window** — while this file's own header (line 13)
//     called the webhook path a *"signed vendor payload"*. Nothing signed anything.
//
//   ★★★ AND THAT WAS NOT A MISSING CHECK, IT WAS A TENANCY FAILURE. `externalRef` arrives in the
//        request BODY, so resolving a tenant from it before verifying is **TENANT SELECTION BY THE
//        ATTACKER**: anyone who knew a Stripe customer id chose whose context the handler ran in,
//        on the path that carries live payment events. Every downstream RLS policy would then be
//        working perfectly — and scoping to the tenant the attacker named.
//
//   ★ THE ORDER IS FORCED BY THE DATA: the body must be read before the tenant exists, but
//     verification needs only the raw bytes and a per-provider secret. **verify → parse → resolve.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * @param {object} a
 * @param {string} a.provider
 * @param {Buffer|string} a.rawBody THE BYTES AS RECEIVED — never a re-serialised object
 * @param {Record<string,string>} a.headers
 * @param {(body:object)=>string} a.externalRefFrom pulls the vendor object id out of the PARSED body
 * @param {Function} fn runs inside withTenant()
 */
export async function handleWebhook({ provider, rawBody, headers = {}, externalRefFrom, directTenantIdFrom }, fn) {
  // 1 · VERIFY. Throws WebhookUnverified — one message for every failure mode, no oracle.
  const verified = verifyWebhookSignature({ provider, rawBody, headers });

  // 2 · ONLY NOW PARSE. Before this line the bytes are untrusted input; after it they are a
  //     statement by a party that holds the signing secret.
  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  } catch {
    throw new NoTenantContext("webhook", "the verified payload is not JSON");
  }
  const externalRef = externalRefFrom ? externalRefFrom(body) : body?.data?.object?.customer;

  // 3 · RESOLVE THE TENANT — from the DATABASE routing table, through the definer resolver whose
  //     return type is a bare uuid, on a pre-context connection. Not from an in-memory Map.
  //   ★ `webhookRoutes` remains ONLY as a gate/test seam (see `__stores`); a resolver installed by
  //     the application takes precedence, exactly as the session path works.
  let tenantId = null;
  if (externalRef) {
    tenantId = webhookResolver
      ? await webhookResolver(provider, externalRef)
      : webhookRoutes.get(`${provider}:${externalRef}`)?.tenantId;
  }
  // ★★★ FIX (b_money_webhooks) — a REGISTERED account/customer mapping always wins above; this is
  //     reached only when the routing table found nothing (or named no vendor object at all). By
  //     this point the signature has ALREADY been verified (step 1), so the payload's own
  //     `metadata.tenantId` — data WE stamped on the object when WE created it via the Stripe API,
  //     never attacker input — is a second, direct source of the tenant, not a lookup key. Kept
  //     separate from `externalRefFrom` because a customer/account id NEEDS the routing table's
  //     translation and a tenant id does not.
  if (!tenantId && directTenantIdFrom) {
    tenantId = (await directTenantIdFrom(body)) ?? null;
  }
  if (!tenantId) {
    // ★ A VERIFIED payload for an UNMAPPED object is a genuine operational event (a tenant removed a
    //   mapping, or the vendor object belongs to nobody here) — and it is reported as such, not as a
    //   signature failure, because the two need different responses from a human.
    throw new NoTenantContext("webhook", externalRef
      ? `no tenant mapped for ${provider}:${externalRef}`
      : "the verified payload names no vendor object");
  }
  // ★ P8.2 — `tenantId` is handed to the handler as well as used to open the scope. The handlers
  //   this feeds (`handlePaymentWebhook`) take an explicit tenantId for their own WHERE clauses, and
  //   re-deriving it inside with `current_tenant_id()` would be a second source for one fact.
  return withTenant(tenantId, (tx) => fn(tx, { body, verified, tenantId }));
}

/**
 * ★ Installed by the application so the routing table lives in Postgres
 *   (`keystone_auth.webhook_source` via `keystone.resolve_webhook_source`), not in process memory.
 *   Same shape as `installSessionResolver` — and for the same reason: a Map does not survive a
 *   restart, is not shared between instances, and cannot be audited.
 */
export function installWebhookResolver(fn) { webhookResolver = fn; }

// ─────────────────────────────────────────────────────────────────────────────
// P1.12 — WORKER / QUEUE PATH
// ─────────────────────────────────────────────────────────────────────────────
// ★ A background job has no request at all. The tenant must be carried IN THE JOB ENVELOPE and
// re-established per job. A worker that opens one connection and loops over jobs from several
// tenants is the classic leak — which is why the tenant is set inside the per-job call, not once
// around the loop.
export async function handleQueueJob(job, fn) {
  if (!job?.tenantId) throw new NoTenantContext("worker", "job envelope carries no tenantId");
  return withTenant(job.tenantId, fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ `noContextRunners` USED TO LIVE HERE AND HAS BEEN MOVED TO db/gates/noContextRunners.mjs.
//
// P12.15. It wrapped `__withoutTenantContextForGatesOnly` four times and was exported FROM
// APPLICATION CODE — from the very module §D1 tells every route to import — under a name with no
// `ForGatesOnly` in it. [MEAS] the tenant-predicate lint's six patterns did not match it, and its
// own docstring in db/index.mjs says the hatch is safe because it is "greppable in review".
// ★★ Greppable was the entire enforcement, and the thing to grep for had been renamed.
//
// It is a GATE FIXTURE. It now lives with the gates, the lint has a pattern for both names, and
// an import of either from src/ fails the lint by name.
// ─────────────────────────────────────────────────────────────────────────────
