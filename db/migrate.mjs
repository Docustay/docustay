#!/usr/bin/env node
// P1.4 — MIGRATION RUNNER.
//
// Design rules, each with a reason:
//
// ★ RUNS AS app_owner, NEVER as the application role. The runner connects with the superuser
//   credential and immediately `SET ROLE app_owner`, so every object it creates is owned by
//   app_owner. If migrations ran as app_rw, app_rw would own the tables — and a table owner
//   bypasses `ENABLE ROW LEVEL SECURITY`, which would make the entire isolation boundary inert
//   while every policy still looked correct.
//
// ★ ONE TRANSACTION PER MIGRATION. A half-applied migration is worse than a failed one: it
//   leaves a schema no version number describes.
//
// ★ EXPAND / CONTRACT. Schema changes ship in two migrations, never one:
//     EXPAND   — add the new thing, keep the old. Safe with old code still running.
//     CONTRACT — remove the old thing. Only after every deploy is on the new code.
//   A rename done in a single migration breaks every instance of the previous release that is
//   still serving traffic during the rollout.
//
// ★ ONE-WAY MIGRATIONS ARE MARKED AND REFUSED BY DEFAULT. A migration whose header says
//   `-- keystone:one-way` destroys information (drops a column, deletes rows, narrows a type).
//   It cannot be undone by restoring a backup taken after it ran. The runner refuses to apply
//   one unless KEYSTONE_ALLOW_ONE_WAY=yes is set for that specific run, so it can never be
//   applied by accident as part of a routine `npm run migrate`.
//
// ★ CHECKSUMS. An already-applied migration whose file has since changed is an ERROR, not a
//   no-op. Editing an applied migration means the database and the repo disagree about what
//   the schema is, and the runner is the only thing positioned to notice.

