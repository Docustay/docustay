-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- STAGE 4 TASK 10 — "RETRY NOW" AND "GIVE UP…" ON PLATFORM JOBS (07 §4 rule 8, MOCKUPS §20).
--
-- ★★★ F511 LEFT A HOLE ON PURPOSE AND THIS MIGRATION FILLS IT. 0147/0156 let the SYSTEM acknowledge a
--     give-up only when the practice it was queued for is GONE. Every give-up belonging to a LIVE
--     practice therefore stays open until A PERSON looks at it — and until now there was no way for a
--     person to do either thing the screen offers: put the job back on the queue, or say "I have dealt
--     with this, and here is why". Four functions, two owners, one gate.
--
-- ★★★ THE GATE IS `keystone.caller_is_platform()`, INSIDE EVERY FUNCTION, evaluated by the database on
--     every call — the same shape 0106/0138/0156 use for the READS. The route checks it too
--     (src/routes/writes.mjs, section /platform/jobs + super_admin_1), but a route check is one
--     `if`; this one cannot be routed around. A practice's own context gets a REFUSAL here rather than
--     zero rows, because unlike a list these are WRITES: silence would read as success.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THERE ARE TWO OWNERS, AND WHY THAT IS NOT AN ACCIDENT OF HISTORY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--   · `keystone_meta.job_failure` (the give-up ledger) is owned by **app_owner**.
--   · `graphile_worker._private_jobs` (the queue) is owned by **keystone_admin**, has RLS enabled with
--     ONE policy — for `app_worker` — and grants `arwd` to `app_worker` only.
--   · [MEASURED, pg_roles] **app_owner has rolinherit = false.** It is a member of auth_owner and
--     inherits NOTHING from it: an app_owner-owned definer cannot use the auth_owner grants 0107 made.
--   So a single owner would mean giving ONE role both the ledger and the queue. Instead:
--       keystone_meta.platform_job_retry_target   → app_owner  (reads the ledger)
--       keystone_meta.acknowledge_job_failure      → app_owner  (writes the ledger)
--       keystone.platform_job_queue_row            → auth_owner (reads the queue row)
--       keystone.platform_retry_job                → auth_owner (re-queues that one job)
--   ★ `app_rw` — the role every HTTP request runs as — gains EXECUTE on these four and NOTHING else.
--     p21a_role_matrix's subject (the request role reaches neither the queue schema nor the tenant
--     lister) stays true, and is asserted again at the bottom of this file.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ "RE-QUEUES THE JOB WITH THE SAME KEY" IS AN IN-PLACE RESET, NOT A SECOND add_job, AND THAT IS
--     THE WHOLE SAFETY ARGUMENT.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--   graphile's own `add_jobs` resolves a key collision with `ON CONFLICT (key) DO UPDATE SET attempts =
--   0, last_error = null, max_attempts = excluded.max_attempts, run_at = excluded.run_at … WHERE
--   jobs.locked_at IS NULL` [MEASURED, graphile-worker 0.18 dist/sql/addJobs.js]. `platform_retry_job`
--   performs EXACTLY that update and nothing else. It therefore:
--     · cannot create a second job (07 §4: one run, not two);
--     · cannot change the payload, the task, the key, the priority or the queue;
--     · cannot touch a job a worker currently holds (`locked_at IS NULL`, enforced twice — in the
--       function body AND in the RLS policy below, so a bug in the body still cannot do it);
--     · needs INSERT on nothing, so `auth_owner` is never granted the ability to put work on the queue.
--   ★ A job graphile has already REAPED cannot be retried: its payload is gone. The function says so
--     plainly (`42704`), and that is honest — inventing a payload to re-add would be worse than a
--     refusal a person can read.
--
-- ★★ THE `max_attempts` AND QUEUE NAME ARE PASSED IN, NOT CHOSEN HERE, because the application's own
--    `addJobWithPolicy` (src/queue/jobPolicy.mjs) is what must choose them — the brief says the retry
--    goes THROUGH it. The function then REFUSES any queue name that is not the row's own, so the
--    caller cannot use this to move a job between tenant queues.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · THE CROSSING — auth_owner reaches the queue row, and `app_rw` still does not
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ 0107's pattern, extended by exactly what the write needs. `RESET ROLE` because migrations run as
--   app_owner and these objects belong to the queue's owner; ownership is environment state (0105), so
--   nothing here names it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RAISE NOTICE 'graphile_worker schema absent — nothing to grant';
    RETURN;
  END IF;

  RESET ROLE;

  -- ★★ THE VIEW graphile_worker.jobs DOES NOT CARRY `payload` [MEASURED, its definition]. The retry has
  --    to hand the job's REAL payload to addJobWithPolicy so the queue name and the attempt budget are
  --    recomputed from the truth rather than from something the caller typed — so the private table is
  --    read directly. SELECT only.
  GRANT SELECT ON graphile_worker._private_jobs TO auth_owner;
  -- ★★★ FIVE COLUMNS. Not the table. A column-level UPDATE means that even with a hole in the function
  --     body, auth_owner cannot rewrite a payload, retarget a task, move a queue or change a key.
  --   ★★ `updated_at` is in the list because graphile's own add_jobs sets it on the SAME statement, and
  --      a column-level grant is checked per column WRITTEN: leaving it out made the whole UPDATE fail
  --      with "permission denied for table _private_jobs" [EXECUTED], which reads like a missing table
  --      grant and is not. It is bookkeeping — it says nothing about what the job IS.
  GRANT UPDATE (attempts, last_error, run_at, max_attempts, updated_at)
    ON graphile_worker._private_jobs TO auth_owner;

  -- ★★ AND RLS IS ON (relrowsecurity = true) WITH ONLY AN app_worker POLICY, so the grants alone would
  --    yield ZERO ROWS — a retry that silently did nothing, which is the worst possible failure here.
  --    Two policies, separated so the write is narrower than the read.
  DROP POLICY IF EXISTS platform_may_read_a_job_to_retry_it ON graphile_worker._private_jobs;
  CREATE POLICY platform_may_read_a_job_to_retry_it ON graphile_worker._private_jobs
    FOR SELECT TO auth_owner USING (true);
  -- ★★★ THE RESET STATE IS IN THE POLICY, NOT ONLY IN THE FUNCTION. WITH CHECK means the database
  --     itself refuses any UPDATE that does not leave the row at attempts = 0 with no error, and USING
  --     means a job a worker holds cannot be touched at all.
  DROP POLICY IF EXISTS platform_may_requeue_a_job_it_gave_up_on ON graphile_worker._private_jobs;
  CREATE POLICY platform_may_requeue_a_job_it_gave_up_on ON graphile_worker._private_jobs
    FOR UPDATE TO auth_owner
    USING (locked_at IS NULL)
    WITH CHECK (locked_at IS NULL AND attempts = 0 AND last_error IS NULL);

  -- ★★★ BOTH HALVES ASSERTED (0107's rule): the definer gained what it needs AND the request role still
  --     has nothing. Checking one would let the boundary reopen silently.
  IF NOT has_table_privilege('auth_owner', 'graphile_worker._private_jobs', 'SELECT')
     OR NOT has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'attempts', 'UPDATE')
     OR NOT has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'last_error', 'UPDATE')
     OR NOT has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'run_at', 'UPDATE')
     OR NOT has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'max_attempts', 'UPDATE')
     OR NOT has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'updated_at', 'UPDATE') THEN
    RAISE EXCEPTION '0160: auth_owner cannot read or reset a queue row — the retry is a bridge to nowhere';
  END IF;
  -- ★ The columns it must NOT have. A table-wide GRANT UPDATE would pass the four checks above.
  IF has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'payload', 'UPDATE')
     OR has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'key', 'UPDATE')
     OR has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'task_id', 'UPDATE')
     OR has_column_privilege('auth_owner', 'graphile_worker._private_jobs', 'job_queue_id', 'UPDATE') THEN
    RAISE EXCEPTION '0160: auth_owner can rewrite a job payload, key, task or queue — the UPDATE grant is too wide';
  END IF;
  IF has_table_privilege('auth_owner', 'graphile_worker._private_jobs', 'INSERT')
     OR has_table_privilege('auth_owner', 'graphile_worker._private_jobs', 'DELETE') THEN
    RAISE EXCEPTION '0160: auth_owner can add or remove queue rows — a retry must only reset an existing one';
  END IF;
  IF has_schema_privilege('app_rw', 'graphile_worker', 'USAGE')
     OR has_table_privilege('app_rw', 'graphile_worker._private_jobs', 'SELECT') THEN
    RAISE EXCEPTION '0160: app_rw reached the queue — 0106 revoked this and something put it back';
  END IF;
  -- ★★★ AND GIVE THE ROLE BACK. 0107 could end on RESET ROLE because it was the last statement in the
  --     file; this migration goes on to CREATE four functions whose OWNER decides what they can reach.
  --     Leaving the connection as the superuser would silently make them superuser-owned definers.
  SET ROLE app_owner;
  RAISE NOTICE '0160: auth_owner may read a job and reset four of its columns; app_rw still has nothing';
END $$;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0160: the role was not given back after the queue grants — running as %, not app_owner', current_user;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · THE LEDGER READ — which job does this ledger row stand for, and is it still as it was?
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE STALENESS CHECK IS PROGRESS.MD M-3, HANDED TO THIS TASK FROM TASK 8's FIX ROUND. The person
--     acts on a row they LOADED. Between the load and the click the row can repeat (0156 counts a new
--     give-up of the same kind onto it) — so the reason they typed may be about a smaller problem than
--     the one they are now closing. Both actions therefore carry the version they saw (repeat_count and
--     last_seen_at) and are REFUSED if it moved. ★ The person re-reads and decides again; nothing is
--     lost, and nobody accidentally acknowledges a failure they never saw.
CREATE OR REPLACE FUNCTION keystone_meta.platform_job_retry_target(
  p_failure_id bigint, p_repeat_count int, p_last_seen_at timestamptz)
RETURNS TABLE (job_id bigint, task_identifier text, job_created_at timestamptz, tenant_id uuid,
               repeat_count int, last_seen_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r record;
BEGIN
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION 'platform_job_retry_target: only platform staff may act on the job queue'
      USING ERRCODE = '42501';
  END IF;
  SELECT f.job_id, f.task_identifier, f.job_created_at, f.tenant_id, f.repeat_count, f.last_seen_at,
         f.acknowledged_at
    INTO r
    FROM keystone_meta.job_failure f
   WHERE f.id = p_failure_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_job_retry_target: there is no give-up numbered %', p_failure_id
      USING ERRCODE = '42704';
  END IF;
  IF r.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION 'platform_job_retry_target: give-up % has already been dealt with', p_failure_id
      USING ERRCODE = '42501';
  END IF;
  -- ★★★ M-3.
  -- ★★ THE TIME IS COMPARED TO THE MILLISECOND, ON BOTH SIDES, AND THAT IS A CORRECTNESS FIX RATHER
  --    THAN A LOOSENING. `last_seen_at` is `timestamptz` (microseconds); the value the person holds
  --    made the round trip through JSON, where a timestamp is a JavaScript Date and a JavaScript Date
  --    IS milliseconds — there is no representation for the remaining digits. Comparing raw would
  --    therefore refuse EVERY acknowledgement, including the ones that are perfectly current, which is
  --    not a staleness check but an outage. ★ Nothing is lost: 0156 bumps `repeat_count` on the SAME
  --    statement that moves `last_seen_at`, so two repeats inside one millisecond are still caught by
  --    the count. The truncation is applied to BOTH sides so the comparison is symmetric.
  IF p_repeat_count IS DISTINCT FROM r.repeat_count
     OR pg_catalog.date_trunc('milliseconds', p_last_seen_at)
        IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', r.last_seen_at) THEN
    RAISE EXCEPTION 'platform_job_retry_target: this give-up changed while it was on screen — reload Platform Jobs and look again'
      USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT r.job_id, r.task_identifier, r.job_created_at, r.tenant_id, r.repeat_count, r.last_seen_at;
END $$;

REVOKE ALL ON FUNCTION keystone_meta.platform_job_retry_target(bigint, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.platform_job_retry_target(bigint, int, timestamptz) TO app_rw;
COMMENT ON FUNCTION keystone_meta.platform_job_retry_target(bigint, int, timestamptz) IS
  'Stage 4 Task 10 / 0160 — the job identity behind an unacknowledged give-up, for Platform Jobs'' Retry now and Give up… buttons. Gated on caller_is_platform(); refuses a row that is missing, already acknowledged, or whose repeat_count/last_seen_at moved since the person loaded it (progress.md M-3). Owned by app_owner. EXECUTE to app_rw only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · THE QUEUE READ — the job as it stands, including the payload the policy needs
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ CREATED **AS auth_owner**, NOT CREATED AND THEN HANDED OVER, AND THAT IS NOT A STYLE CHOICE.
--     [EXECUTED] `ALTER FUNCTION … OWNER TO auth_owner` after the fact fails one step earlier: Postgres
--     PARSES a SQL-language body at CREATE time, so app_owner — which has nothing on the queue schema
--     and, with rolinherit = false, inherits nothing from auth_owner either — cannot even write the
--     statement down ("permission denied for schema graphile_worker"). Becoming the owner first makes
--     the creation, the ownership and the grants one consistent act.
SET ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.platform_job_queue_row(
  p_job_id bigint, p_task text, p_job_created_at timestamptz)
RETURNS TABLE (payload json, job_key text, attempts int, max_attempts int,
               locked_at timestamptz, queue_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  -- ★★ THE TASK NAME AND THE QUEUE NAME COME FROM graphile's OWN VIEW, not from its private tables.
  --    [EXECUTED] _private_tasks and _private_job_queues are RLS-enabled with a policy for app_worker
  --    ONLY, so reading them would need two more grants and two more policies. The view already
  --    resolves both joins and auth_owner has read it since 0107 — one grant, already made, already
  --    asserted. Only `payload`, which the view does not carry, comes from the private table.
  SELECT p.payload, v.key, v.attempts::int, v.max_attempts::int, v.locked_at, v.queue_name
    FROM graphile_worker.jobs v
    JOIN graphile_worker._private_jobs p ON p.id = v.id
   -- ★★★ THE WHOLE IDENTITY (F510), not the id: graphile reuses nothing, but a ledger row outlives its
   --     job, and reading "job 41" after 41 was reaped and a different 41 created would retry a
   --     stranger's work. The task and the creation time make that impossible.
   WHERE v.id = p_job_id AND v.task_identifier = p_task AND v.created_at = p_job_created_at
     AND keystone.caller_is_platform()
$$;

REVOKE ALL ON FUNCTION keystone.platform_job_queue_row(bigint, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_job_queue_row(bigint, text, timestamptz) TO app_rw;
COMMENT ON FUNCTION keystone.platform_job_queue_row(bigint, text, timestamptz) IS
  'Stage 4 Task 10 / 0160 — one queue row by its whole identity (id, task, created_at — F510), with the payload the application''s job policy needs to recompute the queue name and attempt budget. Gated inside on caller_is_platform(): any other context gets zero rows, like the other platform readers. A reaped job simply is not there. Owned by auth_owner. EXECUTE to app_rw only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · THE RE-QUEUE — graphile's own ON CONFLICT branch, and nothing else
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.platform_retry_job(
  p_job_id bigint, p_task text, p_job_created_at timestamptz,
  p_key text, p_max_attempts int, p_queue_name text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r record; v_id bigint;
BEGIN
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION 'platform_retry_job: only platform staff may put a job back on the queue'
      USING ERRCODE = '42501';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'platform_retry_job: a retry needs an attempt budget of at least 1 (got %)', p_max_attempts
      USING ERRCODE = '22023';
  END IF;

  -- ★ The same read as platform_job_queue_row. The identity comes from the view, which resolves the
  --   task name and the queue name that live in RLS'd private tables.
  -- ★★★ NOT `FOR UPDATE`, AND THE REASON IS THE COLUMN-LEVEL GRANT THIS MIGRATION DELIBERATELY MADE.
  --     [EXECUTED] `SELECT … FOR UPDATE` asks Postgres for ACL_UPDATE **on the relation**, and a
  --     column-level `GRANT UPDATE (attempts, last_error, run_at, max_attempts)` does not satisfy a
  --     relation-level check: the lock fails with "permission denied for table _private_jobs". The
  --     only way to keep the lock would be a table-wide GRANT UPDATE — which would hand auth_owner the
  --     payload, the key, the task and the queue, i.e. exactly the four columns §1 refuses to give it.
  --     ★★ So the ROW LOCK IS THE UPDATE ITSELF (below): `locked_at IS NULL` and the key are part of
  --        its WHERE clause, so a worker that claims the job between this read and that statement makes
  --        the statement match zero rows and the retry is refused, rather than being applied to a job
  --        somebody is already running. The RLS policy's own `USING (locked_at IS NULL)` is re-evaluated
  --        on the current row for the same reason. The read below is only for the sentences a person
  --        reads — which failure it was — and a read that is a moment stale can only produce a friendlier
  --        message for a refusal the UPDATE makes anyway.
  SELECT v.id, v.key, v.locked_at, v.queue_name
    INTO r
    FROM graphile_worker.jobs v
    JOIN graphile_worker._private_jobs p ON p.id = v.id
   WHERE v.id = p_job_id AND v.task_identifier = p_task AND v.created_at = p_job_created_at;
  IF NOT FOUND THEN
    -- ★ Honest, and a person can read it: graphile deletes a job when it succeeds or is reaped, and the
    --   payload goes with it. There is nothing left to put back.
    RAISE EXCEPTION 'platform_retry_job: that job is no longer on the queue, so there is nothing to retry'
      USING ERRCODE = '42704';
  END IF;
  IF r.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'platform_retry_job: a worker is running that job right now — wait for it to finish'
      USING ERRCODE = '55006';
  END IF;
  -- ★★ THE KEY AND THE QUEUE ARE VERIFIED, NEVER WRITTEN. `IS NOT DISTINCT FROM` so a keyless or
  --    queueless job matches on NULL rather than failing every comparison.
  IF r.key IS DISTINCT FROM p_key THEN
    RAISE EXCEPTION 'platform_retry_job: the job key does not match the job — a retry may not change a key'
      USING ERRCODE = '22023';
  END IF;
  IF r.queue_name IS DISTINCT FROM p_queue_name THEN
    RAISE EXCEPTION 'platform_retry_job: the queue name does not match the job — a retry may not move a job between queues'
      USING ERRCODE = '22023';
  END IF;

  -- ★★★ graphile-worker 0.18's own key-collision branch, verbatim in effect.
  -- ★★ AND THE WHOLE PREDICATE IS IN THIS ONE STATEMENT, not spread across the checks above: the key
  --    is verified again here so the write is atomic against anything that could have moved since the
  --    read, and `locked_at IS NULL` is what makes a worker's claim win the race instead of losing it.
  UPDATE graphile_worker._private_jobs
     SET attempts = 0, last_error = NULL, run_at = pg_catalog.now(),
         max_attempts = p_max_attempts, updated_at = pg_catalog.now()
   WHERE id = p_job_id AND locked_at IS NULL AND key IS NOT DISTINCT FROM p_key
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'platform_retry_job: a worker took that job while it was being retried — try again'
      USING ERRCODE = '55006';
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION keystone.platform_retry_job(bigint, text, timestamptz, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_retry_job(bigint, text, timestamptz, text, int, text) TO app_rw;
COMMENT ON FUNCTION keystone.platform_retry_job(bigint, text, timestamptz, text, int, text) IS
  'Stage 4 Task 10 / 0160 — Platform Jobs'' "Retry now": resets one existing queue row to attempts = 0, no error, due now, with the attempt budget the application''s job policy chose — graphile''s own add_jobs ON CONFLICT (key) DO UPDATE branch and nothing more. Never inserts, never deletes, never changes a payload, task, key or queue (the key and queue are verified against the row and refused if they differ), and never touches a job a worker holds. Gated on caller_is_platform(). Owned by auth_owner. EXECUTE to app_rw only.';

-- ★ Back to the migration's own role; §5 belongs to the ledger's owner.
SET ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §5 · THE ACKNOWLEDGEMENT — "Give up…", by a named person, with a reason
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THIS IS THE PERSON-SHAPED HALF OF F511. `record_job_failure`'s system branch may acknowledge only
--     a give-up whose practice is GONE (0147/0156, untouched here). This one is the opposite case and
--     is deliberately unable to impersonate it: `acknowledged_by` is a uuid the ROUTE takes from the
--     session (src/routes/writes.mjs binds actorUserId from the principal, never from the body), and
--     the table's own CHECK already refuses a partial acknowledgement or a blank reason.
CREATE OR REPLACE FUNCTION keystone_meta.acknowledge_job_failure(
  p_failure_id bigint, p_user_id uuid, p_reason text, p_repeat_count int, p_last_seen_at timestamptz)
RETURNS TABLE (failure_id bigint, tenant_id uuid, task_identifier text, repeat_count int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r record;
BEGIN
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION 'acknowledge_job_failure: only platform staff may acknowledge a give-up'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'acknowledge_job_failure: a give-up is acknowledged BY somebody — no person was named'
      USING ERRCODE = '22023';
  END IF;
  -- ★★ THE REASON IS THE POINT OF THE BUTTON. 07 §4 rule 8: "Give up… requires a reason." Whitespace is
  --    not a reason, and the table's CHECK says so too — this raises the sentence a person can read.
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'acknowledge_job_failure: say why you are giving up on this — the reason is kept with the record'
      USING ERRCODE = '22023';
  END IF;

  SELECT f.id, f.tenant_id, f.task_identifier, f.repeat_count, f.last_seen_at, f.acknowledged_at
    INTO r
    FROM keystone_meta.job_failure f
   WHERE f.id = p_failure_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'acknowledge_job_failure: there is no give-up numbered %', p_failure_id
      USING ERRCODE = '42704';
  END IF;
  IF r.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION 'acknowledge_job_failure: give-up % has already been acknowledged', p_failure_id
      USING ERRCODE = '42501';
  END IF;
  -- ★★★ M-3, the same check as the read, taken again under the row lock: between the read and here the
  --     row can still repeat. Holding FOR UPDATE and re-checking is what makes it a race-free refusal
  --     rather than a race-free-looking one.
  --     ★ Millisecond granularity on both sides, for the reason spelled out in platform_job_retry_target.
  IF p_repeat_count IS DISTINCT FROM r.repeat_count
     OR pg_catalog.date_trunc('milliseconds', p_last_seen_at)
        IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', r.last_seen_at) THEN
    RAISE EXCEPTION 'acknowledge_job_failure: this give-up changed while it was on screen — reload Platform Jobs and look again'
      USING ERRCODE = '40001';
  END IF;

  UPDATE keystone_meta.job_failure
     SET acknowledged_at = pg_catalog.now(), acknowledged_by = p_user_id::text, acknowledge_reason = p_reason
   WHERE id = p_failure_id;

  RETURN QUERY SELECT r.id, r.tenant_id, r.task_identifier, r.repeat_count;
END $$;

REVOKE ALL ON FUNCTION keystone_meta.acknowledge_job_failure(bigint, uuid, text, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.acknowledge_job_failure(bigint, uuid, text, int, timestamptz) TO app_rw;
COMMENT ON FUNCTION keystone_meta.acknowledge_job_failure(bigint, uuid, text, int, timestamptz) IS
  'Stage 4 Task 10 / 0160 — Platform Jobs'' "Give up…": a named person closes an unacknowledged give-up with a reason (07 §4 rule 8). The PERSON half of F511, whose system half (record_job_failure, gone practices only) is untouched. Requires caller_is_platform(), a user id, a non-blank reason, an open row, and the repeat_count/last_seen_at the person had on screen (progress.md M-3), re-checked under FOR UPDATE. Owned by app_owner. EXECUTE to app_rw only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §6 · ★★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — owners, definer shape, ACLs, and behaviour
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f text; bad text[] := '{}'; p record; grantee text;
  app_owned  text[] := ARRAY['keystone_meta.platform_job_retry_target(bigint,integer,timestamp with time zone)',
                             'keystone_meta.acknowledge_job_failure(bigint,uuid,text,integer,timestamp with time zone)'];
  auth_owned text[] := ARRAY['keystone.platform_job_queue_row(bigint,text,timestamp with time zone)',
                             'keystone.platform_retry_job(bigint,text,timestamp with time zone,text,integer,text)'];
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0160 is running as %, expected app_owner', current_user;
  END IF;

  -- ── owner · prosecdef · proconfig, for all four ──
  FOREACH f IN ARRAY app_owned || auth_owned LOOP
    SELECT pg_get_userbyid(pr.proowner) AS owner, pr.prosecdef, pr.proconfig
      INTO p FROM pg_proc pr WHERE pr.oid = f::regprocedure;
    IF p IS NULL THEN bad := bad || (f || ': does not exist'); CONTINUE; END IF;
    IF NOT p.prosecdef THEN bad := bad || (f || ': is not SECURITY DEFINER'); END IF;
    IF p.proconfig IS NULL OR NOT (p.proconfig @> ARRAY['search_path=""']) THEN
      bad := bad || (f || ': proconfig is ' || coalesce(p.proconfig::text, 'NULL') || ', expected search_path=""');
    END IF;
  END LOOP;
  FOREACH f IN ARRAY app_owned LOOP
    IF (SELECT pg_get_userbyid(pr.proowner) FROM pg_proc pr WHERE pr.oid = f::regprocedure) <> 'app_owner' THEN
      bad := bad || (f || ': is not owned by app_owner');
    END IF;
  END LOOP;
  FOREACH f IN ARRAY auth_owned LOOP
    IF (SELECT pg_get_userbyid(pr.proowner) FROM pg_proc pr WHERE pr.oid = f::regprocedure) <> 'auth_owner' THEN
      bad := bad || (f || ': is not owned by auth_owner — it cannot reach the queue');
    END IF;
  END LOOP;

  -- ── the ACL sweep: app_rw may execute; NOBODY ELSE the application uses may ──
  FOREACH f IN ARRAY app_owned || auth_owned LOOP
    IF NOT has_function_privilege('app_rw', f, 'EXECUTE') THEN
      bad := bad || (f || ': app_rw cannot execute it — the buttons are wired to nothing');
    END IF;
    FOREACH grantee IN ARRAY ARRAY['public', 'app_worker', 'reference_guard'] LOOP
      IF has_function_privilege(grantee, f, 'EXECUTE') THEN
        bad := bad || (f || ': ' || grantee || ' can execute it');
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'0160 self-test failed:\n  %', array_to_string(bad, E'\n  ');
  END IF;
  RAISE NOTICE '0160: four definers, two owners, search_path pinned, EXECUTE to app_rw only';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ THE BEHAVIOUR PROBE. Asserting the ACL is not asserting that the GATE works — 0105 shipped a
--     grant that did nothing and reported success. This runs the real functions in a real
--     non-platform context and in a real platform context, and rolls everything back through a
--     sentinel exception so the migration leaves no fixture behind.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_plat uuid; v_prac uuid; v_user uuid; v_fid bigint; v_borrowed boolean := true;
  v_rc int; v_seen timestamptz; bad text[] := '{}'; ok boolean;
BEGIN
  -- ★★ THE FIXTURE NEEDS TO PLANT A PRACTICE AND A PERSON, and keystone's tables carry FORCED row
  --    security, so the probe runs elevated. ★ The GATE is unaffected: caller_is_platform() reads the
  --    transaction's tenant GUC, not the role. Everything here — including this role change — is undone
  --    by the sentinel below, because a block with an EXCEPTION clause is a subtransaction.
  RESET ROLE;
  SELECT id INTO v_plat FROM keystone.tenant WHERE is_platform LIMIT 1;
  IF v_plat IS NULL THEN
    INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status)
    VALUES ('0160 probe platform', '0160-probe-platform', true, 'UTC', 'active') RETURNING id INTO v_plat;
    v_borrowed := false;
  END IF;
  INSERT INTO keystone.tenant (name, slug, is_platform, timezone, status)
  VALUES ('0160 probe practice', '0160-probe-practice', false, 'UTC', 'active') RETURNING id INTO v_prac;
  -- ★★★ BORROW THE super_admin_1 IF THE DATABASE ALREADY HAS ONE — the same shape as v_plat above.
  --     [MEASURED on production 2026-09-18, Stage 4 Task 14 Phase C] `app_user_single_super_admin_1_idx`
  --     is `UNIQUE (staff_role) WHERE staff_role = 'super_admin_1'` — ONE PER DATABASE, not one per
  --     practice. The first version of this block planted one unconditionally, so it passed on the local
  --     database (0 platform tenants, 0 super_admin_1 — it created both) and rolled 0160 back on
  --     production (1 platform tenant, 1 real super_admin_1) with
  --     "duplicate key value violates unique constraint app_user_single_super_admin_1_idx".
  --   ★★ THE FIXTURE WAS WRONG, NOT THE PRODUCT. Nothing below changes: every assertion, every
  --      refusal and every positive control is the same, and the whole block is still unwound by the
  --      sentinel. The only difference is which person id the probe acknowledges as — and
  --      `acknowledge_job_failure` never reads `app_user` at all (it takes a uuid and stores it), so a
  --      borrowed id exercises exactly the same path a planted one did.
  SELECT id INTO v_user FROM keystone.app_user WHERE staff_role = 'super_admin_1' LIMIT 1;
  IF v_user IS NULL THEN
    INSERT INTO keystone.app_user (tenant_id, display_name, email, role, staff_role)
    VALUES (v_plat, '0160 probe', '0160-probe@example.invalid', 'staff', 'super_admin_1') RETURNING id INTO v_user;
  END IF;

  INSERT INTO keystone_meta.job_failure (job_id, task_identifier, tenant_id, reason, job_created_at)
  VALUES (-160, 'probe_task_0160', v_prac, '0160 probe give-up', pg_catalog.now())
  RETURNING id, repeat_count, last_seen_at INTO v_fid, v_rc, v_seen;

  -- ★ 1 · A PRACTICE'S OWN CONTEXT IS REFUSED — by every one of the four.
  PERFORM set_config('keystone.tenant_id', v_prac::text, true);
  BEGIN PERFORM keystone_meta.platform_job_retry_target(v_fid, v_rc, v_seen);
        bad := bad || 'platform_job_retry_target answered a practice context';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM keystone_meta.acknowledge_job_failure(v_fid, v_user, 'probe', v_rc, v_seen);
        bad := bad || 'acknowledge_job_failure answered a practice context';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM keystone.platform_retry_job(-160, 'probe_task_0160', pg_catalog.now(), NULL, 25, NULL);
        bad := bad || 'platform_retry_job answered a practice context';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM keystone.platform_job_queue_row(-160, 'probe_task_0160', pg_catalog.now())) THEN
    bad := bad || 'platform_job_queue_row returned rows in a practice context';
  END IF;

  -- ★ 2 · THE PLATFORM CONTEXT IS THE POSITIVE CONTROL. Without it, every refusal above would pass on a
  --   database where the functions simply always throw.
  PERFORM set_config('keystone.tenant_id', v_plat::text, true);
  SELECT count(*) = 1 INTO ok FROM keystone_meta.platform_job_retry_target(v_fid, v_rc, v_seen);
  IF NOT ok THEN bad := bad || 'platform_job_retry_target refused the PLATFORM context too'; END IF;

  -- ★ 3 · M-3 refuses a version that moved — and the current one is accepted (control).
  BEGIN PERFORM keystone_meta.platform_job_retry_target(v_fid, v_rc + 1, v_seen);
        bad := bad || 'a stale repeat_count was accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM keystone_meta.acknowledge_job_failure(v_fid, v_user, '   ', v_rc, v_seen);
        bad := bad || 'a blank reason was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT count(*) = 1 INTO ok
    FROM keystone_meta.acknowledge_job_failure(v_fid, v_user, '0160 probe reason', v_rc, v_seen);
  IF NOT ok THEN bad := bad || 'the platform context could not acknowledge an open give-up'; END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure
                  WHERE id = v_fid AND acknowledged_by = v_user::text
                    AND acknowledge_reason = '0160 probe reason' AND acknowledged_at IS NOT NULL) THEN
    bad := bad || 'the acknowledgement did not name the person or keep the reason';
  END IF;
  -- ★ 4 · and a second acknowledgement is refused.
  BEGIN PERFORM keystone_meta.acknowledge_job_failure(v_fid, v_user, 'again', v_rc, v_seen);
        bad := bad || 'a second acknowledgement was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'0160 behaviour probe failed:\n  %', array_to_string(bad, E'\n  ');
  END IF;
  -- ★★ THE SENTINEL: everything above is undone by this exception, which the block below swallows by
  --    name. A probe that left a practice, a person and a ledger row behind would be a fixture in the
  --    production database.
  RAISE EXCEPTION 'keystone_0160_probe_passed';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'keystone_0160_probe_passed' THEN RAISE; END IF;
  RAISE NOTICE '0160: the gate refuses a practice context and admits the platform one; M-3 and the reason are enforced';
END $$;
