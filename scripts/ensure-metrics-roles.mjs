#!/usr/bin/env node
// scripts/ensure-metrics-roles.mjs — the two roles migration 0755 (metrics views for PostHog) needs, for a database that has NO ops bootstrap:
// a self-hosted install, which builds its own database from nothing. Run by docustay/entrypoint.mjs (upgrades) and scripts/prepare-fresh-database.mjs (first run),
// as the install's own superuser, AFTER scripts/bootstrap-roles.mjs (app_owner must exist) and BEFORE the migrations.
// ★ On a self-hosted install both roles are NOLOGIN: nothing ever connects as posthog_reader there, so it has no password and no way in.
//   The hosted production and beta databases use ops/posthog/bootstrap-metrics-roles.sh instead (a real posthog_reader login, password in Secret Manager); this script
//   changes nothing when the roles already exist, so running it there is harmless.
import pg from "pg";
import { dbSsl } from "../src/db/ssl.mjs";
const url = process.env.KEYSTONE_BOOTSTRAP_SUPERUSER_URL || process.env.KEYSTONE_DATABASE_URL;
if (!url) { console.error("FATAL: KEYSTONE_BOOTSTRAP_SUPERUSER_URL is not set"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: dbSsl() });
await c.connect();
try {
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metrics_owner') THEN CREATE ROLE metrics_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'posthog_reader') THEN CREATE ROLE posthog_reader NOLOGIN; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') AND NOT pg_has_role('app_owner', 'metrics_owner', 'MEMBER') THEN GRANT metrics_owner TO app_owner; END IF;
  END $$`);
  console.log("metrics roles: present");
} finally { await c.end(); }