import { dbSsl } from "../src/db/ssl.mjs";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const TARGET_URL = process.env.KEYSTONE_DATABASE_URL;
if (!TARGET_URL) {
  // ★ Fail loud. Never a default, never a fallback connection string — a migration runner that
  // silently picks a different database than intended is a catastrophe with a friendly log line.
  console.error("FATAL: KEYSTONE_DATABASE_URL is not set. Refusing to guess a database.");
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHICH DATABASE IS DECIDED BY `KEYSTONE_DATABASE_URL`, ALONE AND ALWAYS. WHICH *CREDENTIAL*
//     CAN BE THE SUPERUSER ONE FOR THAT SAME DATABASE. [FINDINGS F537]
//
//   THE DEFECT. Everything below this line needs a connection that can `SET ROLE app_owner` (:103,
//   and again per file in `up()`). Every caller that works today supplies one by OVERRIDING
//   `KEYSTONE_DATABASE_URL` by hand with a superuser url:
//     · `scripts/prepare-fresh-database.mjs:115-118` — "Every subprocess this script spawns gets
//       the SAME superuser URL as KEYSTONE_DATABASE_URL … it is never the app_rw connection";
//     · the production step, `specs/00-foundations/plans/01-stage-1-safety-net-and-staging.md:970` —
//       `KEYSTONE_DATABASE_URL="$KEYSTONE_DEPLOYED_SUPERUSER_PG_URL" … node db/migrate.mjs status`.
//   NOTHING supplies it under the plain house workflow (`set -a; source .env.local; set +a`), where
//   `KEYSTONE_DATABASE_URL` is the APPLICATION's own `app_rw` — so the house command died with
//   `FATAL: permission denied to set role "app_owner"` and nobody could migrate their own local
//   database copy. The convention was real; it just lived only in other files' heads.
//
// ★★★ THE FIX IS NOT A GRANT. `app_rw` is deliberately NOT a member of `app_owner`
//     (`scripts/bootstrap-roles.mjs:264-273`, `REQUIRED_MEMBERSHIPS` — two entries, both
//     `app_owner → …`, neither of them this). Granting it would let the application's own
//     connection assume the role that OWNS every table, and a table owner bypasses
//     `ENABLE ROW LEVEL SECURITY` — the entire isolation boundary goes inert while every policy
//     still reads correctly. That is the exact failure this runner's header exists to prevent.
//
// ★★ SO: if `KEYSTONE_ADMIN_URL` names the SAME host, port and database, it is by definition the
//    superuser credential FOR THE DATABASE WE WERE ALREADY POINTED AT, and the runner uses it.
//    Any other `KEYSTONE_ADMIN_URL` is ignored completely.
// ★★★ THE SAME-DATABASE TEST IS THE WHOLE SAFETY PROPERTY, AND THE RISK IT CLOSES IS LIVE: the
//     production step above runs from a shell that has ALREADY sourced `.env.local`, so a LOCAL
//     `KEYSTONE_ADMIN_URL` is sitting in the environment while `KEYSTONE_DATABASE_URL` points at
//     the deployed database. A bare `?? KEYSTONE_ADMIN_URL` fallback would have quietly migrated
//     the developer's laptop instead of production and printed a success line. The credential may
//     change; the database never does. (`test/f537_migrate_local_superuser.test.mjs` asserts both
//     directions of that, and that `app_rw` never gained the membership.)
// ★ Inert where it does not apply: `KEYSTONE_ADMIN_URL` is set on no deployed service — it is a
//   scripts/gates-only variable (`specs/00-foundations/01-system-map.md:174-180`, MEASURED on
//   Railway) — and `prepare-fresh-database.mjs`'s scratch databases never share a name with it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function describeTarget(url) {
  // ★ Names only, never the credential: user, host, port, database — the same four facts the rest
  //   of this project prints about a connection string, and nothing else from it.
  try {
    const u = new URL(url);
    return `${u.username || "(no user)"}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

function sameDatabase(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const port = (u) => u.port || "5432";
    const name = (u) => decodeURIComponent(u.pathname.replace(/^\//, ""));
    return (
      x.hostname.toLowerCase() === y.hostname.toLowerCase() &&
      port(x) === port(y) &&
      name(x) === name(y) &&
      name(x) !== ""
    );
  } catch {
    // ★ A url this runner cannot even parse is never treated as "the same database".
    return false;
  }
}

const ADMIN_URL = process.env.KEYSTONE_ADMIN_URL;
const USE_ADMIN = Boolean(ADMIN_URL) && ADMIN_URL !== TARGET_URL && sameDatabase(ADMIN_URL, TARGET_URL);
const DATABASE_URL = USE_ADMIN ? ADMIN_URL : TARGET_URL;
const DATABASE_URL_VAR = USE_ADMIN ? "KEYSTONE_ADMIN_URL" : "KEYSTONE_DATABASE_URL";

const ALLOW_ONE_WAY = process.env.KEYSTONE_ALLOW_ONE_WAY === "yes";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function loadMigrations() {
  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic; filenames are zero-padded so this is numeric order
  const out = [];
  for (const file of entries) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const oneWay = /^--\s*keystone:one-way\b/m.test(sql);
    const id = file.replace(/\.sql$/, "");
    if (!/^\d{4}_/.test(id)) {
      throw new Error(`Migration "${file}" must be named NNNN_description.sql`);
    }
    out.push({ id, file, sql, checksum: sha256(sql), oneWay });
  }
  return out;
}

async function ensureRegistry(client) {
  // The registry lives in its own schema so a `DROP SCHEMA keystone CASCADE` during development
  // cannot take the migration history with it.
  await client.query(`CREATE SCHEMA IF NOT EXISTS keystone_meta AUTHORIZATION app_owner`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS keystone_meta.schema_migrations (
      id           text        PRIMARY KEY,
      checksum     text        NOT NULL,
      one_way      boolean     NOT NULL DEFAULT false,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      applied_by   text        NOT NULL DEFAULT current_user,
      duration_ms  integer     NOT NULL
    )
  `);
}

