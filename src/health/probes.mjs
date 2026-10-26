// P12.6 — THE FOUR READINESS PROBES. NONE OF THESE EXISTED ANYWHERE IN THE REPOSITORY.
//
// ★★★ `readyz(deps)` takes four injected callables — pingDatabase, checkMigrations,
// readCertificate, queryTenantTimezones — and [MEAS 2026-09-12] not one of them had ever been
// written. That is what made F2 reachable: §D1 said "mount it unchanged", unchanged means
// `deps = {}`, and three of the four checks then took a pass branch. The module has been fixed
// to fail closed; this file is the other half — the probes that make it able to pass honestly.
//
// ★★ EVERY PROBE HERE READS THE REAL THING. A probe that returns a constant is worse than no
// probe: it occupies the slot where a real one would have gone, and it reports health it has not
// measured.

import { dbSsl } from "../db/ssl.mjs";
import { readFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { headObject, putObject, getObject, deleteObject, storageIsConfigured } from "../storage/s3.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ A SEPARATE, TINY POOL — AND THAT IS DELIBERATE.
//
// The readiness probe MUST NOT borrow from the application pool. Under the exact condition
// readiness exists to detect — the pool exhausted, every connection held by a slow query —
// a probe that waits for an application connection BLOCKS, the orchestrator's probe times out,
// and the symptom reported is "timeout" rather than "saturated". Worse, a probe competing for
// the last connection makes the outage it is measuring slightly worse.
// ★ max: 1, and a short connectionTimeoutMillis so "cannot get a connection" is a FAST, EXPLICIT
//   failure rather than a hang.
// ─────────────────────────────────────────────────────────────────────────────
let probePool = null;
function getProbePool() {
  if (probePool) return probePool;
  const connectionString = process.env.KEYSTONE_DATABASE_URL;
  if (!connectionString) throw new Error("KEYSTONE_DATABASE_URL is not set");
  probePool = new pg.Pool({
    connectionString,
    ssl: dbSsl(),
    max: 1,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    application_name: "keystone-health-probe",
  });
  // ★ A pool-level 'error' with no listener is an unhandled rejection that kills the process —
  //   i.e. the health probe would take down the thing it is monitoring.
  probePool.on("error", () => {});
  return probePool;
}

export async function closeProbePool() {
  if (probePool) { const p = probePool; probePool = null; await p.end().catch(() => {}); }
}

/**
 * ★ 1 · DATABASE. `SELECT 1` through a real connection.
 * ★★ It does NOT catch. `readyz` distinguishes "returned false" from "threw", and swallowing the
 * throw here would collapse the two and discard the reason, which is the only useful part.
 */
export async function pingDatabase() {
  const { rows } = await getProbePool().query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}

/**
 * ★ 2 · MIGRATIONS CURRENT — not merely "the table exists".
 * Returns { applied, pending, drift } exactly as readyz:171-175 consumes it.
 * ★★ DRIFT IS CHECKED BY CHECKSUM, the same sha256 over the file bytes that `db/migrate.mjs:50`
 * records. A replica serving traffic against a schema whose migrations were edited after they
 * were applied is a silent correctness problem — the database and the repo disagree about what
 * the schema IS, and nothing else in the system is positioned to notice.
 */
/**
 * ★ THE FILES ON DISK, HASHED. Split out of `checkMigrations()` (Stage 4 Task 11) so a caller that
 * cannot use THIS module's own probe pool — `src/health/watch.mjs`'s `systemChecks()`, which is
 * handed whichever connection its caller has (app_worker or app_rw) — can still read the same set
 * of files and compare it the same way, via `computeMigrationDrift` below.
 */
export async function readOnDiskMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const onDisk = new Map();
  for (const f of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, f), "utf8");
    onDisk.set(f.replace(/\.sql$/, ""), createHash("sha256").update(sql, "utf8").digest("hex"));
  }
  return onDisk;
}

/**
 * ★ THE COMPARISON, AS ITS OWN PURE FUNCTION — the same rule for "current" everywhere it is asked:
 * every file on disk is applied with a matching checksum, and nothing applied is missing its file.
 * `appliedRows` is `[{id, checksum}]` from whichever source the caller used to read
 * `keystone_meta.schema_migrations` (this module's own pool for readyz; a worker-safe SECURITY
 * DEFINER function, `keystone_meta.schema_migrations_health()`, for `systemChecks()`).
 */
