// P1.6 — withTenant(). THE ONLY EXPORTED WAY TO REACH POSTGRES.
//
// ★★★ §K3: one bundle serves staff and clients, so CLIENT-SIDE ROLE GATING IS NOT A SECURITY
// BOUNDARY. The server decides on every request, and this file is where every request passes.
//
// ★ WHY `SET LOCAL` AND NOT `SET`:
//   SET LOCAL binds the GUC's lifetime to the TRANSACTION. The pooled connection is leased for
//   exactly that interval. The two intervals are therefore identical BY CONSTRUCTION, so there
//   is no window in which a connection carries one tenant's context into another tenant's
//   request. A plain SET persists on the connection after COMMIT and goes back into the pool
//   still holding the previous tenant's id — which is a cross-tenant read with no error, no log
//   line, and nothing in the code that looks wrong.
//
// ★ set_config($1,$2,true) is used rather than literal SQL because `SET LOCAL` does not accept
//   a bind parameter. Interpolating a tenant id into SQL text would be an injection site on the
//   single most security-sensitive statement in the system. The third argument `true` means
//   is_local — it is the parameterised form of SET LOCAL, not of SET.

import { currentJob } from "./jobContext.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { dbSsl } from "./ssl.mjs";
import pg from "pg";

let pool = null;

/** Lazily build the pool. Fails loud: no default connection string, ever. */
/**
 * Round 3 (10 Oct 2026, MEASURED): terminating a database connection while a request held it (a failover, a restart, an admin `pg_terminate_backend`) emitted 'error' on a CHECKED-OUT client, which has no listener (pg-pool only listens while a client is idle) -> uncaught exception -> the whole app exited.
 * Every client of every pool gets a listener that records the loss; the query in flight still fails with the same error, so the request answers 5xx and the process lives. A connection that sits idle in a transaction is also cut by the database after two minutes, so a stuck request can never hold a row lock (the per-key rate window) forever.
 */
function guardPool(p, label) {
  p.on("error", (e) => { console.error(`[db] ${label}: idle client error: ${e?.code ?? ""} ${e?.message ?? e}`); });
  p.on("connect", (client) => { client.on("error", (e) => { console.error(`[db] ${label}: connection lost: ${e?.code ?? ""} ${e?.message ?? e}`); }); });
  return p;
}
const IDLE_TX_MS = Number(process.env.KEYSTONE_PG_IDLE_TX_MS ?? 120_000);
const LOCK_WAIT_MS = Number(process.env.KEYSTONE_PG_LOCK_WAIT_MS ?? 15_000);   // no request waits on a row or advisory lock longer than this: a waiter holds a pooled connection, and enough of them starve the pool (R3-8)
const POOL_OPTIONS = [IDLE_TX_MS > 0 ? `-c idle_in_transaction_session_timeout=${IDLE_TX_MS}` : "", LOCK_WAIT_MS > 0 ? `-c lock_timeout=${LOCK_WAIT_MS}` : ""].filter(Boolean).join(" ") || undefined;

