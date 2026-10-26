// P1.14 — RATE LIMITING, PER TENANT *AND* PER IP.
//
// ★★ BOTH DIMENSIONS, AND THEY ARE NOT INTERCHANGEABLE:
//   per-IP only     → one tenant exhausts every other tenant's budget from many addresses
//   per-tenant only → an UNAUTHENTICATED flood never gets as far as having a tenant, so nothing
//                     limits it at all
//
// ★ PER-IP IS IN-PROCESS, ON PURPOSE. It runs BEFORE authentication and before any database
// round trip. A per-IP limiter that queries Postgres to decide whether to reject a request is an
// amplifier, not a limiter — the flood it exists to stop becomes a flood of database queries.
//
// ★ PER-TENANT IS IN POSTGRES, because it must hold across replicas. An in-process per-tenant
// counter lets N replicas serve N× the intended limit, which is the same as having no limit and
// is much harder to notice.

import { createHash } from "node:crypto";
import { FACTS } from "../product/docustayPrices.mjs";
import { rateLimited } from "./errors.mjs";
import { withLimiterConnection } from "../db/index.mjs"; // task 6.18 / F563 — checkTenantLimit's own connection

// ─────────────────────────────────────────────────────────────────────────────
// CT-004 — the retry interval is a first-class field on the error
// ─────────────────────────────────────────────────────────────────────────────
// ★ `detail.retryAfterSeconds` is kept (anything reading it today keeps working) AND the same number
// is set on the error object itself, where the error sink (5.6) finds it and writes the `Retry-After`
// header. The header is NOT written here — this module only guarantees the number exists.
function withRetryAfter(err, seconds) {
  err.retryAfterSeconds = seconds;
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// CT-009 — the closed bucket vocabulary (F477)
// ─────────────────────────────────────────────────────────────────────────────
// ★ MEASURED 21 Sep 2026: ten of these are literal `bucket: "…"` arguments across src/ (46 call
// sites); the eleventh, `api`, is NEVER written as a literal — it is `runTenantScoped`'s default
// parameter (src/http/app.mjs, `{ bucket = "api", … }`). A grep alone finds ten.
// ★ Migration 0166 puts the same eleven names in a CHECK on keystone.rate_limit_window.bucket, in
// the same order. Adding a bucket is an edit HERE and a new migration, never one without the other.
export const RATE_BUCKETS = Object.freeze([
  "api",
  "app",
  "documents",
  "engagements",
  "home",
  "list",
  "nav",
  "platform",
  "public_booking",
  "records",
  "settings",
  "write",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Per-IP — in-process fixed window
// ─────────────────────────────────────────────────────────────────────────────
const ipWindows = new Map(); // ip -> { windowStart, count }

export function checkIpLimit(ip, { limit = 120, windowMs = 60_000, now = Date.now() } = {}) {
  if (!ip) return; // a caller with no resolvable IP is handled by the per-tenant limiter
  const start = Math.floor(now / windowMs) * windowMs;
  const cur = ipWindows.get(ip);
  if (!cur || cur.windowStart !== start) {
    ipWindows.set(ip, { windowStart: start, count: 1 });
    return;
  }
  cur.count += 1;
  if (cur.count > limit) {
    const retryAfter = Math.ceil((start + windowMs - now) / 1000);
    throw withRetryAfter(rateLimited(`too many requests from this address`, { retryAfterSeconds: retryAfter }), retryAfter);
  }
}

/** Bounded cleanup so the map cannot grow without limit under a distributed flood. */
export function sweepIpWindows(now = Date.now(), windowMs = 60_000) {
  const cutoff = Math.floor(now / windowMs) * windowMs;
  let removed = 0;
  for (const [ip, w] of ipWindows) {
    if (w.windowStart < cutoff) { ipWindows.delete(ip); removed++; }
  }
  return removed;
}

export const __ipWindows = ipWindows; // tests only

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant — Postgres fixed window, shared across replicas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ★★★ TASK 6.18 / R-5-9 / F563 — MUST NOT BE CALLED ON THE REQUEST'S TRANSACTION.
 *
 * This used to say the opposite: "must be called INSIDE withTenant()". That instructed the exact
 * mistake it caused — the upsert ran on the request's own connection, inside the request's own
 * transaction, so the counter row's lock was held from the upsert until the request's COMMIT.
 * Every request for the same practice and bucket serialised behind whichever one was slowest, and
 * a request that failed rolled its own count back, making a flood of errors unlimited.
 *
 * `bump` now does the write, on its OWN short-lived connection (`withLimiterConnection`,
 * `src/db/index.mjs`), through `keystone.bump_rate_limit_window` (migration 0178) — so the lock is
 * released at once. `db` is no longer a parameter: a parameter kept and unused is a lie the next
 * reader has to disprove, and removing it makes the old mistake impossible to write.
 */
const defaultBump = (tenantId, bucket, start) =>
  withLimiterConnection(({ query }) => query(
    `SELECT keystone.bump_rate_limit_window($1, $2, $3) AS count`,
    [tenantId, bucket, start]
  ));

export async function checkTenantLimit(tenantId, bucket, { limit = FACTS.limits.apiRequestsPerMinute, windowMs = 60_000, now = Date.now(), bump = defaultBump } = {}) {
  // ★ A bucket outside the closed set is a PROGRAMMING error, not a client error: no request can cause
  // it, so it is a plain Error (which the sink renders as a 500), not an AppError. Refused BEFORE the
  // database is touched — the CHECK in migration 0166 is the second wall, this is the first.
  if (!RATE_BUCKETS.includes(bucket)) {
    throw new Error(`checkTenantLimit: unknown rate-limit bucket ${JSON.stringify(bucket)} — add it to RATE_BUCKETS and to a migration`);
  }
  const start = new Date(Math.floor(now / windowMs) * windowMs);

  // ★ A single atomic upsert, now on the limiter's own connection. Read-then-write would race
  // between replicas and undercount exactly when the limit matters most — under load.
  const { rows } = await bump(tenantId, bucket, start);
  const count = rows[0].count;
  if (count > limit) {
    const retryAfter = Math.ceil((start.getTime() + windowMs - now) / 1000);
    throw withRetryAfter(rateLimited(`rate limit exceeded for ${bucket}`, { retryAfterSeconds: retryAfter, limit }), retryAfter);
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────
// Per-ADDRESS, SHARED — Postgres fixed window for the few routes an attacker most wants (Part 30 item 14)
// ─────────────────────────────────────────────────────────────────
// ★ The in-process per-IP limit above is per instance: two instances allow twice the budget. Sign-in, public signing, signed-copy download links and public verification are low-volume and high-value,
//   so they ALSO count here, in a table every instance shares (migration 0637). The address is hashed; nothing readable is stored.
// ★ FAILS OPEN, and logs: if the counter cannot be reached the request goes ahead (the database being down stops everything else on its own; a limiter must not be the thing that locks people out).
export const SHARED_IP_BUCKETS = Object.freeze({
  sign_in: { limit: 40, windowMs: 60_000 },
  public_signing: { limit: 240, windowMs: 60_000 },       // one signing page makes a handful of calls (view, pages, progress, sign)
  public_download: { limit: 30, windowMs: 60_000 },
  public_verify: { limit: 60, windowMs: 60_000 },
});
const defaultIpBump = (bucket, keyHash, start) => withLimiterConnection(({ query }) => query(`SELECT keystone.bump_ip_rate_window($1, $2, $3) AS count`, [bucket, keyHash, start]));
/** Which shared bucket a request path belongs to, or null (most paths have none). */
const STATIC_SIGN_IN_FACTS = new Set(["/api/auth/config", "/api/auth/oidc/config", "/api/auth/passkeys/status"]);
export function sharedBucketOf(path, method = "POST") {
  // Run 8 (R8-15): the sign-in PAGE reads its static set-up facts on every load; counting that GET against the sign-in budget meant an office opening the page 40 times a minute
  // from one address locked everyone there out of signing in. Every other /api/auth/ request still counts (GET /api/auth/practices too: it can tell what an address belongs to).
  // ★ The page reads THREE such facts (install-wide, the same for everyone: nothing about a person or an address) — Run 8 found the other two still counted and the page locked itself out.
  if (method === "GET" && STATIC_SIGN_IN_FACTS.has(path)) return null;
  if (path.startsWith("/api/public/pdf/download/")) return "public_download";
  if (path.startsWith("/api/public/pdf/")) return "public_signing";
  if (path === "/api/public/documents/verify-facts") return "public_verify";
  if (path.startsWith("/api/auth/")) return "sign_in";
  return null;
}
export async function checkSharedIpLimit(ip, bucket, { now = Date.now(), bump = defaultIpBump, log = console } = {}) {
  const cfg = SHARED_IP_BUCKETS[bucket];
  if (!cfg) throw new Error(`checkSharedIpLimit: unknown bucket ${JSON.stringify(bucket)}`);
  if (!ip) return null;
  const start = new Date(Math.floor(now / cfg.windowMs) * cfg.windowMs);
  let count;
  try { count = (await bump(bucket, createHash("sha256").update(`${bucket}|${ip}`).digest("hex"), start)).rows[0].count; }
  catch (e) { log.warn?.(`shared rate limit unavailable (${e.code ?? e.message}); allowing the request`); return null; }
  if (count > cfg.limit) {
    const retryAfter = Math.ceil((start.getTime() + cfg.windowMs - now) / 1000);
    throw withRetryAfter(rateLimited(`too many requests from this address`, { retryAfterSeconds: retryAfter, limit: cfg.limit }), retryAfter);
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-API-KEY — Postgres fixed window, shared across replicas (task 7.29 / R-5-17)
// ─────────────────────────────────────────────────────────────────────────────
// ★ Modelled directly on checkTenantLimit above, same shape, same parameters — but keyed on the
// KEY (token_id), not the practice, so a second key on the same practice is never affected by the
// first (keystone.api_key_rate_window, migration 0225). Must be called INSIDE withTenant(), same
// reason as checkTenantLimit: the tenant GUC is what scopes the counter row.
export async function checkKeyLimit(db, tenantId, tokenId, { limit = FACTS.limits.apiRequestsPerMinute, windowMs = 60_000, now = Date.now() } = {}) {
  // ★ A malformed tokenId is a PROGRAMMING error, not a client error — no request can cause it,
  // because `tokenId` is supplied by the application's own resolved credential (never client
  // input), so it is a plain Error refused BEFORE the database is touched, exactly as
  // checkTenantLimit refuses an unknown bucket. The pattern matches keystone_auth.api_token's own
  // CHECK on token_id (0045:56) and migration 0225's CHECK on this table.
  if (typeof tokenId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(tokenId)) {
    throw new Error(`checkKeyLimit: malformed tokenId ${JSON.stringify(tokenId)}`);
  }
  const start = new Date(Math.floor(now / windowMs) * windowMs);

  // ★ A single atomic upsert — same reasoning as checkTenantLimit: read-then-write would race
  // between replicas and undercount exactly when the limit matters most.
  const { rows } = await db.query(
    `INSERT INTO keystone.api_key_rate_window (tenant_id, token_id, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, token_id, window_start)
     DO UPDATE SET count = keystone.api_key_rate_window.count + 1
     RETURNING count`,
    [tenantId, tokenId, start]
  );
  const count = rows[0].count;
  if (count > limit) {
    const retryAfter = Math.ceil((start.getTime() + windowMs - now) / 1000);
    throw withRetryAfter(
      rateLimited(`rate limit exceeded for this API key`, { retryAfterSeconds: retryAfter, limit }),
      retryAfter
    );
  }
  return count;
}

/**
 * The same limit as checkKeyLimit, counted on its OWN short transaction over the limiter pool (Round 3, 10 Oct 2026, MEASURED).
 * checkKeyLimit inside the request's transaction takes a row lock on the key's window row that is held until the request COMMITS, so every concurrent request on one key queued behind the slowest one
 * (and one stuck request blocked the key for everyone: 9 requests waited 30 minutes). Here the lock lasts one statement. The count is committed even when the limit is exceeded.
 */
export async function checkKeyLimitAside(tenantId, tokenId, { limit = FACTS.limits.apiRequestsPerMinute, windowMs = 60_000, now = Date.now() } = {}) {
  if (typeof tokenId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(tokenId)) throw new Error(`checkKeyLimitAside: malformed tokenId ${JSON.stringify(tokenId)}`);
  const start = new Date(Math.floor(now / windowMs) * windowMs);
  const count = await withLimiterConnection(async (conn) => {
    await conn.query("BEGIN");
    try {
      await conn.query("SELECT set_config('keystone.tenant_id', $1, true)", [tenantId]);
      const { rows } = await conn.query(
        `INSERT INTO keystone.api_key_rate_window (tenant_id, token_id, window_start, count) VALUES ($1, $2, $3, 1)
         ON CONFLICT (tenant_id, token_id, window_start) DO UPDATE SET count = keystone.api_key_rate_window.count + 1 RETURNING count`, [tenantId, tokenId, start]);
      await conn.query("COMMIT");
      return rows[0].count;
    } catch (e) { try { await conn.query("ROLLBACK"); } catch { /* the connection is gone; the pool drops it */ } throw e; }
  });
  if (count > limit) {
    const retryAfter = Math.ceil((start.getTime() + windowMs - now) / 1000);
    throw withRetryAfter(rateLimited(`rate limit exceeded for this API key`, { retryAfterSeconds: retryAfter, limit }), retryAfter);
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-email — Postgres fixed window, shared across replicas (task 8.11 / CT-056 / spec 04 §5)
// ─────────────────────────────────────────────────────────────────────────────
// ★ Durable, not the in-process map above: the budget is keyed on the EMAIL ADDRESS (or, for
// scope 'ip', the requesting address) — a value the in-process map has never held — and a
// per-deploy reset is not a limit against credential stuffing. Counts in
// keystone_auth.code_request_window (task 8.2) through keystone.take_code_request (migration
// 0205); this module never touches that table directly. Called from the two unauthenticated
// /api/auth/code/* routes and from POST /api/auth/login (task 8.12) on every real request.
export async function checkEmailLimit(db, email, scope, { limit = 5, windowMs = 900_000 } = {}) {
  // ★ An unknown scope is a PROGRAMMING error, not a client error — refused BEFORE the database is
  // touched, the same shape checkTenantLimit gives an unknown bucket and checkKeyLimit gives a
  // malformed tokenId.
  if (scope !== "email" && scope !== "ip") {
    throw new Error(`checkEmailLimit: unknown scope ${JSON.stringify(scope)} — must be 'email' or 'ip'`);
  }
  const key = String(email).toLowerCase();
  const { rows } = await db.query(
    `SELECT keystone.take_code_request($1, $2, $3, make_interval(secs => $4)) AS allowed`,
    [scope, key, limit, windowMs / 1000]
  );
  if (!rows[0].allowed) {
    const now = Date.now();
    const start = Math.floor(now / windowMs) * windowMs;
    const retryAfter = Math.ceil((start + windowMs - now) / 1000);
    throw withRetryAfter(
      rateLimited(`too many attempts for that address`, { retryAfterSeconds: retryAfter }),
      retryAfter
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-form-submit — in-process fixed window (task 9.8 / CT-097)
// ─────────────────────────────────────────────────────────────────────────────
// ★ Applied ONLY on Turnstile's `unreachable` path (`src/http/turnstile.mjs`) — a submit whose
// token Cloudflare actively verified never reaches this limiter. IN-PROCESS, same reasoning as
// `checkIpLimit` above: this runs before any tenant is known, before authentication, and must not
// turn the very flood it exists to stop into a flood of database queries.
// ★★ Keyed `${form}:${ip}` — deliberately NOT a `RATE_BUCKETS` entry. `RATE_BUCKETS` (`:38-50`)
// mirrors a Postgres CHECK (migration 0166) for the per-TENANT limiter's shared-across-replicas
// path; this limiter has no tenant yet and needs none — same shape as `checkIpLimit`, not
// `checkTenantLimit`. Adding a twelfth bucket is a plan defect this task does not commit.
const formSubmitWindows = new Map(); // "${form}:${ip}" -> { windowStart, count }

/** The sandbox test program makes hundreds of accounts from one address. KEYSTONE_TEST_FORM_LIMIT_MULTIPLIER raises the per-address form limits, and ONLY where KEYSTONE_ENVIRONMENT is staging, local or test: production, and a self-hosted install (which runs as production), ignore it, so it can never loosen a real deployment. */
export const formLimitFor = (limit, env = process.env) => {
  const m = Number(env.KEYSTONE_TEST_FORM_LIMIT_MULTIPLIER);
  return ["staging", "local", "test"].includes(env.KEYSTONE_ENVIRONMENT ?? "") && Number.isFinite(m) && m > 1 ? limit * Math.min(m, 1000) : limit;
};
/** Run 8: the same rule for the per-address API budget a browser gets (120 a minute): a screen sweep loads hundreds of pages from one address. KEYSTONE_TEST_IP_LIMIT_MULTIPLIER, honoured ONLY where KEYSTONE_ENVIRONMENT is staging, local or test — production and self-hosted ignore it. */
export const ipLimitFor = (limit = 120, env = process.env) => {
  const m = Number(env.KEYSTONE_TEST_IP_LIMIT_MULTIPLIER);
  return ["staging", "local", "test"].includes(env.KEYSTONE_ENVIRONMENT ?? "") && Number.isFinite(m) && m > 1 ? limit * Math.min(m, 1000) : limit;
};
export function formSubmitLimiter(form, ip, { limit = 5, windowMs = 3_600_000, now = Date.now(), env = process.env } = {}) {
  limit = formLimitFor(limit, env);
  if (typeof form !== "string" || form.length === 0) {
    throw new Error("formSubmitLimiter: form is required");
  }
  // ★ RUN-2 (26 Sep 2026): an UNAUTHENTICATED write with no resolvable IP no longer skips the limit.
  //   It used to `return` here — and every /go/* public form got a null IP (clientIp was only set
  //   under /api/*), so the public lead form was never limited at all (test/c_public_routes).
  //   trustedIp.mjs's own rule: a request with no address is exactly what an attacker can arrange —
  //   so those requests share ONE bucket (fail closed), rather than each getting none.
  const key = `${form}:${ip || "unresolved"}`;
  const start = Math.floor(now / windowMs) * windowMs;
  const cur = formSubmitWindows.get(key);
  if (!cur || cur.windowStart !== start) {
    formSubmitWindows.set(key, { windowStart: start, count: 1 });
    return;
  }
  cur.count += 1;
  if (cur.count > limit) {
    const retryAfter = Math.ceil((start + windowMs - now) / 1000);
    throw withRetryAfter(
      rateLimited(`This form has had too many tries in a short time. Try again later.`, { retryAfterSeconds: retryAfter }),
      retryAfter
    );
  }
}

export const __formSubmitWindows = formSubmitWindows; // tests only