async function connect() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: dbSsl(), // Railway's TCP proxy terminates with its own cert
    application_name: "keystone-migrate",
  });
  // ★★★ SURFACE EVERY SERVER NOTICE. [Stage 4 Task 14 Phase C] Several migrations report what they
  //     actually did to existing rows by `RAISE NOTICE` — 0164's cutover reports how many jobs it
  //     moved and how many it left behind, by task name. node-postgres DROPS a notice on the floor
  //     unless something is listening, so before this line the runner applied those migrations and
  //     printed nothing, and the only record of what a backfill touched in production was gone the
  //     moment it committed. Print-only: it changes no statement, no ordering and no result.
  client.on("notice", (n) => {
    const text = (n?.message ?? String(n)).replace(/\n/g, "\n      ");
    console.log(`      [${n?.severity ?? "NOTICE"}] ${text}`);
  });
  await client.connect();
  // ★ SAY WHICH DATABASE AND WHICH CREDENTIAL, EVERY RUN. [F537] The runner can now take its
  //   credential from either of two variables, so "which one did it use, against what" stops being
  //   something a reader has to reconstruct from the environment. Names only — never the password.
  console.log(`connection: ${DATABASE_URL_VAR} → ${describeTarget(DATABASE_URL)}`);
  // ★ Everything after this line runs as app_owner, not as the connecting superuser.
  try {
    await client.query("SET ROLE app_owner");
  } catch (err) {
    // ★★ THE ASSERTION IS UNCHANGED — this only says WHY, in the words of F537, instead of leaving
    //    the next person to rediscover it. The role is still required; nothing is skipped.
    if (err?.code === "42501") {
      err.message =
        `${err.message}\n` +
        `  The connection came from ${DATABASE_URL_VAR} (${describeTarget(DATABASE_URL)}), and that role cannot\n` +
        `  SET ROLE app_owner. The migration runner needs the database's SUPERUSER connection — locally that is\n` +
        `  KEYSTONE_ADMIN_URL, which must name the SAME host, port and database as KEYSTONE_DATABASE_URL.\n` +
        `  Do NOT grant the application role membership in app_owner: a table owner bypasses ROW LEVEL SECURITY.`;
    }
    throw err;
  }
  const { rows } = await client.query("select current_user, session_user");
  if (rows[0].current_user !== "app_owner") {
    throw new Error(`SET ROLE app_owner did not take effect (current_user=${rows[0].current_user})`);
  }
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A DETERMINISTIC search_path, SO A MIGRATION MEANS THE SAME THING ON EVERY DATABASE.
  //     [MEASURED 2026-09-15] `0091_functions_read_archived_at` applied cleanly LOCALLY for weeks and
  //     failed on the deployed database with **`type document_instance does not exist`** — on a
  //     database where `keystone.document_instance` demonstrably EXISTS. The difference was never the
  //     schema; it was the connection:
  //         local     search_path = keystone, public      → the bare type resolves
  //         deployed  search_path = "$user", public       → it does not
  //     `0091:24` declares `FUNCTION keystone.document_is_visible(p_instance document_instance)` — the
  //     function NAME is qualified, the PARAMETER TYPE is not.
  //   ★★★ THE REAL DEFECT IS THE DEPENDENCE, NOT THE ONE BARE WORD. A migration whose meaning is
  //       decided by a role's default search_path is a migration that passes where it was written and
  //       fails where it matters — and it fails LATE, after 27 of its siblings have already applied.
  //   ★★ FIXED HERE RATHER THAN IN 0091 BECAUSE THE RUNNER CHECKSUMS EVERY FILE (`:117`). Editing an
  //      applied migration turns every local database into a checksum mismatch; setting the session's
  //      search_path changes no file, no checksum, and no already-applied result.
  //   ★ [SWEPT] exactly ONE bare type reference exists across all 103 migrations, so this makes the
  //     chain deterministic rather than papering over a habit.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  await client.query("SET search_path = keystone, public");
  return client;
}