// ★ POOL STARVATION GUARD (19 Oct 2026, found on production: one signed-in browser loading ten document pictures froze the whole app until a restart).
//   A request holds one pooled connection for its transaction and, inside it, can need a SECOND one (opening a stored file reads the workspace's data key through its own `withTenant`).
//   With as many such requests as the pool has connections, every one holds a connection and waits for another that no one will free: a deadlock the database's idle-in-transaction timeout
//   only turns into dead connections still checked out. So at most `max - reserve` OUTER transactions run at once, and a connection asked for from INSIDE a transaction (`holding`) is never
//   made to queue behind that limit, so the inner one can always be served and the outer one then finishes.
const holdingTx = new AsyncLocalStorage();
const holding = (fn) => holdingTx.run(true, fn);
function capOuterConnections(p, max) {
  const reserve = Math.min(Math.max(Number(process.env.KEYSTONE_PG_NESTED_RESERVE ?? 3), 1), Math.max(max - 1, 1));
  const limit = Math.max(max - reserve, 1); let open = 0; const waiting = [];
  const free = () => { open -= 1; waiting.shift()?.(); };
  const plain = p.connect.bind(p);
  p.connect = async (cb) => {
    if (cb || holdingTx.getStore()) return plain(cb);   // pool.query() and a connection asked for from inside a transaction: never queued behind the limit
    if (open >= limit) await new Promise((go) => waiting.push(go));
    open += 1;
    let client; try { client = await plain(); } catch (e) { free(); throw e; }
    const release = client.release; let done = false;
    client.release = (err) => { if (!done) { done = true; free(); } return release(err); };
    return client;
  };
  return p;
}

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.KEYSTONE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("KEYSTONE_DATABASE_URL is not set — refusing to guess a database");
  }
  const max = Number(process.env.KEYSTONE_PG_POOL_MAX ?? 10);
  pool = capOuterConnections(guardPool(new pg.Pool({
    connectionString,
    ssl: dbSsl(),
    max,
    application_name: "keystone",
    options: POOL_OPTIONS,
  }), "main"), max);
  return pool;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★★★ THE TRANSACTION BRAND — U26 / P15B.2a.
 * Stamped on the handle `withTenant` hands to its callback, and on nothing else. A pool, a raw
 * `pg.Client`, and the no-context gate handle all lack it.
 * ★ `Symbol.for` rather than `Symbol()` so the brand survives a module being loaded twice — which
 *   happens under a test runner and would otherwise make a correct call look forged.
 */
export const TENANT_TX = Symbol.for("keystone.tenantTransaction");

/** True only for the handle `withTenant` supplies. */
export function isTenantTx(handle) {
  return Boolean(handle && handle[TENANT_TX] === true);
}

/**
 * ★★ Throws NAMING THE CALLER AND WHAT IT WAS GIVEN. P15B.2a's red-first requires the failure to
 * come FROM the caller, not "from Postgres 40 lines later with an insufficient_privilege".
 */
export function assertTenantTx(handle, who = "this function") {
  if (isTenantTx(handle)) return true;
  // ★ Name what it actually got, because "a pool" and "undefined" are different mistakes.
  const looksLikePool =
    Boolean(handle) && (typeof handle.connect === "function" || "totalCount" in Object(handle));
  const what = handle == null
    ? String(handle)
    : looksLikePool ? "a pg POOL (or a raw client)"
    : `a ${typeof handle} with no tenant-transaction brand`;
  throw new Error(
    `${who} was given ${what}, not a tenant transaction. It must be the handle withTenant() ` +
    `passes to its callback. ★ A pool AUTO-COMMITS EACH STATEMENT STANDALONE, so the event would ` +
    `survive a rollback of the write it claims to describe — which is the one thing an outbox ` +
    `exists to make impossible.`);
}

/**
 * Run `fn` inside a transaction whose tenant context is `tenantId`.
 *
 * The callback receives a restricted client exposing only `query`. It deliberately does NOT
 * expose the raw pg client, so a caller cannot issue its own COMMIT/BEGIN and escape the
 * transaction the tenant context is scoped to.
 */
