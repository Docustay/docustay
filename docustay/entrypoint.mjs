#!/usr/bin/env node
// docustay/entrypoint.mjs — what a self-hosted container does before it serves: `node docustay/entrypoint.mjs app` or `... worker`.
//   `node docustay/entrypoint.mjs run <script> [args]` runs one of the install's own scripts (for example scripts/replay-deletions.mjs) with the SAME environment the app gets (database roles, master key, storage), then exits.
//   A plain `docker compose exec app node scripts/…` does not have that environment: the entrypoint builds it for its child process only.
//   1 · wait for Postgres (the superuser URL is the install's own, from .env)
//   2 · a brand-new database gets its roles and its schema (scripts/bootstrap-roles.mjs + scripts/prepare-fresh-database.mjs); an existing one gets only the migrations it has not had (db/migrate.mjs up) — an upgrade
//   3 · the PDF-sealing certificate is generated ONCE on first run and kept in the data volume (never in the image, never anything of ours)
//   4 · start the app (or the worker) with the environment filled in from those pieces
// NOTHING of ours is inside: no API key, no certificate, no password. Every secret is generated on this install's first run (docustay/init.sh) or supplied by the owner in .env.
import { spawnSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const role = process.argv[2];
if (!["app", "worker", "run"].includes(role)) { console.error("usage: entrypoint.mjs app|worker|run <script> [args]"); process.exit(2); }
if (role === "run" && !/^scripts\/[A-Za-z0-9_.-]+\.mjs$/.test(process.argv[3] ?? "")) { console.error("usage: entrypoint.mjs run scripts/<name>.mjs [args]"); process.exit(2); }
const env = process.env;
const need = (n) => { if (!env[n]) { console.error(`FATAL: ${n} is not set. Run ./init.sh once to create .env, or copy .env.example to .env and fill it in.`); process.exit(1); } return env[n]; };
const SUPER = need("KEYSTONE_DB_SUPERUSER_URL");
const DBPASS = need("KEYSTONE_DB_PASSWORD");
const DATA = env.KEYSTONE_DATA_DIR || "/data";
const ROLES = ["app_owner", "app_rw", "auth_owner", "app_signup", "app_worker", "app_embed"];
// each role's password is derived from the install's one DB password, so the app and the worker agree without sharing a file
const pw = (r) => createHash("sha256").update(`${DBPASS}:${r}`).digest("hex").slice(0, 40);
const withRole = (r) => { const u = new URL(SUPER); u.username = r; u.password = pw(r); return u.toString(); };
const sh = (args, extra = {}) => spawnSync("node", args, { stdio: "inherit", env: { ...env, ...extra } });

// R13-D276: a wrong password is not "still starting". The database keeps the password it was first created with (in the dbdata volume), so a new .env (a fresh clone, init.sh run again
// after deleting .env) against an old volume can never connect; say so at once instead of waiting two minutes and naming no cause. Any other failure keeps waiting, and the last error is printed.
async function waitForDb() {
  let last = null;
  for (let i = 0; i < 60; i += 1) {
    const c = new pg.Client({ connectionString: SUPER, ssl: env.KEYSTONE_DB_SSL === "off" ? false : { rejectUnauthorized: false } });
    try { await c.connect(); await c.query("select 1"); await c.end(); return; } catch (e) {
      await c.end().catch(() => {}); last = e;
      if (e?.code === "28P01") {
        console.error("FATAL: the database refused the password in .env. Its data was created by an earlier install with a different KEYSTONE_DB_PASSWORD.\n" +
          "  Keep that data: put the earlier .env back (it holds the password), then `docker compose up -d` again.\n" +
          "  Start fresh instead (this ERASES every document in it): `docker compose down -v`, then `docker compose up -d`.");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error(`FATAL: Postgres did not answer at KEYSTONE_DB_SUPERUSER_URL after 2 minutes (last error: ${last?.message ?? "none"}). Check \`docker compose logs db\`.`); process.exit(1);
}

async function prepareDatabase() {
  const c = new pg.Client({ connectionString: SUPER, ssl: env.KEYSTONE_DB_SSL === "off" ? false : { rejectUnauthorized: false } });
  await c.connect();
  const fresh = (await c.query("SELECT 1 FROM pg_namespace WHERE nspname = 'keystone'")).rows.length === 0;
  await c.end();
  const ledgerOnly = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "selfhost/production-data-migrations.txt"), "utf8").split("\n").map((x) => x.trim()).filter(Boolean).join(",");
  const common = { KEYSTONE_BOOTSTRAP_SUPERUSER_URL: SUPER, KEYSTONE_DATABASE_URL: SUPER, KEYSTONE_MIGRATE_LEDGER_ONLY: ledgerOnly,
    KEYSTONE_BOOTSTRAP_PASSWORDS: JSON.stringify(Object.fromEntries(ROLES.map((r) => [r, pw(r)]))) };
  if (fresh) {
    console.log("docustay: first run — creating the database roles and schema (this takes a few minutes)…");
    if (sh(["scripts/prepare-fresh-database.mjs"], common).status !== 0) process.exit(1);
  } else {
    console.log("docustay: applying any migrations this version adds…");
    if (sh(["scripts/bootstrap-roles.mjs"], common).status !== 0) process.exit(1);   // idempotent: keeps roles and passwords in step with .env
    if (sh(["scripts/ensure-metrics-roles.mjs"], common).status !== 0) process.exit(1);   // migration 0755 needs these two roles; a no-op when they exist
    if (sh(["db/migrate.mjs", "up"], common).status !== 0) process.exit(1);
  }
}

function signingCertificate() {
  mkdirSync(DATA, { recursive: true });
  const p12 = path.join(DATA, "signing.p12.b64"), crt = path.join(DATA, "signing.crt.pem");
  if (!existsSync(p12) || !existsSync(crt)) {
    console.log("docustay: first run — generating this install's own PDF-sealing certificate…");
    const r = spawnSync("node", ["docustay/selfhost/make-signing-cert.mjs", p12, crt], { stdio: "inherit", env });
    if (r.status !== 0) process.exit(1);
  }
  return { DOCUMENT_SIGNING_CERT_P12: readFileSync(p12, "utf8").trim(), DOCUMENT_SIGNING_CERT_PASSPHRASE: "", KEYSTONE_SIGNING_CERT_PEM: readFileSync(crt, "utf8") };
}

await waitForDb();
// A Pro key is set but the closed add-on is not on this install yet: fetch it once, here, before the schema is prepared, so the worker (which waits for the schema) finds it on its first start (the key-checked download; a failure is logged and the install simply runs as Community). `node docustay/selfhost/addon.mjs pull` does the same by hand.
if (role === "app" && env.DOCUSTAY_LICENSE_KEY && !env.DOCUSTAY_PRO_ADDON && !existsSync(path.join(env.KEYSTONE_DATA_DIR || "/data", "addon", "index.mjs"))) {
  const r = spawnSync("node", ["docustay/selfhost/addon.mjs", "pull"], { stdio: "inherit", env });
  if (r.status !== 0) console.error("docustay: the Pro add-on could not be fetched; running as Community. Try again later with: docker compose exec app node docustay/selfhost/addon.mjs pull");
}
if (role === "app") await prepareDatabase();
else if (role === "run") { /* the app owns the schema; a script only needs the database to be there */ }
else { for (let i = 0; i < 90; i += 1) {   // the worker waits until the app has finished the schema
  const c = new pg.Client({ connectionString: SUPER, ssl: env.KEYSTONE_DB_SSL === "off" ? false : { rejectUnauthorized: false } });
  try { await c.connect(); const ok = (await c.query("SELECT to_regclass('keystone_meta.schema_migrations') AS t")).rows[0].t && (await c.query("SELECT count(*)::int n FROM keystone_meta.schema_migrations")).rows[0].n > 400; await c.end(); if (ok) break; } catch { await c.end().catch(() => {}); }
  await new Promise((r) => setTimeout(r, 4000));
} }
const cert = signingCertificate();
// this install's own master key (seals the SMTP password and any other secret it stores), generated once and kept in the data volume
const mk = path.join(DATA, "master.key");
if (!existsSync(mk)) { writeFileSync(mk, randomBytes(32).toString("base64"), { mode: 0o600 }); console.log("docustay: first run — generated this install's master key"); }
const runEnv = {
  ...env, ...cert,
  NODE_ENV: "production", KEYSTONE_SELF_HOST: "1", KEYSTONE_LOCAL_AUTH: "1", KEYSTONE_PRODUCT: "docustay",
  KEYSTONE_LOCAL_AUTH_SECRET: need("KEYSTONE_LOCAL_AUTH_SECRET"), KEYSTONE_TOKEN_PEPPER: need("KEYSTONE_TOKEN_PEPPER"), KEYSTONE_SETUP_TOKEN: need("KEYSTONE_SETUP_TOKEN"),
  KEYSTONE_DATABASE_URL: withRole("app_rw"), KEYSTONE_SIGNUP_URL: withRole("app_signup"), KEYSTONE_WORKER_DATABASE_URL: withRole("app_worker"),
  // "production" so mail really goes out (any other environment redirects it); the production-only checks that name Firebase / hosts are satisfied by this install's own values, which name nothing of ours
  KEYSTONE_ENVIRONMENT: "production", KEYSTONE_MASTER_KEY: readFileSync(mk, "utf8").trim(),
  KEYSTONE_FIREBASE_PROJECT_ID: "selfhost", KEYSTONE_PRODUCTION_FINGERPRINT: JSON.stringify({ firebaseProjectId: "selfhost", dbHosts: [], s3Hosts: [], n8nHosts: [] }),
};
if (role === "run") {
  const r = spawnSync("node", process.argv.slice(3), { stdio: "inherit", env: runEnv });
  process.exit(r.status ?? 1);
}
if (role === "worker") spawn("node", ["docustay/selfhost/usage-ping.mjs"], { stdio: "inherit", env: runEnv });   // daily anonymous ping + licence renewal (DOCUSTAY_TELEMETRY=off silences the ping)
const child = spawn("node", [role === "app" ? "src/server.mjs" : "src/worker.mjs"], { stdio: "inherit", env: runEnv });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 1));