async function status() {
  const client = await connect();
  try {
    await ensureRegistry(client);
    const files = await loadMigrations();
    const { rows } = await client.query(
      "select id, checksum, one_way, applied_at from keystone_meta.schema_migrations"
    );
    const applied = new Map(rows.map((r) => [r.id, r]));
    console.log(`migrations dir: ${MIGRATIONS_DIR}`);
    console.log(`${files.length} file(s), ${applied.size} applied\n`);
    let drift = 0;
    for (const m of files) {
      const a = applied.get(m.id);
      if (!a) {
        console.log(`  PENDING   ${m.id}${m.oneWay ? "   [ONE-WAY]" : ""}`);
      } else if (a.checksum !== m.checksum) {
        console.log(`  ★ DRIFT   ${m.id}  — applied checksum does not match the file on disk`);
        drift++;
      } else {
        console.log(`  applied   ${m.id}  ${a.applied_at.toISOString()}`);
      }
    }
    for (const [id] of applied) {
      if (!files.find((f) => f.id === id)) {
        console.log(`  ★ ORPHAN  ${id}  — recorded as applied but the file is gone`);
        drift++;
      }
    }
    return drift;
  } finally {
    await client.end();
  }
}

/**
 * ★★★ STRIPE MIRROR PREPARATION — runs BEFORE the platform's own migration loop (specs/STRIPE-MIRROR.md
 *     §4 stage (e)). Moved from after the loop because the "effective" money views SELECT from
 *     `stripe.*` at CREATE time: on a fresh database the schema must already exist and `app_owner`
 *     (the role every migration runs as) must already be able to read it.
 *     Also creates the two inert NOLOGIN roles this feature needs — this function runs on the
 *     connecting SUPERUSER credential (app_owner has no CREATEROLE, see 0044's header): `postgres`
 *     (the sync engine's migration 0012 does `ALTER FUNCTION ... OWNER TO postgres`) and
 *     `app_stripe_mirror` (migration 0572's read role). Idempotent; ends back as app_owner.
 */