export async function withTenant(tenantId, fn, { userId = null, operatorGrantId = null } = {}) {
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    // ★ Reject before opening a transaction. A malformed tenant id must never reach set_config,
    // where a cast failure would surface as a confusing 500 mid-request.
    throw new Error(`withTenant: tenantId must be a UUID (got ${JSON.stringify(tenantId)})`);
  }
  // ★★★ P15 FINDING — `keystone.user_id` WAS SET BY NOTHING, ANYWHERE, AND TWO POLICIES DEPEND
  //     ON IT. [MEAS 2026-09-13, grep across all of src/] there was not one
  //     `set_config('keystone.user_id', …)` in the project, so `keystone.current_user_id()`
  //     returned NULL on EVERY request. Three live policies read it:
  //       · document_instance.tenant_isolation (SELECT) —
  //           (tenant_id = current_tenant_id()) AND document_is_visible(document_instance.*)
  //         With a NULL viewer the predicate is false for every row, so EVERY DOCUMENT LIST AND
  //         EVERY DOCUMENT RECORD PAGE RETURNED ZERO ROWS — for staff too.
  //       · app_user.staff_write and app_user.staff_delete —
  //           EXISTS (SELECT 1 FROM app_user u WHERE u.id = current_user_id() AND u.role='staff')
  //         False for everyone, so NO UPDATE OR DELETE on a person was possible at all.
  //     ★★ IT PRESENTED AS "NO DOCUMENTS", NOT AS AN ERROR — the exact failure shape this project
  //        keeps meeting, and the reason Part F's "a query actually ran" guard exists. It was
  //        invisible for eleven phases because nothing had ever read a document through a route.
  //     ★ The three no-user paths (webhook, worker, and the API-token path until PHASE 19 rules
  //       it) pass no userId and leave the GUC unset. That is CORRECT: a Stripe webhook has no
  //       viewer, and a predicate about a viewer must refuse rather than invent one.
  if (userId !== null && (typeof userId !== "string" || !UUID_RE.test(userId))) {
    throw new Error(`withTenant: userId must be a UUID or null (got ${JSON.stringify(userId)})`);
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('keystone.tenant_id', $1, true)", [tenantId]);
    // ★ `set_config(…, '', true)` leaves current_user_id() NULL — `nullif(…, '')::uuid`
    //   (0001) is what makes the empty string and "unset" the same thing. Always issued, so the
    //   GUC can never be inherited from a previous transaction on a pooled connection.
    await client.query("SELECT set_config('keystone.user_id', $1, true)", [userId ?? ""]);
    // ★★★ TASK 7.6 / CLAUDE.md FAILURE #1 — "a GUC three live policies read that nothing in the
    //     application ever set" (CONTRACTS.md Q0-5). `keystone.caller_is_platform()` (0186) reads
    //     THIS GUC — a live operator-grant id, not a boolean stamped at sign-in — so a mid-session
    //     revoke takes effect at the very next statement. Set from `resolveSession`'s own output
    //     only (src/auth/session.mjs → src/paths/index.mjs's `handleBrowserRequest`), never from a
    //     header or a request parameter. `set_config(…, '', true)` is what makes an absent grant
    //     and "unset" the same thing, exactly like `keystone.user_id` above.
    await client.query("SELECT set_config('keystone.operator_grant_id', $1, true)", [operatorGrantId ?? ""]);
    // ★ Run 9 (F984): the background job this transaction belongs to, only for a no-person handle and only from the job context the task wrapper sets (src/db/jobContext.mjs). Always issued,
    //   so a pooled connection never inherits it. The system_* policies require it: a public route's no-person handle no longer sees what a sweep sees.
    await client.query("SELECT set_config('keystone.system_job', $1, true)", [userId === null ? (currentJob() ?? "") : ""]);
    // ★★★ U26 / P15B.2a — THE HANDLE IS BRANDED, AND THE BRAND IS THE GUARANTEE.
    //     [MEAS] `emit(tx, …)` validated `topic` and `emittedBy` and NOTHING ABOUT `tx`, so
    //     `emit(pool, {...})` type-checked, ran, and AUTO-COMMITTED STANDALONE — the exact thing
    //     outbox.mjs:60 forbids in a comment ("never a pool, never a new client"). The only thing
    //     stopping it was the RLS WITH CHECK raising from `require_tenant_id()` forty lines later,
    //     with a message about privilege, and no guard had ever tried it.
    //     ★★ A SYMBOL, not a boolean property: it cannot be produced by `JSON.parse`, does not
    //        survive a structured clone, and cannot be set by accident on a pool. Forging it takes
    //        importing this module and meaning it.
    //     ★ `__withoutTenantContextForGatesOnly` deliberately does NOT brand its handle. Emitting
    //       an event with no tenant context is never correct, so it should fail at `emit`, by
    //       name, rather than deep in a policy.
    const result = await holding(() => fn({
      query: (text, params) => client.query(text, params),
      [TENANT_TX]: true,
    }));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ★ Run WITHOUT tenant context, on purpose.
 *
 * This exists so the Y1 gates can prove that the no-context case returns ZERO ROWS through the
 * real code path rather than through a hand-written query. It is exported under a name that is
 * impossible to call by accident and is greppable in review.
 *
 * It is NOT an escape hatch: it opens a transaction with the GUC unset, so every RLS predicate
 * evaluates `= NULL` → NOT TRUE → no rows. It grants nothing.
 */
/**
 * ★★★ P13 — THE CREDENTIAL LOOKUP. A TRANSACTION WITH NO TENANT CONTEXT, ON PURPOSE, FOR EXACTLY
 * ONE JOB: calling the `keystone.resolve_*` definer functions that DECIDE the tenant.
 *
 * ★★ WHY IT HAS TO EXIST, AND WHY IT IS NOT THE GATES-ONLY HATCH WEARING A NEW NAME.
 * `withTenant(tenantId, fn)` demands a UUID before it will open anything (db/index.mjs:48-53).
 * But the whole point of a session token, an API key or a webhook route is that THE TENANT IS
 * NOT KNOWN YET — resolving it is what the lookup is for. So the one query that establishes
 * tenancy cannot itself run inside tenancy. That is the D2.1 chicken-and-egg, and it needs a
 * door rather than a workaround.
 *
 * ★★★ WHAT KEEPS IT HONEST — three things, none of them "be careful":
 *   1. It is USELESS for reading tenant data. With no GUC set, every RLS predicate evaluates
 *      `= NULL` → NOT TRUE → zero rows. It grants nothing it does not already have.
 *   2. The credential tables are in `keystone_auth`, where app_rw holds NO privilege at all —
 *      SQLSTATE 42501, proven in the P13 gate. So even here, a direct read is refused.
 *   3. The tenant-predicate lint restricts this function to `src/auth/` AND restricts what may
 *      be called inside it to the named `keystone.resolve_*` definers (rule A). Anything else
 *      fails the gate by name.
 *
 * ★ It is deliberately NOT called `__withoutTenantContextForGatesOnly`. That function is a GATE
 *   FIXTURE and is now refused in `src/` by name (P12.15). Two different jobs, two names, both
 *   greppable — and this one has a rule attached rather than a promise.
 */
export async function withCredentialLookup(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // ★ NO set_config, and that is the point. Every keystone.* table stays invisible.
    // ★★ READ ONLY: a credential lookup must never write. `create_session` is a separate,
    //    deliberate call made through this same door at LOGIN — see the note in src/auth — so
    //    this flag is set per call rather than hardcoded.
    const result = await holding(() => fn({ query: (text, params) => client.query(text, params) }));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ★★★ TASK 11.19 — THE PRACTICE-LESS TRANSACTION: CARRIES THE GRANT, CARRIES NO PRACTICE.
 *
 * The sibling of `withCredentialLookup` above (`:184-201`) for a caller who HAS already been
 * admitted through the narrow door (11-B1: a live grant AND a session that resolved no practice —
 * enforced by `handlePlatformRequest` in src/paths/index.mjs, not here). This function only opens
 * the transaction that admission earns.
 *
 * Opens a transaction that sets ONLY `keystone.operator_grant_id` — deliberately NO
 * `keystone.tenant_id` and NO `keystone.user_id`. `keystone.caller_is_platform()` (0186) keys on
 * the grant GUC alone, so it reads true here; the definer listers (`platform_list_tenants()` etc.,
 * 0018) carry no practice predicate at all, so they work too. But every ORDINARY practice-scoped
 * RLS policy evaluates `current_tenant_id()` and gets NULL — `= NULL` is never TRUE — so every such
 * policy returns ZERO ROWS. That is the honest answer for a caller who is not inside a practice,
 * not a bug to route around with a second query shape.
 *
 * Hands the callback the SAME branded tenant-transaction handle `withTenant` produces (`:48-53`),
 * so `assertTenantTx`-guarded helpers such as `callerIsPlatform` (`:356`) and `emit` keep working
 * unchanged.
 */
export async function withOperator(operatorGrantId, fn) {
  if (typeof operatorGrantId !== "string" || !UUID_RE.test(operatorGrantId)) {
    // ★ Reject before opening a transaction — same fail-before-BEGIN reasoning as withTenant:83-87.
    throw new Error(`withOperator: operatorGrantId must be a UUID (got ${JSON.stringify(operatorGrantId)})`);
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // ★ Exactly one set_config — the grant, transaction-local. Deliberately NO keystone.tenant_id
    //   and NO keystone.user_id: this caller is not inside a practice and has no viewer.
    await client.query("SELECT set_config('keystone.operator_grant_id', $1, true)", [operatorGrantId]);
    const result = await holding(() => fn({
      query: (text, params) => client.query(text, params),
      [TENANT_TX]: true,
    }));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function __withoutTenantContextForGatesOnly(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Deliberately NO set_config here. That is the entire point.
    const result = await holding(() => fn({ query: (text, params) => client.query(text, params) }));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ★★★ P17.9 / P2.5 — THE SIGNUP CONNECTION. ITS OWN POOL, ITS OWN ROLE, AND THAT IS THE POINT.
 *
 * `runCriticalPrefix` must INSERT a `tenant` BEFORE any tenant context exists, so it cannot use
 * `withTenant` (there is no tenant yet) and it cannot use `withCredentialLookup` (that is the
 * app_rw pool with no context, and app_rw has no INSERT policy on `tenant` — [MEAS] the only
 * policies there are `tenant_isolation` and `tenant_health_read`).
 *
 * ★★ IT IS DELIBERATELY NOT THE SUPERUSER, WHICH IS WHAT THE TEST USES. `test/p2_05_prefix.test.mjs`
 *    connects with `KEYSTONE_SEED_URL` and works because a superuser bypasses RLS entirely. Fine for
 *    a test; in production it would mean any injected SQL or leaked variable is total compromise of
 *    every tenant. Under `app_signup` (migration 0025) the same accident buys the ability to insert
 *    ONE provisioning-state tenant and ONE staff row, on four tables, and nothing else — it cannot
 *    even SELECT a slug, so it cannot enumerate customers.
 * ★★★ AND IT IS NOT `auth_owner`, which is the trap worth naming: auth_owner OWNS `keystone_auth`.
 *    A role that can read `api_token` must never be the role that signs people up. D-17.9.
 *
 * ★ SEPARATE POOL, NOT `SET ROLE` ON THE MAIN ONE. A `SET ROLE` that failed to reset would leave a
 *   pooled connection holding signup privileges for every later request on it — the worst kind of
 *   leak because it is intermittent and depends on pool scheduling.
 * ★ NO BRAND. The handle is not a tenant transaction and `emit()` must refuse it: a signup emits
 *   `platform.tenant.provisioned` from the PLATFORM path after the fact, not from inside the prefix.
 */
let signupPool = null;
export async function withSignupConnection(fn) {
  if (!signupPool) {
    const connectionString = process.env.KEYSTONE_SIGNUP_URL;
    if (!connectionString) {
      // ★ FAIL LOUD, and say why it is a DIFFERENT variable rather than falling back to the main
      //   one. A fallback here would silently run signup as app_rw, which cannot insert a tenant —
      //   and the failure would surface as an RLS error on a customer's first action.
      throw new Error(
        "KEYSTONE_SIGNUP_URL is not set. Signup needs its OWN connection as the `app_signup` role " +
        "(migration 0025) because it writes BEFORE any tenant context exists. It is deliberately " +
        "not KEYSTONE_DATABASE_URL (app_rw cannot insert a tenant) and deliberately not the " +
        "superuser (D-17.9)."
      );
    }
    signupPool = guardPool(new pg.Pool({
      connectionString,
      ssl: dbSsl(),
      // ★ Two. Signup is rare and must never be able to starve the request pool.
      max: Number(process.env.KEYSTONE_SIGNUP_POOL_MAX ?? 2),
      application_name: "keystone-signup",
    }), "signup");;
  }
  const client = await signupPool.connect();
  try {
    // ★★ NO BEGIN HERE. `createRun` and `runCriticalPrefix` each manage their own transaction —
    //    the prefix's all-or-nothing property IS its own BEGIN/COMMIT, and wrapping it in an outer
    //    transaction would silently turn its COMMIT into a no-op inside ours.
    return await fn({ query: (text, params) => client.query(text, params) });
  } finally {
    client.release();
  }
}

export async function closeSignupPool() {
  if (signupPool) { await signupPool.end(); signupPool = null; }
}

/**
 * ★★★ TASK 6.18 / R-5-9 / F563 — THE LIMITER'S OWN CONNECTION.
 *
 * `checkTenantLimit` used to run its upsert on the SAME connection, inside the SAME transaction,
 * as the rest of the request — so the counter row's lock was held from the upsert until the
 * request's COMMIT, and every request for the same practice and bucket serialised behind
 * whichever one was slowest. This is the fix: a short-lived connection of its own, released the
 * instant the bump completes, exactly the shape `withSignupConnection` above uses.
 *
 * ★ It uses `KEYSTONE_DATABASE_URL` — the SAME role (`app_rw`) as the request pool, not a new
 *   credential. `keystone.bump_rate_limit_window` (migration 0178) is SECURITY INVOKER, so it runs
 *   as `app_rw` under FORCE RLS exactly like the upsert it replaces; nothing here needs elevated
 *   privilege. Fails loud in the same words `getPool()` uses, if the variable is absent.
 * ★ `application_name: "keystone-limiter"` so a connection census can tell this pool apart from
 *   the request pool and the signup pool.
 * ★ The handle is `{ query }` only, exactly like `withSignupConnection`'s, and carries NO
 *   `TENANT_TX` brand — it is not a tenant transaction and must not be usable as one.
 * ★ Do not raise `KEYSTONE_PG_POOL_MAX` to "make room" for this — the point of a separate pool is
 *   that the request pool is unchanged.
 */
let limiterPool = null;
export async function withLimiterConnection(fn) {
  if (!limiterPool) {
    const connectionString = process.env.KEYSTONE_DATABASE_URL;
    if (!connectionString) {
      throw new Error("KEYSTONE_DATABASE_URL is not set — refusing to guess a database");
    }
    limiterPool = guardPool(new pg.Pool({
      connectionString,
      ssl: dbSsl(),
      max: Number(process.env.KEYSTONE_LIMITER_POOL_MAX ?? 4),
      application_name: "keystone-limiter",
    }), "limiter");;
  }
  const client = await limiterPool.connect();
  try {
    return await fn({ query: (text, params) => client.query(text, params) });
  } finally {
    client.release();
  }
}

/** ★ Exactly ONE call site: src/server.mjs's shutdown(code), beside closePool(). */
export async function closeLimiterPool() {
  if (limiterPool) { await limiterPool.end(); limiterPool = null; }
}

/**
 * ★★★ specs/STRIPE-MIRROR.md §3.4 — THE ONE CONNECTION ALLOWED TO SEE THE `stripe` SCHEMA.
 *
 * Same shape as `withLimiterConnection` above (its own short-lived pool, `KEYSTONE_DATABASE_URL`,
 * released the instant the read completes) with ONE difference: migration 0572 made `app_rw` a
 * member of a NOLOGIN role, `app_stripe_mirror`, that is the ONLY grantee on the `stripe` schema
 * (db/migrate.mjs, right after the sync engine's own migrations run) — `app_rw` itself is never
 * granted anything there, so a tenant-scoped request reaches it by NO accidental path. `SET ROLE`
 * switches the connection's effective privilege for exactly this one read; `RESET ROLE` before
 * release means a connection handed back to the pool never carries the switch into whatever
 * borrows it next, the same reasoning `withTenant`'s own header gives for `SET LOCAL` over `SET`.
 *
 * ★ The handle is `{ query }` only, carries NO `TENANT_TX` brand, and is never exposed to a route
 *   that could supply its own SQL — the only caller is `src/money/stripeMirror.mjs#queryMirror`,
 *   which accepts a tenant id and fixed, file-defined queries, never caller-supplied SQL text.
 */
let stripeMirrorPool = null;
export async function withStripeMirrorConnection(fn) {
  if (!stripeMirrorPool) {
    const connectionString = process.env.KEYSTONE_DATABASE_URL;
    if (!connectionString) {
      throw new Error("KEYSTONE_DATABASE_URL is not set — refusing to guess a database");
    }
    stripeMirrorPool = guardPool(new pg.Pool({
      connectionString,
      ssl: dbSsl(),
      max: Number(process.env.KEYSTONE_STRIPE_MIRROR_POOL_MAX ?? 4),
      application_name: "keystone-stripe-mirror",
    }), "stripe-mirror");;
  }
  const client = await stripeMirrorPool.connect();
  try {
    await client.query("SET ROLE app_stripe_mirror");
    return await fn({ query: (text, params) => client.query(text, params) });
  } finally {
    await client.query("RESET ROLE").catch(() => {});
    client.release();
  }
}

/** ★ Exactly ONE call site: src/server.mjs's shutdown(code), beside closePool(). */
export async function closeStripeMirrorPool() {
  if (stripeMirrorPool) { await stripeMirrorPool.end(); stripeMirrorPool = null; }
}

export async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THE OPERATOR BOUNDARY, ASKED ONCE. Stage 7 task 7.12b, promoted here by the 21 Sep 2026
 *     ruling on F594 — `STAGE-7-PLAN.md` 7.12b field 4 says "through 7.6's `callerIsPlatform(db)`
 *     helper (already built — import it, don't reinvent)" and **no such export existed anywhere in
 *     `src/`** (MEASURED: `grep -rn "callerIsPlatform" src/` before 7.12b returned nothing; 7.6's
 *     own file list only redefines the zero-argument SQL function `keystone.caller_is_platform()`).
 *     This is that export, so `src/routes/platform.mjs` (7.12b), `src/routes/writes.mjs`'s
 *     `platform: true` branch (7.12a) and any later `developer.mjs` follow-up ask the SAME question
 *     through the SAME line, instead of each growing its own private copy.
 *
 * ★★ WHO SUPPLIES THE CONDITION: THE APPLICATION. `keystone.caller_is_platform()` (0186) takes no
 *    arguments — it reads the `keystone.operator_grant_id` GUC, which is set ONLY by `withTenant`
 *    above (`:123`), from the session resolver's own output. Nothing a request can send reaches it.
 *    An empty GUC yields `NULL::uuid`, `EXISTS` is false, and the call fails CLOSED.
 *
 * ★ It re-reads the grant on every call, which is the point of 7.6 carrying a uuid rather than a
 *   boolean: a grant revoked mid-session stops working at the next statement.
 *
 * ★ `assertTenantTx` first, deliberately: handed a POOL this would auto-commit-per-statement and,
 *   worse, run with NO tenant context at all — where every RLS predicate is `= NULL` and the honest
 *   answer to "is this caller the operator" is unobtainable rather than false. Fail by the caller's
 *   name, not forty lines later inside a policy (P15B.2a).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export async function callerIsPlatform(db) {
  assertTenantTx(db, "callerIsPlatform");
  const { rows } = await db.query("SELECT keystone.caller_is_platform() AS ok");
  return rows[0]?.ok === true;
}