export function computeMigrationDrift(onDisk, appliedRows) {
  const applied = new Map(appliedRows.map((r) => [r.id, r.checksum]));

  let drift = false;
  const driftIds = [];
  for (const [id, sum] of onDisk) {
    const got = applied.get(id);
    if (got !== undefined && got !== sum) { drift = true; driftIds.push(id); }
  }
  // ★ An ORPHAN — recorded applied, file gone — is drift too. migrate.mjs's `status` reports it;
  //   a readiness probe that ignored it would call a database current against a repo that cannot
  //   describe it.
  for (const id of applied.keys()) {
    if (!onDisk.has(id)) { drift = true; driftIds.push(`${id} (orphan)`); }
  }

  const pending = [...onDisk.keys()].filter((id) => !applied.has(id));
  return {
    applied: applied.size,
    pending: pending.length,
    drift,
    ...(pending.length ? { pendingIds: pending } : {}),
    ...(drift ? { driftIds } : {}),
  };
}

export async function checkMigrations() {
  const onDisk = await readOnDiskMigrations();
  const { rows } = await getProbePool().query(
    "SELECT id, checksum FROM keystone_meta.schema_migrations"
  );
  return computeMigrationDrift(onDisk, rows);
}

/**
 * ★ 3 · THE SIGNING CERTIFICATE. Just the read — `assertStartupInvariants` already owns the
 * "is it PEM, is it empty" logic and duplicating it here would be a second source of truth for
 * what a valid certificate is.
 */
export const readCertificate = (p) => readFile(p, "utf8");

/**
 * ★ 07 §5 — THE SIGNING CERTIFICATE'S EXPIRY. `assertStartupInvariants` only proves the certificate
 * is PRESENT and PEM-shaped at boot; it never parses it, so a certificate that boots fine today and
 * expires next week gives no warning until signing itself starts failing. This reads the SAME two
 * sources in the SAME precedence order (`KEYSTONE_SIGNING_CERT_PEM` preferred, `_PATH` the
 * container-external fallback) so the health check can never disagree with startup about which
 * certificate is the real one.
 * ★★ THROWS on anything unreadable or unparseable — the caller (`watch.mjs`) decides what state
 *    that becomes; this function only measures.
 */
export async function certificateHealth({ env = process.env, readCertificateImpl = readCertificate, now = () => new Date() } = {}) {
  const certPem = env.KEYSTONE_SIGNING_CERT_PEM;
  const certPath = env.KEYSTONE_SIGNING_CERT_PATH;
  let pem;
  if (certPem) {
    pem = certPem;
  } else if (certPath) {
    pem = await readCertificateImpl(certPath);
  } else {
    throw new Error("no signing certificate: neither KEYSTONE_SIGNING_CERT_PEM nor KEYSTONE_SIGNING_CERT_PATH is set");
  }
  if (typeof pem !== "string" || pem.trim().length === 0) {
    throw new Error("the signing certificate is empty");
  }
  const cert = new X509Certificate(pem);
  const validTo = new Date(cert.validTo);
  const daysRemaining = (validTo.getTime() - now().getTime()) / (24 * 3600_000);
  return { validTo, daysRemaining };
}

/**
 * ★ 4 · TENANT TIMEZONES.
 * ★★★ THIS ONE CANNOT USE `withTenant()`, AND THE REASON MATTERS. It must see EVERY tenant, and
 * `keystone.tenant` is FORCE RLS under `id = current_tenant_id()` — so from any single tenant's
 * context it would see exactly one row and report "1 tenant(s), all valid". That is the F2
 * failure shape precisely: a number that looks like a measurement and is the absence of one.
 * ★ It therefore runs on the probe pool with NO tenant context, which under RLS returns ZERO
 * rows for `app_rw` — so it is written to DETECT that and say so, rather than report zero bad
 * timezones out of zero rows it was never allowed to see.
 */
