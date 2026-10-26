-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- STAGE 4 TASK 14 · PHASE B · C-1 — "ACKNOWLEDGED" MEANS THE JOB IS FINISHED WITH, NOT JUST FILED.
--
-- ★★★ THE DEFECT (task-14-review.md C-1, EXECUTED end to end on the local database):
--     1. A job for a LIVE practice exhausts its attempts. `decide()` forces max_attempts = attempts
--        and writes the ledger row (src/queue/jobPolicy.mjs:397-406). The graphile row stays at
--        attempts >= max_attempts for ever.
--     2. A person presses "Give up…". `keystone_meta.acknowledge_job_failure` (0160 §5) sets
--        acknowledged_at. The queue check goes green. It writes NOTHING to graphile and holds no
--        privilege to — auth_owner has SELECT and a five-column UPDATE on
--        graphile_worker._private_jobs (0160 §1) and NO DELETE, to any role but app_worker.
--     3. Thirty days later `keystone_meta.prune_acknowledged_job_failures` (0159) deletes the ledger
--        row. Correctly: it is acknowledged and it is old.
--     4. Nothing ever deleted the GRAPHILE row. The only caller of graphile_worker.complete_jobs in
--        the whole application is the orphan reaper, and the reaper only touches jobs whose practice
--        is GONE (keystone_meta.job_practice_is_gone, 0147:61).
--     5. src/health/watch.mjs then counts that row as `unrecorded` for ever, and it is an IMMEDIATE
--        key — the HOURLY alert. Platform Jobs lists LEDGER rows, so the job can never be shown or
--        acknowledged again, and `record_job_failure` refuses to re-acknowledge for a live practice.
--     That is F486 — the defect this whole stage exists to fix — reintroduced on a thirty-day fuse.
--
-- ★★★ THE RULING (controller, Phase B dispatch): acknowledging a give-up means the underlying JOB is
--     finished, not just the paperwork. Not a filter in queueCheck, not a refusal in the prune.
--
-- ★★★ WHY THE WORK IS DONE BY THE WORKER AND NOT HERE. 0145:28-29 states it outright and this
--     migration re-measures it: graphile_worker is owned by keystone_admin and only `app_worker`
--     holds write rights on its tables. Migrations run as app_owner, which holds NOTHING there. So
--     this file does not — cannot — delete a queue row. It builds the two narrow doors the worker
--     needs, and the SAME sweep that already completes a gone practice's jobs
--     (src/queue/tasks.mjs, reap_orphan_jobs) walks through them. Granting app_rw or auth_owner
--     DELETE on graphile_worker._private_jobs to route around this was considered and REFUSED: it
--     would put the queue's destruction inside a web request, which is the one place 0160 spent an
--     entire section keeping it out of.
--
-- ★★★ AND THE ORDER IS GUARDED, NOT ASSUMED. A person's acknowledgement and the next sweep tick are
--     minutes apart and either could be first. So the ledger row does not become PRUNABLE until the
--     graphile row is actually gone: `job_finished_at` is the flag, the worker is the only thing
--     that may set it, and the prune now requires it. There is therefore no window in which the
--     thirty-day clock is running on a job that is still sitting in the queue.
--
-- ★★ MN-5 (same review, LOW) rides along because it is the same sentence about the same table:
--    platform-wide give-ups (tenant_id IS NULL — sweep_tenants, watch_system, reap_orphan_jobs,
--    daily_summary) were the one ledger in the stage with NO retention at all, because 0159's prune
--    is deliberately per-practice and says so. They get a sibling with the same thirty-day rule and
--    the same "finished first" requirement.
--
-- NOT one-way: the column is additive and the two new functions are new names. The CREATE OR REPLACE
-- of prune_acknowledged_job_failures NARROWS what it deletes; nothing is destroyed by applying it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · THE FLAG — "the queue row this record describes is really gone"
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ Nullable and with no default, on purpose: every row already in the table reads NULL, which is
--   the honest answer ("nobody has checked yet") and keeps them out of the prune until the sweep
--   has looked. No backfill is written here because a backfill would have to read graphile, and
--   app_owner cannot (MEASURED, §5 below asserts it). The sweep does it on its first ticks instead,
--   bounded, as ordinary work.
ALTER TABLE keystone_meta.job_failure
  ADD COLUMN IF NOT EXISTS job_finished_at timestamptz;

