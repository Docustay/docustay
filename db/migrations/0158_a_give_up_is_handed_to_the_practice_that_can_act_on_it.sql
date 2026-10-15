-- ★★★ STAGE 4 TASK 8 · FIX ROUND 1 — R69b (replaces R69), I-1 and part of I-3.
--
--     R69 as first worded ("a give-up handed to a practice task counts as handled") carried a CRITICAL trap, found by
--     the Task 8 review: 0156 counts a repeat onto an OPEN row at record time, BEFORE anyone knows whether that
--     give-up's own task will open. A ROW-level acknowledgement would therefore let Sam's task silence Robin's
--     un-owned failure, and a revoked Resend key would open "check the address" tasks everywhere AND turn the queue
--     check green — F511's harm by another route. R69b is the design that cannot do either:
--
--   ★★★ 1 · THE HAND-OFF IS PER GIVE-UP, NOT PER ROW. Both the counting row's OWN identity (job_failure) and each
--       counted repeat's identity (job_failure_repeat) carry their own handed_off_task_id. The queue check counts a
--       row while it is unacknowledged AND any one of its identities has not been handed off. Robin's give-up keeps
--       the check red however many of Sam's repeats found a task.
--   ★★★ 2 · IT IS NOT AN ACKNOWLEDGEMENT. `acknowledged_at` is untouched, so "acknowledged" still means "a person or
--       the system closed it" and 0156's repeat logic is unchanged. F511 stays closed: `record_job_failure`'s
--       system-acknowledgement branch (gone practices only, 0147/0156) is not edited by this migration at all.
--   ★★★ 3 · THE WRITER IS NEW AND NARROW. keystone_meta.hand_off_job_failure(job_id, task, job_created_at, task_id)
--       reads the practice from the LEDGER ROW ITSELF (never from the caller's argument), refuses unless that
--       practice is the caller's own, and refuses unless an OPEN keystone.task with that id exists in that practice
--       with topic 'jobs.<task>.gave_up'. It is called from the app_rw transaction that opens the task, so the task
--       and its hand-off commit together or not at all; if the task never opens, the row stays un-handed-off and the
--       queue check stays red, which is the correct fail-loud default.
--       ★ EXECUTE to app_rw only (the role withTenant runs as). app_worker is NOT granted it: the worker never opens
--         a practice task, and a hand-off must never be writable from the connection that records the give-up.
--
--   ★★ 4 · I-1 — the owner is chosen by job type AND failure kind, and a listener death needs the kind too. The
--       dispatcher already classifies every listener failure (src/queue/tasks.mjs, classifyFailure) but threw the
--       classification away after using its `retryable` flag; keystone.event_delivery.failure_kind now keeps it, so
--       the dead-listener sweep can ask the same question the job path asks. NULL means "not recorded / in doubt",
--       which src/queue/giveUpOwners.mjs treats as platform-owned — the Platform Jobs entry is always written, so
--       "in doubt" is never silent, only never a misleading practice task.
--
--   ★★ 5 · I-3 — Platform Jobs needs to know whether every identity of a row has been handed off, so it can say
--       "handed to the practice" only when that is true of the WHOLE row. platform_list_job_failures() is dropped
--       and recreated (its RETURNS TABLE changes) with two extra counts; the gate on caller_is_platform(), the
--       owner, search_path and the app_rw-only EXECUTE are exactly as 0156 left them.
--
-- ★ Nothing here grants app_worker anything new: it keeps zero table rights and still reaches the ledger only
--   through record_job_failure / job_failure_health, whose signatures and grants are unchanged (asserted below).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · the failure kind a listener died of (I-1)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.event_delivery
  ADD COLUMN failure_kind text
    CONSTRAINT event_delivery_failure_kind_check CHECK (
      failure_kind IS NULL OR failure_kind IN (
        'validation', 'unauthenticated', 'forbidden', 'not_found', 'conflict',
        'rate_limited', 'dependency', 'timeout', 'internal'));

-- ★★ THE REOPEN EDGE (review M-6). reportGaveUps runs AFTER the tenant transaction commits, so a crash between the
--    commit and markGaveUpReported leaves gave_up_reported_at NULL and gave_up_report_attempts 0 — and the next sweep
--    ran the owner loop over the SAME dead row again. If the practice had meanwhile closed the task, that reopened it:
--    a task somebody had already dealt with came back, from a retry of a report that has nothing to do with them.
--    This column is written INSIDE the tenant transaction, so "the owner loop has considered this death" commits with
--    the death itself and the loop runs exactly once per dead delivery, whatever the report does afterwards.
ALTER TABLE keystone.event_delivery ADD COLUMN gave_up_owned_at timestamptz;

COMMENT ON COLUMN keystone.event_delivery.gave_up_owned_at IS
  'Stage 4 Task 8 fix 1 / 0158 (review M-6) — when the dead-listener owner loop considered this death, whether or not a task was opened. Set in the same transaction as the death, so a retried job.gave_up report can never run the owner loop a second time and reopen a task the practice has already closed.';

COMMENT ON COLUMN keystone.event_delivery.failure_kind IS
  'Stage 4 Task 8 fix 1 / 0158 (review I-1) — the ErrorKind (src/http/errors.mjs) of the LAST failure recorded on this listener, as the dispatcher''s own classifyFailure judged it. Read by the dead-listener sweep to decide whether the practice can act on the death (src/queue/giveUpOwners.mjs). NULL = not recorded or not classifiable, which is treated as platform-owned: the job.gave_up fact on Platform Jobs is always written, so nothing is hidden — only no misleading practice task is opened.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · the hand-off, per give-up identity (R69b, C-R69-1)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone_meta.job_failure
  ADD COLUMN handed_off_task_id uuid,
  ADD COLUMN handed_off_at      timestamptz,
  ADD CONSTRAINT job_failure_hand_off_complete CHECK (
    (handed_off_task_id IS NULL) = (handed_off_at IS NULL));
ALTER TABLE keystone_meta.job_failure_repeat
  ADD COLUMN handed_off_task_id uuid,
  ADD COLUMN handed_off_at      timestamptz,
  ADD CONSTRAINT job_failure_repeat_hand_off_complete CHECK (
    (handed_off_task_id IS NULL) = (handed_off_at IS NULL));

COMMENT ON COLUMN keystone_meta.job_failure.handed_off_task_id IS
  'Stage 4 Task 8 fix 1 / 0158 (R69b) — the OPEN keystone.task this row''s OWN give-up was handed to, in its own practice. Written only by keystone_meta.hand_off_job_failure(). It is NOT an acknowledgement: acknowledged_at is untouched, and the queue check still counts this row while ANY of its identities (this one, or a counted repeat) has no hand-off.';
COMMENT ON COLUMN keystone_meta.job_failure_repeat.handed_off_task_id IS
  'Stage 4 Task 8 fix 1 / 0158 (R69b) — the OPEN keystone.task THIS counted repeat was handed to. Per-identity, because 0156 counts a repeat onto the open row before anyone knows whether its own task will open: a row-level hand-off would let one recipient''s task silence another''s un-owned failure.';

-- ★ The queue check reads "is any identity of this row still un-handed-off"; the repeat side of that is a
--   per-failure lookup, which job_failure_repeat_by_failure (0156) already serves.
CREATE INDEX job_failure_open_unhanded
  ON keystone_meta.job_failure (id) WHERE acknowledged_at IS NULL AND handed_off_task_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · the narrow writer (C-R69-3) — a new function, never p_acknowledged = true
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.hand_off_job_failure(
  p_job_id bigint, p_task text, p_job_created_at timestamptz, p_task_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_failure_id bigint;
  v_tenant     uuid;
  v_repeat     boolean := false;
  v_ctx        uuid := keystone.current_tenant_id();
  v_topic      text  := 'jobs.' || p_task || '.gave_up';
BEGIN
  IF p_task_id IS NULL OR p_job_created_at IS NULL OR NOT pg_catalog.isfinite(p_job_created_at) THEN
    RAISE EXCEPTION 'hand_off_job_failure: a task id and the job''s own created_at are both required (got task %, created_at %)',
      p_task_id, p_job_created_at USING ERRCODE = '22023';
  END IF;
  -- ★★ The practice is read from the LEDGER ROW, never from the caller — but the caller must already BE that
  --    practice, so the task read below runs under that practice's own FORCE-RLS policy on keystone.task.
  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'hand_off_job_failure: there is no practice context, so no practice task can be proved to exist'
      USING ERRCODE = '42501';
  END IF;

  SELECT f.id, f.tenant_id INTO v_failure_id, v_tenant
    FROM keystone_meta.job_failure f
   WHERE f.job_id = p_job_id AND f.task_identifier = p_task AND f.job_created_at = p_job_created_at
   FOR UPDATE;
  IF v_failure_id IS NULL THEN
    -- ★ Recorded as a REPEAT counted on an earlier row: the practice comes from the counting row, the hand-off
    --   is written on this repeat's own identity (C-R69-1).
    SELECT r.failure_id, c.tenant_id INTO v_failure_id, v_tenant
      FROM keystone_meta.job_failure_repeat r
      JOIN keystone_meta.job_failure c ON c.id = r.failure_id
     WHERE r.job_id = p_job_id AND r.task_identifier = p_task AND r.job_created_at = p_job_created_at
     FOR UPDATE OF r;
    v_repeat := v_failure_id IS NOT NULL;
  END IF;
  IF v_failure_id IS NULL THEN
    RAISE EXCEPTION 'hand_off_job_failure: no give-up is recorded for job % (task %, created %), so there is nothing to hand off',
      p_job_id, p_task, p_job_created_at USING ERRCODE = '42704';
  END IF;
  IF v_tenant IS NULL OR v_tenant IS DISTINCT FROM v_ctx THEN
    RAISE EXCEPTION 'hand_off_job_failure: the give-up for job % belongs to practice %, not to the caller''s practice % — a hand-off may only be recorded by the practice whose task it is',
      p_job_id, v_tenant, v_ctx USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone.task t
                  WHERE t.id = p_task_id AND t.tenant_id = v_tenant
                    AND t.topic = v_topic AND t.closed_at IS NULL) THEN
    RAISE EXCEPTION 'hand_off_job_failure: task % is not an OPEN task with topic % in practice % — a give-up may only be handed to a task that is actually there for somebody to do',
      p_task_id, v_topic, v_tenant USING ERRCODE = '42501';
  END IF;

  IF v_repeat THEN
    UPDATE keystone_meta.job_failure_repeat
       SET handed_off_task_id = p_task_id, handed_off_at = pg_catalog.now()
     WHERE job_id = p_job_id AND task_identifier = p_task AND job_created_at = p_job_created_at
       AND handed_off_task_id IS NULL;
  ELSE
    UPDATE keystone_meta.job_failure
       SET handed_off_task_id = p_task_id, handed_off_at = pg_catalog.now()
     WHERE id = v_failure_id AND handed_off_task_id IS NULL;
  END IF;
END $$;

REVOKE ALL ON FUNCTION keystone_meta.hand_off_job_failure(bigint, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.hand_off_job_failure(bigint, text, timestamptz, uuid) TO app_rw;

COMMENT ON FUNCTION keystone_meta.hand_off_job_failure(bigint, text, timestamptz, uuid) IS
  'Stage 4 Task 8 fix 1 / 0158 (R69b) — record that ONE give-up (a ledger row''s own identity, or one counted repeat) was handed to an OPEN task in its own practice. Reads the practice from the ledger row, refuses any other practice''s row, and refuses unless an open keystone.task with that id and topic jobs.<task>.gave_up exists there. Never writes acknowledged_at (F511 stays closed). EXECUTE to app_rw only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · the queue check — a row is still a problem while ANY of its give-ups has no owner
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone_meta.job_failure_health(
  p_dead_job_ids bigint[], p_dead_tasks text[], p_dead_created timestamptz[])
RETURNS TABLE (unacknowledged int, unrecorded int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (SELECT pg_catalog.count(*)::int
            FROM keystone_meta.job_failure f
           WHERE f.acknowledged_at IS NULL
             -- ★★★ R69b: handed off means a person in the practice owns it — but only if EVERY give-up counted on
             --     this row was handed off. One un-owned give-up keeps the whole row red (C-R69-1).
             AND (f.handed_off_task_id IS NULL
                  OR EXISTS (SELECT 1 FROM keystone_meta.job_failure_repeat r
                              WHERE r.failure_id = f.id AND r.handed_off_task_id IS NULL))),
         (SELECT pg_catalog.count(*)::int
            FROM (SELECT DISTINCT d.id, d.task, d.created
                    FROM ROWS FROM (pg_catalog.unnest(coalesce(p_dead_job_ids, '{}'::bigint[])),
                                    pg_catalog.unnest(coalesce(p_dead_tasks, '{}'::text[])),
                                    pg_catalog.unnest(coalesce(p_dead_created, '{}'::timestamptz[])))
                         AS d(id, task, created)) d
           WHERE NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure f
                              WHERE f.job_id = d.id AND f.task_identifier = d.task AND f.job_created_at = d.created)
             AND NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure_repeat r
                              WHERE r.job_id = d.id AND r.task_identifier = d.task AND r.job_created_at = d.created))
$$;

COMMENT ON FUNCTION keystone_meta.job_failure_health(bigint[], text[], timestamptz[]) IS
  'Stage 4 Task 1 / F486, F510 (0147); Task 8 (0156); Task 8 fix 1 (0158, R69b) — the queue check''s read: count of unacknowledged ledger rows that still have at least one give-up nobody owns (its own identity, or any counted repeat, with no hand-off), and how many of the given graphile jobs at max_attempts (id, task, created_at — parallel arrays) have no ledger identity, either as a row or as a counted repeat. Aggregates only. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §5 · Platform Jobs' read — the same gate, plus how many of the row's give-ups have an owner
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION keystone.platform_list_job_failures();
CREATE FUNCTION keystone.platform_list_job_failures()
RETURNS TABLE (id bigint, task_identifier text, tenant_id uuid, reason text,
               gave_up_at timestamptz, last_seen_at timestamptz, repeat_count int,
               handed_off_count int, identity_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.task_identifier, f.tenant_id, pg_catalog.left(f.reason, 500), f.gave_up_at, f.last_seen_at,
         f.repeat_count,
         ((CASE WHEN f.handed_off_task_id IS NOT NULL THEN 1 ELSE 0 END)
          + (SELECT pg_catalog.count(*) FROM keystone_meta.job_failure_repeat r
              WHERE r.failure_id = f.id AND r.handed_off_task_id IS NOT NULL))::int,
         (1 + (SELECT pg_catalog.count(*) FROM keystone_meta.job_failure_repeat r
                WHERE r.failure_id = f.id))::int
    FROM keystone_meta.job_failure f
   -- ★★★ THE GATE, evaluated by the database on every call. A non-platform context — or none — yields zero rows.
   WHERE f.acknowledged_at IS NULL
     AND keystone.caller_is_platform()
   ORDER BY f.last_seen_at DESC, f.id DESC
   LIMIT 500
$$;
REVOKE ALL ON FUNCTION keystone.platform_list_job_failures() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_job_failures() TO app_rw;

COMMENT ON FUNCTION keystone.platform_list_job_failures() IS
  'Stage 4 Task 8 / 0156; fix 1 / 0158 — Platform Jobs: every UNACKNOWLEDGED give-up in the ledger with its plain reason (07 §4.7), repeat count, practice id, and how many of its give-ups have been handed to a practice task out of how many there are (R69b — "handed to the practice" is shown only when all of them have). Gated inside on caller_is_platform(): any other context gets zero rows. Owned by app_owner. EXECUTE to app_rw only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; c text; f text; bad text[] := '{}'; p record;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0158 is running as %, expected app_owner — never RESET ROLE', current_user;
  END IF;

  -- NEGATIVE: no application role reaches either ledger table directly (0156's assertion, re-run after the ALTERs).
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'keystone_meta.job_failure_repeat', c) THEN bad := bad || (r || ':repeat:' || c); END IF;
      IF has_table_privilege(r, 'keystone_meta.job_failure', c) THEN bad := bad || (r || ':job_failure:' || c); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION '0158: the ledger is reachable directly: %', bad;
  END IF;

  -- The worker's two functions keep their owner, definer-ness, empty search_path and app_worker-only EXECUTE.
  FOREACH f IN ARRAY ARRAY[
      'keystone_meta.record_job_failure(bigint,text,timestamptz,uuid,text,boolean,text)',
      'keystone_meta.job_failure_health(bigint[],text[],timestamptz[])'] LOOP
    SELECT pg_get_userbyid(proowner) AS owner, prosecdef, proconfig INTO p FROM pg_proc WHERE oid = f::regprocedure;
    IF p.owner <> 'app_owner' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '0158: % changed shape (owner %, definer %, config %)', f, p.owner, p.prosecdef, p.proconfig;
    END IF;
    IF has_function_privilege('public', f, 'EXECUTE') THEN RAISE EXCEPTION '0158: % is executable by PUBLIC', f; END IF;
    FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '0158: % can execute %', r, f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0158: app_worker lost EXECUTE on % — the worker could not record or read give-ups', f;
    END IF;
  END LOOP;

  -- ★★★ THE NEW WRITER AND THE PLATFORM READ: definer, empty search_path, app_owner's, EXECUTE to app_rw ONLY.
  --     app_worker must NOT have the hand-off: the connection that RECORDS a give-up must not be able to own it.
  FOREACH f IN ARRAY ARRAY[
      'keystone_meta.hand_off_job_failure(bigint,text,timestamptz,uuid)',
      'keystone.platform_list_job_failures()'] LOOP
    SELECT pg_get_userbyid(proowner) AS owner, prosecdef, proconfig INTO p FROM pg_proc WHERE oid = f::regprocedure;
    IF p.owner <> 'app_owner' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '0158: % has the wrong shape (owner %, definer %, config %)', f, p.owner, p.prosecdef, p.proconfig;
    END IF;
    IF has_function_privilege('public', f, 'EXECUTE') THEN RAISE EXCEPTION '0158: % is executable by PUBLIC', f; END IF;
    FOREACH r IN ARRAY ARRAY['app_worker','app_embed','app_signup'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '0158: % can execute % — EXECUTE is app_rw only', r, f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('app_rw', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0158: app_rw cannot execute % — the hand-off / Platform Jobs read would be dead code', f;
    END IF;
  END LOOP;
END $$;

-- ★★ BEHAVIOUR, in a block that is always rolled back (the probe raises its own sentinel, caught below — nothing it
--    wrote survives). NEGATIVE cases first, then the POSITIVE control in the same probe:
--      · no ledger identity                      → refused
--      · a give-up belonging to another practice → refused
--      · a task id that names no task            → refused
--      · a task with the WRONG topic             → refused
--      · a CLOSED task                           → refused
--      · the right open task                     → recorded (positive control), and the queue check goes from
--        counting the row to not counting it — while a repeat with no hand-off keeps it counted (C-R69-1).
DO $$
DECLARE
  probe_tenant uuid := '00000000-0000-4000-8000-000000000158';
  other_tenant uuid := '00000000-0000-4000-8000-000000000159';
  probe_task   uuid;
  wrong_task   uuid;
  closed_task  uuid;
  created_1    timestamptz := '2026-01-01 00:00:00.000001+00';
  created_2    timestamptz := '2026-01-01 00:00:00.000002+00';
  h            record;
  n            int;
  failed       text;
BEGIN
  BEGIN
    -- the practice, and the task the hand-off will name (both rolled back with this block)
    PERFORM set_config('keystone.tenant_id', probe_tenant::text, true);
    INSERT INTO keystone.tenant (id, name, slug, is_platform, timezone, status)
    VALUES (probe_tenant, 'zprobe 0158', 'zprobe-0158', false, 'UTC', 'provisioning');
    INSERT INTO keystone.task (tenant_id, topic, subject_type, subject_id, title)
    VALUES (probe_tenant, 'jobs.zprobe_handoff.gave_up', 'person', probe_tenant, '0158 probe task')
    RETURNING id INTO probe_task;
    INSERT INTO keystone.task (tenant_id, topic, subject_type, subject_id, title)
    VALUES (probe_tenant, 'jobs.zprobe_other.gave_up', 'person', probe_tenant, '0158 probe wrong-topic task')
    RETURNING id INTO wrong_task;
    INSERT INTO keystone.task (tenant_id, topic, subject_type, subject_id, title, closed_at, closed_reason)
    VALUES (probe_tenant, 'jobs.zprobe_closed.gave_up', 'person', probe_tenant, '0158 probe closed task',
            pg_catalog.now(), 'manual')
    RETURNING id INTO closed_task;

    -- one give-up of its own, and one counted as a repeat on it (0156's behaviour, unchanged)
    PERFORM keystone_meta.record_job_failure(-158001, 'zprobe_handoff', created_1, probe_tenant, 'probe reason', false, NULL);
    PERFORM keystone_meta.record_job_failure(-158002, 'zprobe_handoff', created_2, probe_tenant, 'probe reason', false, NULL);
    SELECT count(*) INTO n FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_handoff';
    IF n <> 1 THEN RAISE EXCEPTION '0158 probe: expected ONE counting row, got %', n; END IF;

    -- ── NEGATIVE 1: an identity the ledger has never heard of
    failed := NULL;
    BEGIN PERFORM keystone_meta.hand_off_job_failure(-158999, 'zprobe_handoff', created_1, probe_task);
    EXCEPTION WHEN OTHERS THEN failed := SQLSTATE; END;
    IF failed IS NULL THEN RAISE EXCEPTION '0158 probe: an unrecorded give-up was handed off'; END IF;

    -- ── NEGATIVE 2: the give-up belongs to another practice
    PERFORM keystone_meta.record_job_failure(-158003, 'zprobe_elsewhere', created_1, other_tenant, 'probe reason', false, NULL);
    failed := NULL;
    BEGIN PERFORM keystone_meta.hand_off_job_failure(-158003, 'zprobe_elsewhere', created_1, probe_task);
    EXCEPTION WHEN OTHERS THEN failed := SQLSTATE; END;
    IF failed IS NULL THEN RAISE EXCEPTION '0158 probe: another practice''s give-up was handed off'; END IF;

    -- ── NEGATIVE 3: a task id that names no task at all
    failed := NULL;
    BEGIN PERFORM keystone_meta.hand_off_job_failure(-158001, 'zprobe_handoff', created_1,
                                                     '00000000-0000-4000-8000-0000000001ff');
    EXCEPTION WHEN OTHERS THEN failed := SQLSTATE; END;
    IF failed IS NULL THEN RAISE EXCEPTION '0158 probe: a give-up was handed to a task that does not exist'; END IF;

    -- ── NEGATIVE 4: a real open task, but with the wrong topic
    failed := NULL;
    BEGIN PERFORM keystone_meta.hand_off_job_failure(-158001, 'zprobe_handoff', created_1, wrong_task);
    EXCEPTION WHEN OTHERS THEN failed := SQLSTATE; END;
    IF failed IS NULL THEN RAISE EXCEPTION '0158 probe: a give-up was handed to a task about something else'; END IF;

    -- ── NEGATIVE 5: the right shape of task, but CLOSED
    failed := NULL;
    BEGIN PERFORM keystone_meta.hand_off_job_failure(-158001, 'zprobe_handoff', created_1, closed_task);
    EXCEPTION WHEN OTHERS THEN failed := SQLSTATE; END;
    IF failed IS NULL THEN RAISE EXCEPTION '0158 probe: a give-up was handed to a CLOSED task'; END IF;

    IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_handoff' AND handed_off_task_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM keystone_meta.job_failure_repeat WHERE task_identifier = 'zprobe_handoff' AND handed_off_task_id IS NOT NULL) THEN
      RAISE EXCEPTION '0158 probe: a refused hand-off still wrote something';
    END IF;

    -- ── POSITIVE CONTROL: the row's OWN give-up handed to the right open task
    PERFORM keystone_meta.hand_off_job_failure(-158001, 'zprobe_handoff', created_1, probe_task);
    IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure
                    WHERE task_identifier = 'zprobe_handoff' AND handed_off_task_id = probe_task
                      AND handed_off_at IS NOT NULL AND acknowledged_at IS NULL) THEN
      RAISE EXCEPTION '0158 probe: the hand-off was not recorded on the row''s own identity';
    END IF;

    -- ★★★ C-R69-1: the REPEAT is still un-owned, so the queue check must still count this row.
    SELECT * INTO h FROM keystone_meta.job_failure_health('{}'::bigint[], '{}'::text[], '{}'::timestamptz[]);
    IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure f
                    WHERE f.task_identifier = 'zprobe_handoff' AND f.acknowledged_at IS NULL
                      AND EXISTS (SELECT 1 FROM keystone_meta.job_failure_repeat r
                                   WHERE r.failure_id = f.id AND r.handed_off_task_id IS NULL)) THEN
      RAISE EXCEPTION '0158 probe: the counted repeat lost its un-owned state';
    END IF;

    -- and once the repeat is handed off too, the row is owned end to end
    PERFORM keystone_meta.hand_off_job_failure(-158002, 'zprobe_handoff', created_2, probe_task);
    IF EXISTS (SELECT 1 FROM keystone_meta.job_failure_repeat
                WHERE task_identifier = 'zprobe_handoff' AND handed_off_task_id IS NULL) THEN
      RAISE EXCEPTION '0158 probe: the repeat was not handed off';
    END IF;
    IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_handoff' AND acknowledged_at IS NOT NULL) THEN
      RAISE EXCEPTION '0158 probe: a hand-off wrote an acknowledgement (F511 must stay closed)';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '0158_probe_passed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '0158_probe_passed' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE task_identifier IN ('zprobe_handoff', 'zprobe_elsewhere'))
     OR EXISTS (SELECT 1 FROM keystone.tenant WHERE id IN (probe_tenant, other_tenant)) THEN
    RAISE EXCEPTION '0158: the probe left rows behind';
  END IF;
END $$;