export async function queryTenantTimezones() {
  // ★★★ THROUGH THE DEFINER RESOLVER (migration 0017), NEVER `SELECT … FROM keystone.tenant`.
  //     A direct read here returns ZERO ROWS for app_rw — measured — and zero rows means zero
  //     INVALID rows, so the check would pass forever having seen nothing.
  const { rows } = await getProbePool().query(
    "SELECT id, slug, timezone FROM keystone.tenant_timezones_for_health()"
  );
  if (rows.length === 0) {
    // ★★ A POSITIVE CONTROL, INLINE. Zero rows here is ambiguous — no tenants exist, or the
    //    definer/policy pair has been broken. Both are worth refusing readiness over, and the
    //    message says which is which rather than passing on an unexamined zero. (0010's backfill
    //    guard is the same idea: "its zero means nothing".)
    throw new Error(
      "tenant timezone probe saw ZERO tenants via keystone.tenant_timezones_for_health(). " +
        "Either the platform genuinely has no tenants, or the definer resolver / " +
        "tenant_health_read policy has been altered — and a check that cannot see its subject " +
        "can never clear it."
    );
  }
  return rows;
}

/**
 * ★ 07 §5/§6 — THE WORKER'S AGE, READ BY THE APP, NOT BY THE WORKER. `GET /healthz/worker` is the
 * address the outside monitor watches (UptimeRobot), and a worker that has stopped cannot report its
 * own death — so the app reads the newest beat the worker's own SECURITY DEFINER function wrote
 * (migration 0127) on the SAME probe pool `readyz` already uses, rather than opening a second one.
 * ★★ Returns `null` on "never beat" — the caller (app.mjs) is the one that turns that into 503 "never"
 * vs 503 "stale" vs 200 "ok"; this function only measures.
 */
export async function defaultWorkerBeatAge() {
  const { rows } = await getProbePool().query(
    "SELECT extract(epoch FROM now() - max(beat_at))::int AS age FROM keystone_meta.worker_heartbeat"
  );
  return rows[0]?.age ?? null;
}

/** ★ The four, together, in the shape readyz expects. One place, so a caller cannot supply three. */
/**
 * ★ 5 · STORAGE REACHABLE — 01 default 7.
 *
 * ★★★ WHAT "REACHABLE" MEANS HERE (revised 17 Sep 2026: a bucket HEAD, and 404 is now a FAILURE — see below). The probe sends a signed HEAD for a key
 *     that is not expected to exist. A **404 is the best possible answer**: the store was reached,
 *     it authenticated the request, and it correctly reported that the object is not there. Treating
 *     404 as a failure would make this probe demand that somebody keep a magic file alive forever,
 *     and the day it was tidied away the app would refuse to deploy for no reason.
 *
 * ★★ A 403 IS A FAILURE AND IS REPORTED AS A DIFFERENT FACT. "The store refused our credentials" and
 *    "the store is unreachable" have different fixes, and collapsing them is how an afternoon gets
 *    spent restarting a healthy service. F487's own diagnosis cost time for exactly this reason: the
 *    error text said "send request failed" and named nothing.
 *
 * ★ IT WRITES NOTHING AND LISTS NOTHING. A readiness probe that PUT an object would put a file in a
 *   client's bucket on every deploy, and a LIST on a bucket holding signed instruments is a scan
 *   nobody asked for. HEAD on one key is the smallest question that has a real answer.
 *
 * ★ 5s, not the module's 20s default: a readiness probe must answer faster than the thing polling it.
 */
export async function probeStorage(opts = {}) {
  const { headObjectImpl = headObject, timeoutMs = 5_000, env = process.env } = opts;
  // ★★ THE ONE EXEMPTION, AND HOW NARROW IT IS. A developer's machine has no object store, and before
  //    17 Sep 2026 it had no storage check either — so adding this check turned every local /readyz red
  //    (EXECUTED: p12_server went from green to "503 … object storage is not configured"). A readiness
  //    check that is ALWAYS red locally teaches people to ignore it.
  //    So: in `KEYSTONE_ENVIRONMENT=local` ONLY, and ONLY when storage is NOT CONFIGURED AT ALL, the
  //    check passes and says why. It still FAILS locally if storage is configured and unreachable, and
  //    it FAILS on staging and production when unconfigured.
  //  ★★ AND A DEPLOYMENT CANNOT CLAIM `local` (Stage 2 final review C1 — the comment here used to say the
  //     startup check prevented that, and it did not: `local` skipped every check). Now BOTH hold: the startup
  //     check refuses `local` when Railway's own RAILWAY_* identifiers are present, and this exemption does not
  //     apply when they are — two independent barriers, so one being wrong again cannot reopen the hole.
  const onRailway = ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_DEPLOYMENT_ID"]
    .some((k) => typeof env[k] === "string" && env[k] !== "");
  if (env.KEYSTONE_ENVIRONMENT === "local" && !onRailway && !storageIsConfigured(env)) {
    return { ok: true, detail: "not configured — the local environment has no object store (staging and production must have one)" };
  }
  // ★★ HEAD ON THE BUCKET ITSELF (S3 HeadBucket, path-style `/<bucket>/`), NOT ON A KEY.
  //    Stage 2 final review M1: the first version HEADed a key that is meant to be absent and treated 404
  //    as a pass — but S3 answers 404 whether the KEY is missing or the WHOLE BUCKET is, so a deleted bucket
  //    read as healthy. HeadBucket answers 200 only when the bucket exists AND our credentials may use it.
  const r = await headObjectImpl({ key: "" }, { timeoutMs, env });
  if (r.ok) return { ok: true, detail: `bucket answered ${r.status}` };
  if (r.status === 404) {
    return { ok: false, detail: `the object store answered but the BUCKET does not exist (404) — ${r.error ?? ""}`.trim() };
  }
  if (r.status === 403 || r.status === 401) {
    return { ok: false, detail: `the object store REFUSED OUR CREDENTIALS (${r.status}) — it is reachable; the key or secret is wrong. ${r.error ?? ""}`.trim() };
  }
  return { ok: false, detail: r.error ?? `HEAD answered ${r.status}` };
}