COMMENT ON COLUMN keystone_meta.job_failure.job_finished_at IS
  'Stage 4 Task 14 / C-1 — when the worker confirmed the graphile row this record describes is gone (it completed it, or it was already absent). NULL means nobody has checked yet. Only keystone_meta.mark_job_failures_finished sets it, and only app_worker may call that. The retention prune refuses a row where this is NULL, so an acknowledged give-up can never be filed away while its job is still queued at max_attempts.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · THE CANDIDATE LIST — what the worker's sweep asks for
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ THE WHOLE IDENTITY TRAVELS, NOT THE ID (F510). A graphile id is reused after a reap; a ledger
--    row is keyed on (job_id, task_identifier, job_created_at) for exactly that reason. The sweep
--    must be able to refuse to complete a row that merely shares an id with the job it recorded, so
--    all three columns come back and the caller joins on all three.
-- ★ app_worker holds no rights on keystone_meta.job_failure (0145) — this definer is the only read.
CREATE FUNCTION keystone_meta.job_failures_awaiting_finish(p_limit int)
RETURNS TABLE (failure_id bigint, job_id bigint, task_identifier text, job_created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.job_id, f.task_identifier, f.job_created_at
    FROM keystone_meta.job_failure f
   WHERE f.acknowledged_at IS NOT NULL
     AND f.job_finished_at IS NULL
   ORDER BY f.id
   LIMIT greatest(p_limit, 0)
$$;
REVOKE ALL ON FUNCTION keystone_meta.job_failures_awaiting_finish(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.job_failures_awaiting_finish(int) TO app_worker;
COMMENT ON FUNCTION keystone_meta.job_failures_awaiting_finish(int) IS
  'Stage 4 Task 14 / C-1 — the give-ups a person has acknowledged whose queue row has not yet been confirmed gone. Returns the WHOLE ledger identity (job_id, task_identifier, job_created_at) so the caller can refuse to complete a graphile row that merely reuses the id (F510). Read-only, bounded by p_limit. Owned by app_owner. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · THE MARK — written only after the queue row is really gone
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ It cannot acknowledge, un-acknowledge, re-open or delete anything: one column, set once, and
--    only on rows that are already acknowledged. A bug in the worker cannot use this to silence a
--    give-up nobody has looked at — `acknowledged_at IS NOT NULL` is checked here, not upstream.
CREATE FUNCTION keystone_meta.mark_job_failures_finished(p_failure_ids bigint[])
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH marked AS (
    UPDATE keystone_meta.job_failure f
       SET job_finished_at = pg_catalog.now()
     WHERE f.id = ANY (coalesce(p_failure_ids, '{}'::bigint[]))
       AND f.acknowledged_at IS NOT NULL
       AND f.job_finished_at IS NULL
    RETURNING f.id
  )
  SELECT pg_catalog.count(*)::int FROM marked;
$$;
REVOKE ALL ON FUNCTION keystone_meta.mark_job_failures_finished(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.mark_job_failures_finished(bigint[]) TO app_worker;
COMMENT ON FUNCTION keystone_meta.mark_job_failures_finished(bigint[]) IS
  'Stage 4 Task 14 / C-1 — records that the graphile row behind an ACKNOWLEDGED give-up is gone (completed by the sweep, or already absent). Sets job_finished_at and nothing else, only on rows that are acknowledged and not already marked. Owned by app_owner. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · THE PRUNE NOW REQUIRES THE JOB TO BE FINISHED — and platform rows get a retention at last
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE ONE ADDED LINE IS THE FIX: `AND f.job_finished_at IS NOT NULL`. Everything else in this
--     body is 0159's, unchanged, including the deliberate `p_tenant_id IS NOT NULL` that keeps a
--     per-practice prune away from the platform's half of the ledger.
CREATE OR REPLACE FUNCTION keystone_meta.prune_acknowledged_job_failures(
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
       AND f.job_finished_at IS NOT NULL
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
COMMENT ON FUNCTION keystone_meta.prune_acknowledged_job_failures(uuid, int, int) IS
  'Stage 4 Task 12 / spec 07 §3, narrowed by Task 14 / C-1 — one practice at a time, bounded by p_limit, and ONLY rows that are acknowledged, older than p_days, AND whose graphile job has been confirmed gone (job_finished_at). An unacknowledged give-up is counted by the queue check for ever (R59) and is never pruned; an acknowledged one whose queue row is still sitting at max_attempts is not pruned either, because deleting its record would make that row an unrecorded give-up nobody can ever clear (C-1). Platform rows (tenant_id IS NULL) are out of reach here and belong to prune_platform_job_failures. EXECUTE to app_worker only.';

-- ★★ MN-5. A platform-wide job (PLATFORM_WIDE_JOBS, src/queue/jobPolicy.mjs) carries no tenantId, so
--    its give-up is a ledger row with tenant_id IS NULL. 0159 could not reach those and said so; the
--    per-practice fan-out must still never reach them, so this is a SEPARATE function with the same
--    thirty-day rule, called once per sweep from the platform-only path rather than per practice.
CREATE FUNCTION keystone_meta.prune_platform_job_failures(p_days int, p_limit int)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH doomed AS (
    SELECT f.id
      FROM keystone_meta.job_failure f
     WHERE f.tenant_id IS NULL
       AND f.acknowledged_at IS NOT NULL
       AND f.acknowledged_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days)
       AND f.job_finished_at IS NOT NULL
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
REVOKE ALL ON FUNCTION keystone_meta.prune_platform_job_failures(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.prune_platform_job_failures(int, int) TO app_worker;
COMMENT ON FUNCTION keystone_meta.prune_platform_job_failures(int, int) IS
  'Stage 4 Task 14 / MN-5 — the same thirty-day retention as prune_acknowledged_job_failures, for the PLATFORM half of the ledger (tenant_id IS NULL: sweep_tenants, watch_system, reap_orphan_jobs, daily_summary). Reaches no practice row: tenant_id IS NULL is an equality on nothing else. Acknowledged, old, and job_finished_at required, same as the per-practice one. Owned by app_owner. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §5 · ★★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — shape, ACLs both ways, and the FILTERS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f text; p record; bad text[] := '{}'; grantee text;
  mine text[] := ARRAY['keystone_meta.job_failures_awaiting_finish(integer)',
                       'keystone_meta.mark_job_failures_finished(bigint[])',
                       'keystone_meta.prune_acknowledged_job_failures(uuid,integer,integer)',
                       'keystone_meta.prune_platform_job_failures(integer,integer)'];
  t_live uuid; t_other uuid;
  id_fin bigint; id_unfin bigint; id_unack bigint; id_plat bigint; id_plat_unfin bigint;
  n int; ids bigint[]; ids_text text[];
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0161 is running as %, expected app_owner', current_user;
  END IF;

  -- ── the column exists and is nullable ──
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'keystone_meta.job_failure'::regclass
                    AND a.attname = 'job_finished_at' AND NOT a.attisdropped AND NOT a.attnotnull) THEN
    RAISE EXCEPTION '0161: job_finished_at is missing or NOT NULL — every existing row must read NULL';
  END IF;

  -- ── owner · prosecdef · search_path, for all four ──
  FOREACH f IN ARRAY mine LOOP
    SELECT pg_get_userbyid(pr.proowner) AS owner, pr.prosecdef, pr.proconfig
      INTO p FROM pg_proc pr WHERE pr.oid = f::regprocedure;
    IF p.owner <> 'app_owner' THEN bad := bad || format('%s is owned by %s', f, p.owner); END IF;
    IF NOT p.prosecdef THEN bad := bad || format('%s is not SECURITY DEFINER', f); END IF;
    IF p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      bad := bad || format('%s has proconfig %s, expected the empty search_path', f, coalesce(p.proconfig::text, 'NULL'));
    END IF;
  END LOOP;

  -- ── ACLs, BOTH directions: app_worker may call each one; nobody else may, and PUBLIC least of all ──
  FOREACH f IN ARRAY mine LOOP
    IF NOT has_function_privilege('app_worker', f::regprocedure, 'EXECUTE') THEN
      bad := bad || format('app_worker cannot EXECUTE %s', f);
    END IF;
    FOREACH grantee IN ARRAY ARRAY['public', 'app_rw', 'app_embed', 'app_signup', 'auth_owner'] LOOP
      IF has_function_privilege(grantee, f::regprocedure, 'EXECUTE') THEN
        bad := bad || format('%s can EXECUTE %s', grantee, f);
      END IF;
    END LOOP;
  END LOOP;

  -- ── and the door this migration deliberately did NOT open ──
  -- ★ Read from the catalogue, not through has_table_privilege(): app_owner holds no USAGE on the
  --   graphile_worker SCHEMA, so naming the table in a privilege function raises "permission denied
  --   for schema graphile_worker" [EXECUTED]. That refusal is itself half the point of this check —
  --   the migration's own role cannot so much as look the queue up by name — so the assertion is
  --   made against pg_class/relacl, which any role may read.
  SELECT coalesce(array_agg(DISTINCT pg_get_userbyid(x.grantee)), '{}')
    INTO ids_text
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, '{}')) x
   WHERE ns.nspname = 'graphile_worker' AND c.relname = '_private_jobs'
     AND x.privilege_type = 'DELETE';
  IF ids_text <> '{}' AND NOT (ids_text <@ ARRAY['app_worker', 'keystone_admin']) THEN
    bad := bad || format('DELETE on graphile_worker._private_jobs is held by %s — only app_worker (and its owner) may',
                         array_to_string(ids_text, ', '));
  END IF;
  IF ids_text <> '{}' AND NOT ('app_worker' = ANY (ids_text)) THEN
    bad := bad || 'app_worker lost DELETE on graphile_worker._private_jobs — the sweep is a bridge to nowhere';
  END IF;

  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION '0161 shape/ACL assertions failed: %', array_to_string(bad, ' · ');
  END IF;

  -- ═══ THE FILTERS, ON PLANTED ROWS, ROLLED BACK BY THE SAVEPOINT BELOW ═══════════════════════
  -- ★★ Five rows that differ in exactly one thing each, so a failure names which predicate broke.
  BEGIN
    t_live  := gen_random_uuid();
    t_other := gen_random_uuid();

    INSERT INTO keystone_meta.job_failure
      (job_id, task_identifier, job_created_at, tenant_id, reason, gave_up_at,
       acknowledged_at, acknowledged_by, acknowledge_reason, job_finished_at)
    VALUES (9223372036854775801, 'zz_0161_a', now() - interval '90 days', t_live, '0161 probe: old, ack, finished',
            now() - interval '90 days', now() - interval '31 days', 'system', '0161 probe', now())
    RETURNING id INTO id_fin;

    INSERT INTO keystone_meta.job_failure
      (job_id, task_identifier, job_created_at, tenant_id, reason, gave_up_at,
       acknowledged_at, acknowledged_by, acknowledge_reason, job_finished_at)
    VALUES (9223372036854775802, 'zz_0161_b', now() - interval '90 days', t_live, '0161 probe: old, ack, NOT finished',
            now() - interval '90 days', now() - interval '31 days', 'system', '0161 probe', NULL)
    RETURNING id INTO id_unfin;

    INSERT INTO keystone_meta.job_failure
      (job_id, task_identifier, job_created_at, tenant_id, reason, gave_up_at, job_finished_at)
    VALUES (9223372036854775803, 'zz_0161_c', now() - interval '90 days', t_live, '0161 probe: old, NOT ack',
            now() - interval '90 days', NULL)
    RETURNING id INTO id_unack;

    INSERT INTO keystone_meta.job_failure
      (job_id, task_identifier, job_created_at, tenant_id, reason, gave_up_at,
       acknowledged_at, acknowledged_by, acknowledge_reason, job_finished_at)
    VALUES (9223372036854775804, 'zz_0161_d', now() - interval '90 days', NULL, '0161 probe: platform, old, ack, finished',
            now() - interval '90 days', now() - interval '31 days', 'system', '0161 probe', now())
    RETURNING id INTO id_plat;

    INSERT INTO keystone_meta.job_failure
      (job_id, task_identifier, job_created_at, tenant_id, reason, gave_up_at,
       acknowledged_at, acknowledged_by, acknowledge_reason, job_finished_at)
    VALUES (9223372036854775805, 'zz_0161_e', now() - interval '90 days', NULL, '0161 probe: platform, old, ack, NOT finished',
            now() - interval '90 days', now() - interval '31 days', 'system', '0161 probe', NULL)
    RETURNING id INTO id_plat_unfin;

    -- ── the candidate list names the two unfinished acknowledged rows and NOT the unacknowledged one ──
    SELECT array_agg(c.failure_id ORDER BY c.failure_id) INTO ids
      FROM keystone_meta.job_failures_awaiting_finish(1000) c
     WHERE c.failure_id IN (id_fin, id_unfin, id_unack, id_plat, id_plat_unfin);
    IF ids IS DISTINCT FROM ARRAY[least(id_unfin, id_plat_unfin), greatest(id_unfin, id_plat_unfin)] THEN
      RAISE EXCEPTION '0161: job_failures_awaiting_finish returned % — expected exactly the two acknowledged, unfinished rows (% and %)',
        coalesce(ids::text, 'nothing'), id_unfin, id_plat_unfin;
    END IF;
    IF (SELECT count(*) FROM keystone_meta.job_failures_awaiting_finish(0)) <> 0 THEN
      RAISE EXCEPTION '0161: job_failures_awaiting_finish(0) returned rows — the limit does nothing';
    END IF;

    -- ── the mark sets the flag on an acknowledged row and REFUSES an unacknowledged one ──
    IF keystone_meta.mark_job_failures_finished(ARRAY[id_unack]) <> 0 THEN
      RAISE EXCEPTION '0161: mark_job_failures_finished marked an UNACKNOWLEDGED row — it could be used to silence a give-up';
    END IF;
    IF keystone_meta.mark_job_failures_finished(ARRAY[id_unfin]) <> 1 THEN
      RAISE EXCEPTION '0161: mark_job_failures_finished did not mark the acknowledged, unfinished row (positive control)';
    END IF;
    IF keystone_meta.mark_job_failures_finished(ARRAY[id_unfin]) <> 0 THEN
      RAISE EXCEPTION '0161: mark_job_failures_finished marked an already-finished row twice';
    END IF;

    -- ── the per-practice prune takes the finished ones and leaves the rest ──
    --    (id_unfin was just marked finished, so both practice rows are now prunable; id_unack is not)
    n := keystone_meta.prune_acknowledged_job_failures(t_live, 30, 500);
    IF n <> 2 THEN
      RAISE EXCEPTION '0161: the per-practice prune deleted % rows, expected the 2 acknowledged+old+finished ones', n;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE id = id_unack) THEN
      RAISE EXCEPTION '0161: the prune deleted an UNACKNOWLEDGED row';
    END IF;
    IF keystone_meta.prune_acknowledged_job_failures(t_other, 30, 500) <> 0 THEN
      RAISE EXCEPTION '0161: the prune reached another practice''s rows';
    END IF;
    IF keystone_meta.prune_acknowledged_job_failures(NULL, 30, 500) <> 0 THEN
      RAISE EXCEPTION '0161: a NULL practice pruned the platform rows through the per-practice door';
    END IF;

    -- ★★★ THE NEGATIVE CONTROL THAT IS THE WHOLE POINT OF C-1, run against a row that is acknowledged
    --     and old but NOT finished: it must survive. (id_plat_unfin, through the platform door.)
    IF keystone_meta.prune_platform_job_failures(30, 500) <> 1 THEN
      RAISE EXCEPTION '0161: the platform prune did not take exactly the one finished platform row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE id = id_plat_unfin) THEN
      RAISE EXCEPTION '0161: the platform prune deleted a row whose graphile job has not been confirmed gone (C-1)';
    END IF;
    -- ★ and the positive control for the same door: mark it finished, and now it goes.
    PERFORM keystone_meta.mark_job_failures_finished(ARRAY[id_plat_unfin]);
    IF keystone_meta.prune_platform_job_failures(30, 500) <> 1 THEN
      RAISE EXCEPTION '0161: the platform prune did not take the row once it was marked finished (positive control)';
    END IF;

    RAISE EXCEPTION 'zz_0161_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zz_0161_rollback' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE task_identifier LIKE 'zz_0161%') THEN
    RAISE EXCEPTION '0161: the probe rows were not rolled back';
  END IF;
END $$;
