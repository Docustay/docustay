-- ★★★ STAGE 4 TASK 12 — THE DAILY BOOKKEEPING PRUNE (spec 07 §3), THE LEDGER'S HALF.
--
-- prune_bookkeeping removes four kinds of bookkeeping once it is SETTLED and past its retention:
-- keystone.event_delivery (30 d), keystone.webhook_delivery (30 d), keystone.idempotency_key (7 d) — all
-- three reachable by app_rw under withTenant — and keystone_meta.job_failure (30 d), which is NOT.
--
-- ★★ THE LEDGER HAS NO TABLE GRANTS, BY DESIGN (0145): "no application role holds any grant on this table".
--    app_worker writes it through record_job_failure() and reads it through job_failure_health(). So the
--    prune needs a third SECURITY DEFINER function of the same shape — owned by app_owner (the table's own
--    owner; the table carries no RLS, so there is no FORCE-RLS owner trap here, 0114/0129), SET search_path
--    = '', REVOKE from PUBLIC, EXECUTE to app_worker only, all in ONE role so the REVOKE is not a warning
--    (0141).
--
-- ★★ R59 IS THE WHOLE POINT OF THE FILTER: the queue check counts UNACKNOWLEDGED give-ups forever, with no
--    last-hour window. Pruning an unacknowledged row would silently clear an alert nobody ever looked at.
--    So the filter is `acknowledged_at IS NOT NULL AND acknowledged_at < now() - 30 days` — the age is taken
--    from the ACKNOWLEDGEMENT, not from gave_up_at: a give-up from a year ago that was acknowledged this
--    morning stays for another 30 days, which is what "30 days after someone dealt with it" means.
--
-- ★ THE REFERENCE PRACTICE IS SKIPPED BY THE CALLER, NOT HERE — and that is measured, not a preference:
--     SET ROLE app_owner; SELECT count(*) FROM keystone.tenant;  →  0   [MEASURED]
--   FORCE RLS shows this function's owner no practice rows at all, and app_owner holds no USAGE on
--   keystone_auth to reach an auth_owner resolver (MEASURED). So `NOT t.is_reference` cannot be written
--   into this statement truthfully. src/queue/pruneBookkeeping.mjs reads is_reference ONCE as app_rw and
--   returns before any statement runs — this function is never called for the reference practice. (The
--   ledger carries no 0099 guard trigger either — there is no guard here to "fall through to".)
--
-- ★ p_tenant_id IS NOT NULL is an explicit predicate, not an accident of the caller: a NULL tenant_id in
--   the ledger is a PLATFORM-WIDE job's give-up (sweep_tenants, watch_system, reap_orphan_jobs,
--   daily_summary — PLATFORM_WIDE_JOBS, src/queue/jobPolicy.mjs:270). A per-practice prune must never
--   reach those rows, and `f.tenant_id = p_tenant_id` alone would already miss them; saying so out loud
--   keeps a future caller from passing NULL and silently emptying the platform's half of the ledger.

CREATE FUNCTION keystone_meta.prune_acknowledged_job_failures(
  p_tenant_id uuid, p_days int, p_limit int)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH doomed AS (
    SELECT f.id
      FROM keystone_meta.job_failure f
     WHERE p_tenant_id IS NOT NULL
       AND f.tenant_id = p_tenant_id
       AND f.acknowledged_at IS NOT NULL
       AND f.acknowledged_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days)
     ORDER BY f.id
     LIMIT greatest(p_limit, 0)
  ), gone AS (
    DELETE FROM keystone_meta.job_failure d
     USING doomed
     WHERE d.id = doomed.id
    RETURNING d.id
  )
  SELECT pg_catalog.count(*)::int FROM gone;