async function prepareStripeMirror(client) {
  await client.query("RESET ROLE");
  await client.query(`
    DO $do$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_stripe_mirror') THEN CREATE ROLE app_stripe_mirror NOLOGIN; END IF;
    END $do$`);
  await client.query("GRANT app_stripe_mirror TO app_rw");
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ STRIPE MIRROR — specs/STRIPE-MIRROR.md §3.1/§3.6. `@supabase/stripe-sync-engine`'s own
  //     `runMigrations` manages ITS OWN migration set (43 files, its own internal tracking
  //     table inside the `stripe` schema) — deliberately NOT folded into the platform's own numbered
  //     `db/migrations/*.sql` + `keystone_meta.schema_migrations` tracking above. Running it here,
  //     right after the platform's own migrations, is what makes it "the same deploy step" (the maintainer's own
  //     design requirement) without adding a second Railway pre-deploy command. Uses `DATABASE_URL`
  //     — the SAME elevated connection `client` above already used, not `TARGET_URL`. [MEASURED
  //     locally: `TARGET_URL` (=`KEYSTONE_DATABASE_URL`, `app_rw`) hit `permission denied for
  //     database keystone` on `CREATE SCHEMA IF NOT EXISTS stripe` — app_rw has no CREATE on the
  //     database at all, only DML on specific tables (migration 0001's header). `DATABASE_URL` is
  //     `KEYSTONE_ADMIN_URL` when present and same-database (:115), else falls back to the same
  //     `TARGET_URL` — identical resolution `client` itself already trusted two lines up. No new
  //     secret, no new credential surface: this is the connection the runner was already using.
  //     The `stripe` schema is still NEVER granted to `app_rw` (§3.4) — only to `app_stripe_mirror`,
  //     below — so this additive step changes nothing about the platform's own RLS isolation boundary.
  //
  // ★★★ LOADED VIA `createRequire`, NOT `await import`. [MEASURED — this is the actual bug
  //     that failed the first real deploy of this migration] the package's own ESM build
  //     (`dist/index.js`, what `import()` resolves to via its `"import"` export condition) calls
  //     `path.resolve(__dirname, "./migrations")` inside `runMigrations` — but `__dirname` does
  //     not exist in a real ES module, so under Node 22 (this project's pinned runtime,
  //     Dockerfile) that line throws `__dirname is not defined`, caught by `runMigrations`'s own
  //     try/catch and (before this fix) reported to this file's logger — PRE_DEPLOY_COMMAND
  //     failure on the real keystone-app deploy, 2 Oct 2026, confirmed via Railway's own
  //     deployment logs. The CJS build (`dist/index.cjs`, the `"require"` condition) has the
  //     IDENTICAL line, but Node supplies a real, correct `__dirname` for an actual CommonJS
  //     file regardless of how it's loaded — no bug there. `createRequire` forces that path.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { runMigrations: runStripeMirrorMigrations } = createRequire(import.meta.url)("@supabase/stripe-sync-engine");
  let stripeMirrorMigrationError = null;
  await runStripeMirrorMigrations({
    schema: "stripe",
    databaseUrl: DATABASE_URL,
    logger: {
      // ★★★ [MEASURED] the library's own `runMigrations` SWALLOWS every error when no logger is
      //     passed (`catch (err) { config.logger?.error(...) }`, never rethrown) — it reported
      //     "success" on an actual `permission denied for database keystone` failure. A logger
      //     alone does not fix that — `runMigrations` itself still returns normally either way —
      //     so the error is captured here and thrown below, or this hook would keep silently
      //     no-op'ing on every future failure exactly like the swallowed one just found.
      info: () => {},
      debug: () => {},
      error: (err) => { stripeMirrorMigrationError = err; },
    },
  });
  if (stripeMirrorMigrationError) {
    throw new Error(
      `stripe mirror migrations failed: ${stripeMirrorMigrationError?.message ?? stripeMirrorMigrationError}`);
  }
  console.log("stripe mirror schema: migrations applied");

  // ★★★ migration 0572 creates `app_stripe_mirror` (a NOLOGIN role `app_rw` is a member of) but
  //     cannot GRANT anything ON the `stripe` schema itself — that schema did not exist yet when
  //     0572 ran. It exists now, one line above. Re-run every deploy: GRANT is idempotent, and
  //     ALTER DEFAULT PRIVILEGES covers any table a future sync-engine version adds without this
  //     file needing to change again.
  // ★★★ `RESET ROLE` FIRST. [MEASURED — the second real deploy attempt's own failure] `client`
  //     has carried `SET ROLE app_owner` (:180) since before the main migration loop, and
  //     `app_owner` does not own the `stripe` schema — the sync engine's own `runMigrations`
  //     connects fresh, as the raw superuser `DATABASE_URL` authenticates as, never switching
  //     role. `GRANT ... ON SCHEMA stripe` under `app_owner` failed with `permission denied for
  //     schema stripe`. This is the last thing this file does before `client.end()` — no later
  //     code depends on the role still being `app_owner`, so resetting here is safe.
  await client.query(`GRANT USAGE ON SCHEMA stripe TO app_stripe_mirror`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA stripe TO app_stripe_mirror`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA stripe GRANT SELECT ON TABLES TO app_stripe_mirror`);
  console.log("stripe mirror schema: app_stripe_mirror granted SELECT");

  // ★★★ A NAMED, DELIBERATE GAP — NOT THE FULL WALL §3.4 DESCRIBES, AND SAID SO AT THE TIME.
  //     `StripeSync`'s own internal `pg.Pool` (src/money/stripeMirror.mjs#getStripeSync) connects
  //     using `KEYSTONE_DATABASE_URL` directly — the SAME `app_rw` login the request pool uses —
  //     because the library takes one `poolConfig` and manages its own connections internally;
  //     there is no per-query `SET ROLE` hook to give it `app_stripe_mirror` the way
  //     `withStripeMirrorConnection` gives `queryMirror` for READS. So `processWebhook`/
  //     `syncBackfill` cannot write a single row to `stripe.*` without `app_rw` itself holding
  //     real DML there — confirmed [MEASURED locally]: with only `app_stripe_mirror` granted,
  //     `getStripeSync().syncBackfill({object:'customer'})` failed `permission denied for schema
  //     stripe` under `app_rw`. §3.4's own words — "never granted to app_rw AT ALL" — describe
  //     the full plan the maintainer named as explicit "later" work; THIS is the minimum needed to make the
  //     sync engine function at all today. It does narrow what "never" means versus that
  //     sentence: `app_rw` gets DML (not SELECT — reads still go through `app_stripe_mirror`
  //     only, so `queryMirror`'s own discipline is unchanged) on this one schema, available to
  //     ANY tenant-scoped code that chooses to query it directly, not just the two sanctioned
  //     entry points in `stripeMirror.mjs`. Giving the sync engine its own separate login
  //     credential would close this properly; that is real new secret-management surface and is
  //     the deferred work §3.4 already named, now scoped precisely instead of left vague.
  await client.query(`GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stripe TO app_rw`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA stripe GRANT INSERT, UPDATE, DELETE ON TABLES TO app_rw`);
  console.log("stripe mirror schema: app_rw granted DML (sync engine's own writes)");

  // ★★★ AND SELECT, TOO — stage (c)'s own architecture forced this, not preference. The Money
  //     list screens (src/records/lists/money.mjs) run ONE plain SQL string, through the SAME
  //     tenant-scoped `app_rw` connection `withTenant` already opened for the request — there is
  //     no second connection or role-switch available mid-query the way `queryMirror` gives a
  //     one-off read its own `SET ROLE app_stripe_mirror`. Repointing `/money/invoices`'s own
  //     SQL to JOIN `stripe.invoices` for status/amount (§4 stage (c)) needed `app_rw` to be able
  //     to SELECT there directly, in the same query, or the join cannot happen at all. Combined
  //     with the DML grant just above, `app_rw` now has everything `app_stripe_mirror` has and
  //     more — at this point the SELECT-only role is no longer the only way in, and §3.4's "never
  //     granted to app_rw AT ALL" no longer holds in any real sense. Recorded as exactly that,
  //     not left implied: the full wall (sync engine + mirror reads on a role `app_rw` itself
  //     cannot reach) is real, the maintainer-named "later" work, not something this pass built.
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA stripe TO app_rw`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA stripe GRANT SELECT ON TABLES TO app_rw`);
  console.log("stripe mirror schema: app_rw granted SELECT (list-screen joins)");

  // ★ app_owner (every migration's role) must be able to create views over the mirror.
  await client.query(`GRANT USAGE ON SCHEMA stripe TO app_owner`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA stripe TO app_owner`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA stripe GRANT SELECT ON TABLES TO app_owner`);
  await splitStripeSyncLogin(client);
  await client.query("SET ROLE app_owner");
}

/**
 * ★★★ THE STRIPE LOGIN SPLIT (part 28, item 7). The sync engine writes the mirror on its OWN login, `app_stripe_sync`, so the application's login (`app_rw`) never needs a privilege on `stripe.*`.
 *   · Needs KEYSTONE_STRIPE_SYNC_PASSWORD in this process's environment (the pre-deploy command's); without it nothing here runs and the database keeps today's grants (a fresh self-hosted install).
 *   · The password never appears in SQL text or output: it travels as a bound parameter into `format('%L')`.
 *   · Step 1 (always, when the password is set): create/alter the login, give it CONNECT, USAGE on `stripe` and SELECT/INSERT/UPDATE/DELETE on its tables (+ the default privileges, for tables the engine adds later).
 *   · Step 2 (only when KEYSTONE_STRIPE_SYNC_SPLIT=enforce, set AFTER a deploy whose code already uses the new login): `app_rw` loses EVERY privilege on `stripe.*` and its default privileges.
 *     `app_stripe_mirror` keeps SELECT (queryMirror); the money views now run as their owner (migration 0629).
 */
async function splitStripeSyncLogin(client) {
  const password = process.env.KEYSTONE_STRIPE_SYNC_PASSWORD;
  if (!password) { console.log("stripe sync login: KEYSTONE_STRIPE_SYNC_PASSWORD not set — grants left as they are"); return; }
  const { rows: [{ verb }] } = await client.query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_stripe_sync') THEN 'ALTER' ELSE 'CREATE' END AS verb`);
  const { rows: [{ ddl }] } = await client.query(
    `SELECT format('%s ROLE app_stripe_sync LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER INHERIT PASSWORD %L', $1::text, $2::text) AS ddl`, [verb, password]);
  await client.query(ddl);
  await client.query(`DO $do$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_stripe_sync', current_database()); END $do$`);
  await client.query(`GRANT USAGE, CREATE ON SCHEMA stripe TO app_stripe_sync`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stripe TO app_stripe_sync`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA stripe TO app_stripe_sync`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA stripe GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_stripe_sync`);
  console.log("stripe sync login: app_stripe_sync ready");
  if (process.env.KEYSTONE_STRIPE_SYNC_SPLIT === "enforce") {
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA stripe FROM app_rw`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA stripe FROM app_rw`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA stripe REVOKE ALL ON TABLES FROM app_rw`);
    await client.query(`REVOKE ALL ON SCHEMA stripe FROM app_rw`);
    // ★ `app_rw` is a MEMBER of `app_stripe_mirror` (SELECT on everything in `stripe`) and, by default, INHERITS its privileges — so the revokes above would change nothing. Membership stays (queryMirror does SET ROLE),
    //   but without inheritance: the application login can only reach the mirror by the explicit, audited SET ROLE. (PostgreSQL 16+.)
    await client.query(`GRANT app_stripe_mirror TO app_rw WITH INHERIT FALSE, SET TRUE`);
    console.log("stripe sync login: ENFORCED — app_rw holds nothing on stripe.*");
  }
}

