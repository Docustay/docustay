-- 0164_a_job_queued_before_task_9_can_still_be_retried
-- Stage 4 Task 14 · Phase B · task-14-review.md IM-4 · spec 07 §4 rule 2, §11 (cutover).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE GAP, IN ONE SENTENCE. Task 9 gave every per-practice job a named queue (`t:<tenantId>`), and
-- `keystone.platform_retry_job` (0160:288-291) refuses a retry whose queue does not match the row's
-- — a retry may not move a job between queues. Both halves are right. Together they strand every
-- graphile row created BEFORE Task 9 shipped: it has `job_queue_id IS NULL`, "Retry now" computes
-- `t:<tenantId>` from the policy (src/platform/jobActions.mjs:235 passes `finalOpts.queueName`, which
-- `addJobWithPolicy` takes from `queueNameFor` — the ROW'S queue is never consulted), and
-- `NULL IS DISTINCT FROM 't:…'` is true. The button raises "a retry may not move a job between
-- queues" forever, for a job that is sitting right there with its payload intact.
--
-- ★★ THE FIX IS THE CUTOVER, NOT THE REFUSAL. Spec 07 §11 already says the cutover is where the old
--    shape is reconciled. So this migration puts the queue the policy would compute ONTO the old rows,
--    which is also the thing Task 9 wanted for them in the first place: until this runs, a pre-cutover
--    job is not merely un-retryable, it is un-FAIR — it sits on no queue, so one practice's backlog of
--    them can still delay another's.
--
-- ★★★ WHY THIS MIGRATION REACHES graphile AT ALL, when 0145:28-29 says migrations cannot.
--     `graphile_worker` is owned by the admin role and app_owner holds not one grant in it — not even
--     USAGE on the schema (MEASURED: 0161's own DO block had to read `pg_class`/`aclexplode` because
--     `has_table_privilege('app_owner', 'graphile_worker._private_jobs', …)` cannot even resolve the
--     name). `RESET ROLE` lands on SESSION_USER — the connecting superuser (db/migrate.mjs:205-208
--     documents exactly this, and 0160:69 already used it to GRANT on these tables). That is the ONLY
--     door, and it is opened for the shortest possible stretch and handed straight back (0160:125-128's
--     lesson: a migration that ends on RESET ROLE leaves every later object owned by the wrong role).
--
-- ★ THE ROWS THIS DOES NOT TOUCH, AND WHY EACH IS RIGHT:
--     · a job whose task is platform-wide (sweep_tenants, watch_system, reap_orphan_jobs,
--       daily_summary) — `queueNameFor` returns NULL for those, so NULL is already the right answer
--       and "Retry now" already matches it.
--     · a LOCKED job — a worker is running it this second. graphile releases a job's queue lock by
--       `job_queue_id` when it finishes; moving that column under a running job is a race with no
--       upside. A restart (which every deploy is) releases it, and it is dead or gone by the next run.
--     · a per-practice job with no `tenantId` in its payload — there is nothing to compute a queue
--       FROM. These are counted and named in a NOTICE rather than guessed at; 07 §11's other branch
--       (acknowledge at cutover) is what closes them, through the ordinary "Give up…" button, which
--       does not care about the queue.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $precondition$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0164: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
END
$precondition$;

-- ★ THE ONE STRETCH AS THE CONNECTING SUPERUSER. Handed back in §3, and §4 asserts it was.
RESET ROLE;

-- ── §1 · THE BACKFILL ────────────────────────────────────────────────────────────────────────────
-- ★★ The two statements below are extracted VERBATIM, by these markers, and run against planted
--    pre-Task-9-shaped rows by test/s4_queue_cutover.test.mjs. Keep the markers; keep them runnable
--    on their own. A copy of this SQL living in a test would prove only that the copy works.
-- >>> BACKFILL BEGIN
INSERT INTO graphile_worker._private_job_queues (queue_name)
SELECT DISTINCT 't:' || lower(j.payload ->> 'tenantId')
  FROM graphile_worker._private_jobs j
  JOIN graphile_worker._private_tasks t ON t.id = j.task_id
 WHERE j.job_queue_id IS NULL
   AND j.locked_at IS NULL
   AND t.identifier NOT IN ('sweep_tenants', 'watch_system', 'reap_orphan_jobs', 'daily_summary')
   AND j.payload ->> 'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (queue_name) DO NOTHING;

UPDATE graphile_worker._private_jobs j
   SET job_queue_id = q.id
  FROM graphile_worker._private_tasks t,
       graphile_worker._private_job_queues q
 WHERE t.id = j.task_id
   AND j.job_queue_id IS NULL
   AND j.locked_at IS NULL
   AND t.identifier NOT IN ('sweep_tenants', 'watch_system', 'reap_orphan_jobs', 'daily_summary')
   AND j.payload ->> 'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND q.queue_name = 't:' || lower(j.payload ->> 'tenantId');
-- <<< BACKFILL END

-- ── §2 · WHAT IS LEFT, SAID OUT LOUD ─────────────────────────────────────────────────────────────
DO $report$
DECLARE
  v_left int; v_locked int; v_platform int; v_ok int; v_names text;
BEGIN
  SELECT count(*) FILTER (WHERE j.locked_at IS NULL
                            AND t.identifier NOT IN ('sweep_tenants','watch_system','reap_orphan_jobs','daily_summary')),
         count(*) FILTER (WHERE j.locked_at IS NOT NULL),
         count(*) FILTER (WHERE t.identifier IN ('sweep_tenants','watch_system','reap_orphan_jobs','daily_summary'))
    INTO v_left, v_locked, v_platform
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
   WHERE j.job_queue_id IS NULL;
  SELECT count(*) INTO v_ok FROM graphile_worker._private_jobs WHERE job_queue_id IS NOT NULL;
  SELECT string_agg(DISTINCT t.identifier, ', ') INTO v_names
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
   WHERE j.job_queue_id IS NULL AND j.locked_at IS NULL
     AND t.identifier NOT IN ('sweep_tenants','watch_system','reap_orphan_jobs','daily_summary');

  RAISE NOTICE '0164 cutover: % job(s) now on a named queue; still queueless — % platform-wide (correct), % locked (skipped by design), % with no tenantId in the payload%',
    v_ok, v_platform, v_locked, v_left, coalesce(' [' || v_names || ']', '');
END
$report$;

-- ── §3 · GIVE THE ROLE BACK ──────────────────────────────────────────────────────────────────────
SET ROLE app_owner;

-- ── §4 · THE SELF-TEST: PLANTED PRE-TASK-9 ROWS, AND THE SAME TWO STATEMENTS ─────────────────────
-- ★★★ Nothing below survives. The whole block plants its rows, re-runs the backfill over them,
--     asserts, and then throws `zz_0164_rollback` to unwind its own subtransaction — the 0161 pattern.
--     A migration whose only evidence is "it ran" on a database where the case does not occur (this
--     one: MEASURED, 0 graphile rows locally) has proved nothing at all.
DO $selftest$
DECLARE
  v_tenant_a uuid := keystone.uuid_generate_v7();
  v_tenant_b uuid := keystone.uuid_generate_v7();
  v_task_practice int; v_task_platform int;
  j_dead bigint; j_live bigint; j_upper bigint; j_platform bigint; j_locked bigint; j_notenant bigint;
  q_a int; q_b int;
  r record;
  v_problems text[] := ARRAY[]::text[];
  v_qname text;
BEGIN
  RESET ROLE;
  BEGIN
    SELECT id INTO v_task_practice FROM graphile_worker._private_tasks WHERE identifier = 'deliver_notification_email';
    IF v_task_practice IS NULL THEN
      INSERT INTO graphile_worker._private_tasks (identifier) VALUES ('deliver_notification_email') RETURNING id INTO v_task_practice;
    END IF;
    SELECT id INTO v_task_platform FROM graphile_worker._private_tasks WHERE identifier = 'watch_system';
    IF v_task_platform IS NULL THEN
      INSERT INTO graphile_worker._private_tasks (identifier) VALUES ('watch_system') RETURNING id INTO v_task_platform;
    END IF;

    -- ★ EXACTLY THE PRE-TASK-9 SHAPE: job_queue_id NULL, attempts already spent (the dead one the
    --   review's "Retry now" acts on) and one still live, plus every row that must NOT move.
    INSERT INTO graphile_worker._private_jobs (job_queue_id, task_id, payload, attempts, max_attempts, locked_at, locked_by)
    VALUES (NULL, v_task_practice, json_build_object('tenantId', v_tenant_a::text, 'zz', '0164')::json, 6, 6, NULL, NULL)
    RETURNING id INTO j_dead;
    INSERT INTO graphile_worker._private_jobs (job_queue_id, task_id, payload, attempts, max_attempts)
    VALUES (NULL, v_task_practice, json_build_object('tenantId', v_tenant_b::text, 'zz', '0164')::json, 1, 6)
    RETURNING id INTO j_live;
    -- ★ queueNameFor lower-cases the id; an upper-case payload must land on the SAME queue as j_dead,
    --   or "Retry now" would compare 't:ABC…' with 't:abc…' and refuse exactly as before.
    INSERT INTO graphile_worker._private_jobs (job_queue_id, task_id, payload, attempts, max_attempts)
    VALUES (NULL, v_task_practice, json_build_object('tenantId', upper(v_tenant_a::text), 'zz', '0164')::json, 2, 6)
    RETURNING id INTO j_upper;
    -- ★★ THE PLATFORM-WIDE ROW CARRIES A tenantId ON PURPOSE. `queueNameFor` asks
    --    `PLATFORM_WIDE_JOBS.has(name)` FIRST and returns null without ever looking at the payload
    --    (src/queue/jobPolicy.mjs:288). A fixture whose platform job had no tenantId would be excluded
    --    by the payload filter instead of by the task-name filter, and the task-name filter — the one
    --    that matches the product — would be untested. MEASURED: with this row, deleting the
    --    `t.identifier NOT IN (…)` clause from the UPDATE makes this self-test fail; without it, it does not.
    INSERT INTO graphile_worker._private_jobs (job_queue_id, task_id, payload, attempts, max_attempts)
    VALUES (NULL, v_task_platform, json_build_object('tenantId', v_tenant_a::text, 'zz', '0164')::json, 3, 6)
    RETURNING id INTO j_platform;
    INSERT INTO graphile_worker._private_jobs (job_queue_id, task_id, payload, attempts, max_attempts, locked_at, locked_by)
    VALUES (NULL, v_task_practice, json_build_object('tenantId', v_tenant_a::text, 'zz', '0164')::json, 1, 6, now(), 'zz_0164')
    RETURNING id INTO j_locked;
    INSERT INTO graphile_worker._private_jobs (job_queue_id, task_id, payload, attempts, max_attempts)
    VALUES (NULL, v_task_practice, json_build_object('zz', '0164')::json, 4, 6)
    RETURNING id INTO j_notenant;

    -- ★★ THE SAME TWO STATEMENTS AS §1. (Kept in step by test/s4_queue_cutover.test.mjs, which runs
    --    §1's text verbatim against rows of this same shape.)
    INSERT INTO graphile_worker._private_job_queues (queue_name)
    SELECT DISTINCT 't:' || lower(j.payload ->> 'tenantId')
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
     WHERE j.job_queue_id IS NULL
       AND j.locked_at IS NULL
       AND t.identifier NOT IN ('sweep_tenants', 'watch_system', 'reap_orphan_jobs', 'daily_summary')
       AND j.payload ->> 'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ON CONFLICT (queue_name) DO NOTHING;

    UPDATE graphile_worker._private_jobs j
       SET job_queue_id = q.id
      FROM graphile_worker._private_tasks t,
           graphile_worker._private_job_queues q
     WHERE t.id = j.task_id
       AND j.job_queue_id IS NULL
       AND j.locked_at IS NULL
       AND t.identifier NOT IN ('sweep_tenants', 'watch_system', 'reap_orphan_jobs', 'daily_summary')
       AND j.payload ->> 'tenantId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND q.queue_name = 't:' || lower(j.payload ->> 'tenantId');

    SELECT id INTO q_a FROM graphile_worker._private_job_queues WHERE queue_name = 't:' || lower(v_tenant_a::text);
    SELECT id INTO q_b FROM graphile_worker._private_job_queues WHERE queue_name = 't:' || lower(v_tenant_b::text);

    -- ★★★ THE ASSERTION THAT IS THE FINDING: the DEAD pre-cutover job now reads with the queue the
    --     policy computes, which is the one value `platform_retry_job` will accept.
    SELECT v.queue_name INTO v_qname FROM graphile_worker.jobs v WHERE v.id = j_dead;
    IF v_qname IS DISTINCT FROM 't:' || lower(v_tenant_a::text) THEN
      v_problems := v_problems || format('the dead pre-cutover job reads queue_name %L, expected %L',
                                         v_qname, 't:' || lower(v_tenant_a::text));
    END IF;
    -- ★ and the LIVE one — the case the review says Phase C must confirm in production, not just the dead one.
    SELECT v.queue_name INTO v_qname FROM graphile_worker.jobs v WHERE v.id = j_live;
    IF v_qname IS DISTINCT FROM 't:' || lower(v_tenant_b::text) THEN
      v_problems := v_problems || format('the LIVE pre-cutover job reads queue_name %L, expected %L',
                                         v_qname, 't:' || lower(v_tenant_b::text));
    END IF;
    -- ★ two practices, two queues — not one shared one.
    IF q_a IS NULL OR q_b IS NULL OR q_a = q_b THEN
      v_problems := v_problems || format('two practices did not get two queues (a=%s b=%s)', q_a, q_b);
    END IF;
    -- ★ case: the upper-case payload joined the SAME queue as the lower-case one.
    FOR r IN SELECT job_queue_id FROM graphile_worker._private_jobs WHERE id = j_upper LOOP
      IF r.job_queue_id IS DISTINCT FROM q_a THEN
        v_problems := v_problems || format('an upper-case tenantId landed on queue %s, not %s', r.job_queue_id, q_a);
      END IF;
    END LOOP;
    -- ★★ THE NEGATIVE HALF, three ways. Each of these moving would be its own defect.
    FOR r IN SELECT id, job_queue_id FROM graphile_worker._private_jobs
              WHERE id IN (j_platform, j_locked, j_notenant) LOOP
      IF r.job_queue_id IS NOT NULL THEN
        v_problems := v_problems || format('job %s was given queue %s and should not have been', r.id, r.job_queue_id);
      END IF;
    END LOOP;

    IF array_length(v_problems, 1) IS NOT NULL THEN
      RAISE EXCEPTION '0164 self-test failed: %', array_to_string(v_problems, ' | ');
    END IF;
    RAISE EXCEPTION 'zz_0164_rollback';
  EXCEPTION
    WHEN OTHERS THEN
      SET ROLE app_owner;
      IF SQLERRM <> 'zz_0164_rollback' THEN RAISE; END IF;
  END;

  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0164 finished as % — it must hand back to app_owner', current_user;
  END IF;
END
$selftest$;