/**
 * ★ 07 §5 — STORAGE, WRITE/READ (not the HEAD `probeStorage` above uses for `/readyz`).
 *
 * ★★★ WHY THIS ONE WRITES WHEN `probeStorage` DELIBERATELY DOES NOT. `probeStorage` HEADs the
 * bucket: it proves the store is reachable and our credentials work, and 07's own comment there
 * explains why a readiness probe should never write. But F491 [MEASURED] is a real 5 GB ceiling on
 * this SeaweedFS volume, and a bucket that is reachable and authenticates fine can still REFUSE A
 * WRITE the moment its volumes are full — "volume grow request failed: only 1 volumes left, not
 * enough for 2". A HEAD would answer 200 through that exact failure and report the store healthy
 * while every new upload was failing. §5 asks for write/read specifically because that is the one
 * question a HEAD cannot answer.
 * ★★ NET STORAGE EFFECT ~ZERO. One FIXED key (`_platform_health/probe`), overwritten every run and
 *    deleted at the end — never a new key per call, so a run whose delete fails leaves at most one
 *    small object behind for the NEXT run to overwrite, not an accumulating litter pile.
 * ★ Verifies the round trip by content (sha256), not merely that GET returned 200 — a store that
 *   accepts a PUT and later serves back the WRONG bytes is a worse failure than one that refuses
 *   outright, and a status-code-only check would call that "ok".
 */
export async function probeStorageReadWrite(opts = {}) {
  const { putObjectImpl = putObject, getObjectImpl = getObject, deleteObjectImpl = deleteObject,
          timeoutMs = 5_000, env = process.env } = opts;
  const key = "_platform_health/probe";
  const body = Buffer.from(`keystone health probe ${new Date().toISOString()} ${Math.random()}`);

  const put = await putObjectImpl({ key, body, contentType: "text/plain" }, { timeoutMs, env });
  if (!put.ok) {
    return { ok: false, detail: `WRITE failed (status ${put.status ?? "?"}) — ${put.error ?? "no further detail"}`.trim() };
  }
  const got = await getObjectImpl({ key }, { timeoutMs, env });
  if (!got.ok) {
    return { ok: false, detail: `wrote the probe object but the READ back failed (status ${got.status ?? "?"}) — ${got.error ?? "no further detail"}`.trim() };
  }
  if (got.sha256 !== put.sha256) {
    return { ok: false, detail: "wrote the probe object and read one back, but the CONTENT DIFFERED — the store served the wrong bytes" };
  }
  const del = await deleteObjectImpl({ key }, { timeoutMs, env });
  if (!del.ok) {
    // ★ The write and read both succeeded — the store itself is healthy. A failed cleanup is not
    //   reported as a health problem (the next run's PUT overwrites the same key regardless), but
    //   it is named so it does not vanish silently.
    return { ok: true, detail: `write and read both succeeded; could not delete the probe object afterward (status ${del.status ?? "?"}) — harmless, the next probe overwrites the same key` };
  }
  return { ok: true, detail: "wrote, read back byte-for-byte, and deleted a probe object" };
}

export const healthDeps = () => ({
  pingDatabase,
  checkMigrations,
  readCertificate,
  queryTenantTimezones,
  probeStorage,
});