async function up(toId) {
  const client = await connect();
  let appliedCount = 0;
  try {
    await ensureRegistry(client);
    await prepareStripeMirror(client);
    const files = await loadMigrations();
    const { rows } = await client.query(
      "select id, checksum from keystone_meta.schema_migrations"
    );
    const applied = new Map(rows.map((r) => [r.id, r.checksum]));

    // ★ Drift check BEFORE applying anything, against EVERY file on disk — `--to` bounds which
    // migrations get APPLIED this run, never which ones get checked for a changed checksum.
    for (const m of files) {
      const prev = applied.get(m.id);
      if (prev !== undefined && prev !== m.checksum) {
        throw new Error(
          `Migration ${m.id} has already been applied but its file has CHANGED.\n` +
            `  applied checksum: ${prev}\n  file checksum:    ${m.checksum}\n` +
            `An applied migration is immutable. Write a NEW migration instead.`
        );
      }
    }

    // ★ `--to <NNNN>` stops after that migration number — e.g. Stage 1 Task 8's
    // `prepare-fresh-database.mjs` needs 0001-0009 applied, THEN a fixture seeded for 0010's
    // positive control, THEN the rest. Bounds application only; the drift check above already
    // ran against the full file list regardless of this.
    const toApply = toId ? files.filter((m) => m.id.slice(0, 4) <= toId) : files;
    if (toId) {
      console.log(`(--to ${toId}: applying up to and including that migration number only)`);
    }

    for (const m of toApply) {
      if (applied.has(m.id)) continue;

      if (m.oneWay && !ALLOW_ONE_WAY) {
        console.error(
          `\n★ REFUSING to apply ${m.id} — it is marked \`-- keystone:one-way\`.\n` +
            `  A one-way migration destroys information and cannot be undone by restoring a\n` +
            `  backup taken after it ran. Re-run with KEYSTONE_ALLOW_ONE_WAY=yes if that is\n` +
            `  genuinely intended, and take a dump first.\n`
        );
        process.exit(2);
      }

      // ★★★ RESTORE app_owner BEFORE EVERY FILE, NOT ONLY ONCE AT connect(). [Stage 1 Task 8
      //     FINDING, fixed here rather than worked around in a test.] Several already-applied
      //     migrations (0044, 0045, 0046, 0047, 0048, 0049, 0050, 0051, 0063, 0096, 0097, 0101,
      //     0102, 0103, 0124, 0125 — the full list, `grep -ln "^RESET ROLE" db/migrations/*.sql`)
      //     each end with a bare, SESSION-LEVEL `RESET ROLE;` — not
      //     `SET LOCAL ROLE app_owner;`, not scoped to their own transaction — and never restore
      //     app_owner afterward. `RESET ROLE` lands on SESSION_USER (the connecting superuser),
      //     and because `up()` holds ONE continuous connection across every pending migration,
      //     that drift used to survive every later migration's own COMMIT: on a genuinely fresh
      //     database, applying everything in one run left every object created from migration
      //     0065 onward OWNED BY THE SUPERUSER instead of app_owner, invisible until a much later
      //     migration's ownership-dependent statement failed. It was never seen before because
      //     this project has always applied migrations across many SEPARATE `up` invocations —
      //     each one's fresh `connect()` (:92-96) re-established app_owner and masked the
      //     previous invocation's drift. The exact same check connect() does once is repeated
      //     here, per file, so ONE continuous run gets the same guarantee.
      await client.query("SET ROLE app_owner");
      const { rows: roleCheck } = await client.query("select current_user");
      if (roleCheck[0].current_user !== "app_owner") {
        throw new Error(
          `SET ROLE app_owner did not take effect before ${m.id} (current_user=${roleCheck[0].current_user})`
        );
      }

      process.stdout.write(`  applying ${m.id}${m.oneWay ? " [ONE-WAY]" : ""} ... `);
      const started = Date.now();
      // ★ SANDBOX (QUEUE §12.1): a few migrations are DATA FIXES for production's own rows (a real client's invoices,
      //   exact Stripe ids) and RAISE on any database that does not hold them. A sandbox marks those — and only those,
      //   by id — as applied WITHOUT running them. Refused in production, whatever the variable says.
      const ledgerOnly = (process.env.KEYSTONE_ENVIRONMENT !== "production")
        && (process.env.KEYSTONE_MIGRATE_LEDGER_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(m.id.slice(0, 4));
      try {
        await client.query("BEGIN");
        if (ledgerOnly) process.stdout.write("(LEDGER ONLY — sandbox skip) ");
        else await client.query(m.sql);
        const ms = Date.now() - started;
        await client.query(
          `INSERT INTO keystone_meta.schema_migrations (id, checksum, one_way, duration_ms)
           VALUES ($1,$2,$3,$4)`,
          [m.id, m.checksum, m.oneWay, ms]
        );
        await client.query("COMMIT");
        console.log(`ok (${ms}ms)`);
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        console.error(`\n${m.id} failed and was rolled back:\n  ${err.message}\n`);
        throw err;
      }
    }
    console.log(appliedCount === 0 ? "\nnothing to apply" : `\napplied ${appliedCount} migration(s)`);

  } finally {
    await client.end();
  }
}

function parseToArg(argv) {
  const idx = argv.indexOf("--to");
  if (idx === -1) return null;
  const raw = argv[idx + 1];
  if (!raw) throw new Error("--to requires a migration number, e.g. --to 0009");
  const padded = raw.padStart(4, "0");
  if (!/^\d{4}$/.test(padded)) {
    throw new Error(`--to value "${raw}" is not a migration number (e.g. 9 or 0009)`);
  }
  return padded;
}

const cmd = process.argv[2] || "status";
try {
  if (cmd === "up") await up(parseToArg(process.argv));
  else if (cmd === "status") {
    const drift = await status();
    if (drift > 0) process.exit(1);
  } else {
    console.error(`unknown command: ${cmd} (use: up | status)`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
}
