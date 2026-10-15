-- 0185_backup_history_is_the_platforms_not_the_practices
-- Stage 7 task 7.5 — `keystone_meta.backup_run` stops being readable by every practice. 0114 GRANTed
-- SELECT to app_rw and never turned RLS on at all (relrowsecurity = f, relforcerowsecurity = f,
-- MEASURED against production) — exactly F506's shape, a grant with no policy behind it. This
-- migration puts a single policy behind that grant: `keystone.caller_is_platform()`.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ENABLE, NOT FORCE. Read this before "tidying" it (CCR-11) — the first draft of this task said
--     ENABLE + FORCE and that would have broken the health dashboard:
--       `keystone_meta.backup_health()` (0129:88-99) is a SECURITY DEFINER function OWNED BY
--       app_owner, which is `keystone_meta.backup_run`'s OWN OWNER (0114 created the table with no
--       `SET LOCAL ROLE`, so the migration runner's default role — app_owner — owns it). FORCE ROW
--       LEVEL SECURITY applies a table's policies to its own owner, which backup_health() is. It
--       runs on the app_worker health path (src/health/watch.mjs:163-187, F485) with NO tenant GUC
--       set, so under FORCE it would match no policy, return zero rows, and watch.mjs:166-171 would
--       report "NO VERIFIED BACKUP HAS EVER BEEN RECORDED" on a system whose backups are fine —
--       CLAUDE.md failure #4 (a check that reports the product broken when the check is wrong) plus
--       an F488 /readyz risk, from a one-word plan choice.
--     Two further reasons FORCE is not owed here: the FORCE-everywhere conformance rule is scoped to
--     schema `keystone` (db/gates/catalog-conformance.mjs:11; db/gates/p21a_rls_pgtap.mjs:105,137
--     both filter nspname='keystone') and `backup_run` lives in `keystone_meta`; and
--     db/gates/p21a_auth_schema_fuzz.mjs:217 names FORCE on a definer-served table "the P19.2a
--     mistake" in so many words — backup_run is definer-served (backup_health()) and outside
--     `keystone`. The boundary that matters is the one this migration adds: `app_rw` keeps its
--     SELECT grant from 0114 and gains nothing from it, because it now matches no policy. FORCE
--     would add nothing against app_rw — it only binds the owner, and the owner is the definer
--     function's own owner, which must keep reading.
--
-- ★ WHO SUPPLIES THE CONDITION: `caller_is_platform()` (0018) reads a GUC the APPLICATION sets —
--   today `keystone.tenant_id` (src/db/index.mjs:111), after task 7.6 `keystone.operator_grant_id`.
--   Either way, the application supplies it, never the test. `backup_health()` does not depend on
--   that GUC at all, by design: it is the worker's path and stays owner-privileged regardless of
--   this migration.
--
-- ★ src/health/watch.mjs needs NO code change for this task. MEASURED: its only read of backup
--   data is `SELECT * FROM keystone_meta.backup_health()` (watch.mjs:164), the SECURITY DEFINER
--   function above — there is no direct `SELECT ... FROM keystone_meta.backup_run` anywhere in
--   src/. That is exactly the CCR-11 shape: the owner-privileged definer path is what stays
--   unaffected by ENABLE-not-FORCE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone_meta.backup_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_reads ON keystone_meta.backup_run
  FOR SELECT USING (keystone.caller_is_platform());

CREATE POLICY worker_writes ON keystone_meta.backup_run
  FOR INSERT WITH CHECK (current_user = 'app_worker');

GRANT INSERT ON keystone_meta.backup_run TO app_worker;  -- if not already held

COMMENT ON TABLE keystone_meta.backup_run IS
  'P8.10 / Stage 7 task 7.5. One row per backup attempt, written by scripts/backup.sh AFTER its restore check. ENABLE ROW LEVEL SECURITY but deliberately NOT FORCE (CCR-11) — keystone_meta.backup_health() (0129) is a SECURITY DEFINER owned by this table''s own owner (app_owner) and must keep reading with no tenant GUC set. platform_reads gates SELECT on keystone.caller_is_platform(); app_rw''s 0114 grant now matches no policy and reads zero rows outside the platform context. worker_writes gates INSERT to current_user = app_worker.';

-- ★★★ THE SELF-CHECK: BOTH HALVES, SO A LATER "CONSISTENCY" MIGRATION CANNOT ADD FORCE QUIETLY AND
--     BLIND THE HEALTH DASHBOARD, AND SO THIS MIGRATION CANNOT REPORT SUCCESS ON A TABLE IT DID NOT
--     ACTUALLY CHANGE.
DO $$
DECLARE
  v_enabled boolean;
  v_forced  boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_enabled, v_forced
    FROM pg_class WHERE oid = 'keystone_meta.backup_run'::regclass;

  IF NOT v_enabled THEN
    RAISE EXCEPTION 'keystone_meta.backup_run: ROW LEVEL SECURITY was not enabled by this migration';
  END IF;
  IF v_forced THEN
    RAISE EXCEPTION 'keystone_meta.backup_run: relforcerowsecurity is true (FORCE is set) — this table must be ENABLE-only (CCR-11): FORCE would subject keystone_meta.backup_health() (0129), a SECURITY DEFINER owned by this table''s own owner, to these policies and blind the health dashboard';
  END IF;

  RAISE NOTICE 'keystone_meta.backup_run self-check: RLS enabled (relrowsecurity=true), not forced (relforcerowsecurity=false)';
END $$;
