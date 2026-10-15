-- ★ FIX ROUND 1 ON F485/0129 — two minors, shipped as a NEW migration rather than an edit to 0129.
--   0129 is already applied locally (the runner checksums every applied file and refuses to
--   re-apply one whose contents changed — db/migrate.mjs:117) and has not yet reached production
--   (the controller deploys it separately). Migrations are immutable once applied; this is the
--   correct way to amend one, not an exception to it.
--
-- 1 · `backup_health()` was left VOLATILE (SQL functions default to it) despite doing nothing but
--     reading and computing an age from `now()` within a single statement — it belongs alongside
--     `outbox_health()` as STABLE, the same declaration, for the same reason: a planner that can
--     prove one evaluation per statement suffices is free to do so. Not a behaviour change; nothing
--     here writes, and `backupCheck()` only ever calls it once per invocation regardless.
--
-- 2 · 0129 proved `outbox_health()` actually runs, inside the migration itself, with an explicit
--     comment: "a resolver created and never called has shipped a hope." It never made the same
--     call for `backup_health()` — an oversight, not a judgement that it needed it less. `CREATE
--     FUNCTION` does not run the body; a typo'd column name or a bad join would not surface until
--     the first real call, which for a health check that only fires when something is already wrong
--     is exactly the worst time to discover it.

CREATE OR REPLACE FUNCTION keystone_meta.backup_health()
RETURNS TABLE (finished_at timestamptz, verified boolean, destination text, dump_bytes bigint, age_seconds int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
  SELECT finished_at, verified, destination, dump_bytes,
         extract(epoch FROM now() - finished_at)::int AS age_seconds
    FROM keystone_meta.backup_run
   WHERE target = current_database() AND verified
   ORDER BY finished_at DESC LIMIT 1;
$$;
-- ★ `CREATE OR REPLACE FUNCTION` on a matching signature preserves the OID, and with it the owner
--   (app_owner — unchanged, `backup_run` carries no RLS so this was never the auth_owner trap) and
--   every existing GRANT from 0129 (app_worker, app_rw). Nothing here needs to be re-granted.

DO $$
DECLARE result record;
BEGIN
  -- ★★ POSITIVE CONTROL — the resolver runs and does not raise. Zero rows (all fields NULL) is a
  --    legitimate state (no verified backup_run row exists yet) and is asserted elsewhere
  --    (test/s1_health_checks_as_worker.test.mjs); this only proves the function body itself is
  --    sound, matching 0129's own proof for outbox_health().
  SELECT * INTO result FROM keystone_meta.backup_health();
  RAISE NOTICE 'backup health: resolver runs without error — finished_at=%, verified=%, destination=%, dump_bytes=%, age_seconds=% (all NULL is legitimate: no verified backup_run row exists yet, not a failure)',
    result.finished_at, result.verified, result.destination, result.dump_bytes, result.age_seconds;
END $$;
