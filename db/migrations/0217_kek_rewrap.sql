-- 0217_kek_rewrap
-- Stage 9 task 9.12 — the keyring re-wrap job's own migration (06 §6, CT-063).
--
-- ★ No new table: `keystone_meta.kek_version` is 0212's. This adds only what the job needs to find
--   work quickly — a partial index on `kek_version` for each storing table, so `src/secrets/rewrap.mjs`'s
--   `WHERE kek_version = $1` does not scan either table in full on every batch.
-- ★ Both indexes are WHERE kek_version <> 1: rows almost never leave version 1 in this project's
--   lifetime so far (MEASURED 21 Sep 2026: 0 rows on production at any version other than 1 in either
--   table) — a partial index that excludes the overwhelmingly common case stays small and cheap, and
--   still serves exactly the query the re-wrap job runs (`WHERE kek_version = $1` for a $1 that is,
--   by definition, an OLDER version than the one everything defaults to).
CREATE INDEX webhook_endpoint_kek_version_idx ON keystone.webhook_endpoint (kek_version) WHERE kek_version <> 1;
CREATE INDEX google_identity_kek_version_idx  ON keystone.google_identity  (kek_version) WHERE kek_version <> 1;

-- ★ No RLS change: both tables already have FORCED RLS (0047, 0057) and a plain index does not bypass
--   it. No grant change here either — `app_rw` already holds SELECT/INSERT/UPDATE/DELETE on both
--   tables (same two migrations), which is everything the per-row re-wrap itself needs.
--
-- ★★★ THE RETIREMENT WRITE PATH — F622 FOLLOW-UP (closing the gap flagged above and in
--   `~/example-rebuild/FINDINGS.md`). `db/migrations/0212_kek_version.sql`'s own header says this task
--   "adds its own SECURITY DEFINER function and its own narrow EXECUTE grant" for writing `retired_at`
--   on `keystone_meta.kek_version` (app_rw holds SELECT only there, on purpose — 0212), "the same
--   pattern `keystone_meta.worker_beat()` and `keystone_meta.alert_transition()` already use". Mirrored
--   here exactly from `db/migrations/0127_a_worker_that_stopped_must_be_visible_from_outside.sql:13-20`
--   (`worker_beat`) and `db/migrations/0128_a_problem_nobody_is_told_about_is_not_being_watched.sql`
--   (`alert_transition`): SECURITY DEFINER, `search_path` pinned, REVOKE ALL FROM PUBLIC then a single
--   narrow GRANT EXECUTE to `app_worker` (the role the queue worker connects as — `src/queue/heartbeat.mjs`,
--   `src/queue/runner.mjs`). `app_worker` already holds USAGE on `keystone_meta` (granted in 0127).
--   Sets `retired_at = now()` only when the row is not already retired, and returns whether THIS call
--   retired it (false if it was already retired) — matching `src/secrets/rewrap.mjs`'s
--   `retireKekVersion()`, which reads `rows[0]?.retired === true`. The caller (the re-wrap job, once
--   registered) is the one place "retirement is never early" is enforced (field 7) — this function
--   trusts its caller the same way `worker_beat()` trusts the worker process that calls it.
CREATE OR REPLACE FUNCTION keystone_meta.retire_kek_version(p_version smallint) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
  WITH updated AS (
    UPDATE keystone_meta.kek_version
       SET retired_at = now()
     WHERE version = p_version
       AND retired_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;
REVOKE ALL ON FUNCTION keystone_meta.retire_kek_version(smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.retire_kek_version(smallint) TO app_worker;
--
-- ★ REFRESH note (task 9.12 field 6): if Stage 8's `keystone_auth.totp_factor`/`backup_code` (CT-057)
--   turn out to store envelopes with their own `kek_version`, they are Stage 8's tables — no index for
--   them is added here. That is a follow-up once Stage 8 has landed, not this migration's job.
--
-- ★ NOT APPLIED BY THIS TASK — written only, per BUILD-PROCESS.md. Migrations apply at step 3.