$$;
REVOKE ALL ON FUNCTION keystone_meta.prune_acknowledged_job_failures(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.prune_acknowledged_job_failures(uuid, int, int) TO app_worker;

COMMENT ON FUNCTION keystone_meta.prune_acknowledged_job_failures(uuid, int, int) IS
  'Stage 4 Task 12 / spec 07 §3 — the only path by which keystone_meta.job_failure rows are removed. One practice at a time, bounded by p_limit, and ONLY rows acknowledged more than p_days ago: an unacknowledged give-up is counted by the queue check forever (R59) and is never pruned. Platform rows (tenant_id IS NULL) are out of reach. EXECUTE to app_worker only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions, and on the FILTER itself.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  f text := 'keystone_meta.prune_acknowledged_job_failures(uuid,int,int)';
  probe_tenant uuid := '00000000-0000-4000-8000-00000ffff159';
  kept_unack bigint := -998000159;
  kept_recent bigint := -998000158;
  gone_old bigint := -998000157;
  kept_platform bigint := -998000156;
  n int;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0159 is running as % — it must run as app_owner, the ledger''s owner', current_user;
  END IF;

  -- NEGATIVE: nobody but app_worker may execute it, and the table stays ungranted (0145's rule).
  IF has_function_privilege('public', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0159: % is executable by PUBLIC (acl %)', f, (SELECT proacl FROM pg_proc WHERE oid = f::regprocedure);
  END IF;
  FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '0159: % can execute % — only the worker prunes the ledger', r, f;
    END IF;
  END LOOP;
  -- POSITIVE CONTROL for the same check: the one role that must be able to, can.
  IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0159: app_worker cannot execute % — the prune could never run', f;
  END IF;
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND has_table_privilege(r, 'keystone_meta.job_failure', 'DELETE') THEN
      RAISE EXCEPTION '0159: % holds DELETE on keystone_meta.job_failure directly — 0145''s rule is broken', r;
    END IF;
  END LOOP;

  -- ★★ THE FILTER ITSELF, on four planted rows removed again below whatever happens.
  --    A prune's bug is invisible afterwards, so the assertion is "exactly the one row, and only it".
  INSERT INTO keystone_meta.job_failure (job_id, task_identifier, tenant_id, reason, gave_up_at,
                                         job_created_at, acknowledged_at, acknowledged_by, acknowledge_reason)
  VALUES (gone_old,      '0159_probe', probe_tenant, 'probe', now() - interval '90 days',
          now() - interval '91 days', now() - interval '40 days', 'system', 'probe'),
         (kept_unack,    '0159_probe', probe_tenant, 'probe', now() - interval '90 days',
          now() - interval '91 days', NULL, NULL, NULL),
         (kept_recent,   '0159_probe', probe_tenant, 'probe', now() - interval '90 days',
          now() - interval '91 days', now() - interval '1 day',   'system', 'probe'),
         (kept_platform, '0159_probe', NULL,         'probe', now() - interval '90 days',
          now() - interval '91 days', now() - interval '40 days', 'system', 'probe');

  n := keystone_meta.prune_acknowledged_job_failures(probe_tenant, 30, 500);
  IF n <> 1 THEN
    RAISE EXCEPTION '0159: the prune removed % ledger row(s), expected exactly 1', n;
  END IF;
  IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE job_id = gone_old) THEN
    RAISE EXCEPTION '0159: a give-up acknowledged 40 days ago was NOT pruned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE job_id = kept_unack) THEN
    RAISE EXCEPTION '0159: an UNACKNOWLEDGED give-up was pruned — R59: the queue check counts it forever';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE job_id = kept_recent) THEN
    RAISE EXCEPTION '0159: a give-up acknowledged yesterday was pruned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE job_id = kept_platform) THEN
    RAISE EXCEPTION '0159: a PLATFORM give-up (tenant_id IS NULL) was pruned by a per-practice call';
  END IF;

  -- The batch bound is real, and a NULL practice reaches nothing.
  IF keystone_meta.prune_acknowledged_job_failures(probe_tenant, 30, 0) <> 0 THEN
    RAISE EXCEPTION '0159: a limit of 0 still deleted rows';
  END IF;
  IF keystone_meta.prune_acknowledged_job_failures(NULL, 30, 500) <> 0 THEN
    RAISE EXCEPTION '0159: a NULL practice pruned rows — the platform''s ledger is reachable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE job_id = kept_platform) THEN
    RAISE EXCEPTION '0159: the NULL-practice call removed the platform row after all';
  END IF;

  DELETE FROM keystone_meta.job_failure
   WHERE job_id IN (gone_old, kept_unack, kept_recent, kept_platform);
  IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE task_identifier = '0159_probe') THEN
    RAISE EXCEPTION '0159: the probe left rows behind in the ledger';
  END IF;
END $$;
