-- ★★★ STAGE 4 TASK 8 — EVERY GIVE-UP HAS AN OWNER (spec 07 §4 rule 6, §5; task-6-report §8 Q3; plan Task 8).
--     Two changes to the give-up ledger 0145/0147 built, and one platform-gated read of it.
--
-- ★★★ 1 · ONE OPEN GIVE-UP, NOT ONE A MINUTE (Q3). [MEASURED, task-6-fix1-review Priority 3] a persistent fault in a
--     periodic job gives up about every 6 minutes per (task, practice), and a fault that cannot be retried gives up
--     every minute — each writing a NEW unacknowledged ledger row (up to ~60 an hour per practice). Now a give-up of
--     the same (task, practice, reason) while one is UNACKNOWLEDGED is counted on that open row — repeat_count + 1,
--     last_seen_at = now() — instead of starting a new one. The queue check (count of unacknowledged rows) therefore
--     counts it as ONE problem; once a person acknowledges it (Task 10), the next give-up starts a new row.
--   ★★ F510 STILL HOLDS, FOR EVERY JOB, NOT ONLY THE FIRST. The open row keeps the FIRST job's identity
--      (job_id, task, job created_at) exactly as before. Each repeat's own identity is kept in
--      keystone_meta.job_failure_repeat (unique on the same three columns, pointing at the row that counts it), and
--      job_failure_health's "unrecorded" treats an identity found in EITHER table as recorded — so a repeat is never
--      reported as a give-up the ledger has not heard of, and a restarted graphile id sequence still cannot make an old
--      row cover a new job (the created_at is part of every identity).
--   ★★ F511 STILL HOLDS. The system may acknowledge only a give-up whose practice is gone (0147's checks, unchanged,
--      run first). Acknowledging a job recorded as a repeat acknowledges the row that counts it — refused if that row
--      belongs to a different practice.
--   ★ Two give-ups of the same (task, practice) racing: an advisory transaction lock on (task, practice) serialises the
--     writer, so they cannot both start a row.
--
-- ★★★ 2 · PLATFORM JOBS LISTS THE LEDGER. keystone.platform_list_job_failures() — the UNACKNOWLEDGED rows with their
--     plain reason, repeat count and practice id, gated INSIDE the function on keystone.caller_is_platform() exactly
--     like platform_list_worker_jobs (0106/0107) and platform_list_platform_events (0138): a practice's context — or
--     no context — gets zero rows, not an error. Owned by app_owner (the ledger's owner; keystone_meta carries no RLS,
--     so there is no FORCE-RLS owner trap — 0129's note), SET search_path = '', EXECUTE to app_rw only (the request
--     role the Platform Jobs list runs as). app_owner already holds EXECUTE on caller_is_platform (MEASURED proacl).
--
-- ★ Nothing here is granted to app_worker beyond what it had: it keeps zero table rights (p21a_role_matrix) and still
--   reaches the ledger only through record_job_failure / job_failure_health, whose signatures and grants are unchanged
--   (CREATE OR REPLACE keeps owner and ACL — asserted below).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · the count on the open row, and the repeats' identities
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone_meta.job_failure
  ADD COLUMN repeat_count integer NOT NULL DEFAULT 1 CONSTRAINT job_failure_repeat_count_check CHECK (repeat_count >= 1),
  ADD COLUMN last_seen_at timestamptz;
UPDATE keystone_meta.job_failure SET last_seen_at = gave_up_at WHERE last_seen_at IS NULL;
ALTER TABLE keystone_meta.job_failure
  ALTER COLUMN last_seen_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET DEFAULT now();
CREATE INDEX job_failure_open_by_kind ON keystone_meta.job_failure (task_identifier, tenant_id) WHERE acknowledged_at IS NULL;

COMMENT ON COLUMN keystone_meta.job_failure.repeat_count IS
  'Stage 4 Task 8 / 0156 — how many give-ups of this (task, practice, reason) this row stands for while it is unacknowledged (1 = only its own). Each repeat''s job identity is in keystone_meta.job_failure_repeat.';
COMMENT ON COLUMN keystone_meta.job_failure.last_seen_at IS
  'Stage 4 Task 8 / 0156 — when the most recent give-up counted on this row was recorded (= gave_up_at until a repeat).';

CREATE TABLE keystone_meta.job_failure_repeat (
  job_id          bigint      NOT NULL,
  task_identifier text        NOT NULL,
  job_created_at  timestamptz NOT NULL CONSTRAINT job_failure_repeat_created_finite CHECK (isfinite(job_created_at)),
  failure_id      bigint      NOT NULL REFERENCES keystone_meta.job_failure (id) ON DELETE CASCADE,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_failure_repeat_identity_key PRIMARY KEY (job_id, task_identifier, job_created_at)
);
CREATE INDEX job_failure_repeat_by_failure ON keystone_meta.job_failure_repeat (failure_id);
REVOKE ALL ON keystone_meta.job_failure_repeat FROM PUBLIC;

COMMENT ON TABLE keystone_meta.job_failure_repeat IS
  'Stage 4 Task 8 / 0156 — one row per give-up that was counted on an already-open keystone_meta.job_failure row (same task, practice and reason) instead of starting its own: the job''s whole identity (F510) and the row that counts it. Written only by keystone_meta.record_job_failure(); read by job_failure_health(). No application role holds any grant on it.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · the writer — 0147's function, same signature, same grants, with the repeat branch
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone_meta.record_job_failure(
  p_job_id bigint, p_task text, p_job_created_at timestamptz, p_tenant_id uuid, p_reason text,
  p_acknowledged boolean, p_ack_reason text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_counted_on bigint;   -- the open row this job is already counted on as a repeat, if any
  v_open       bigint;   -- an open row of the same (task, practice, reason) to count a NEW give-up on
BEGIN
  IF p_job_created_at IS NULL OR NOT pg_catalog.isfinite(p_job_created_at) THEN
    RAISE EXCEPTION 'record_job_failure: the job''s own created_at is part of its identity and is required (got %)',
      p_job_created_at USING ERRCODE = '22023';
  END IF;

  -- ★ One writer per (task, practice) at a time: two give-ups of the same kind must not both start a row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'keystone_meta.job_failure:' || p_task || ':' || coalesce(p_tenant_id::text, '-'), 0));

  SELECT r.failure_id INTO v_counted_on
    FROM keystone_meta.job_failure_repeat r
   WHERE r.job_id = p_job_id AND r.task_identifier = p_task AND r.job_created_at = p_job_created_at;

  IF p_acknowledged THEN
    -- ★★ F511 (0147), unchanged: the system acknowledges only a give-up whose named practice is gone.
    IF p_tenant_id IS NULL THEN
      RAISE EXCEPTION 'record_job_failure: the system acknowledges a give-up only when the practice it was queued for is gone — no practice was named, so it cannot be checked'
        USING ERRCODE = '42501';
    END IF;
    IF NOT keystone_meta.job_practice_is_gone(p_tenant_id) THEN
      RAISE EXCEPTION 'record_job_failure: practice % still exists — the system may not acknowledge its give-up; record it unacknowledged for a person to look at',
        p_tenant_id USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM keystone_meta.job_failure f
                WHERE f.job_id = p_job_id AND f.task_identifier = p_task AND f.job_created_at = p_job_created_at
                  AND f.tenant_id IS DISTINCT FROM p_tenant_id)
       OR EXISTS (SELECT 1 FROM keystone_meta.job_failure f
                   WHERE f.id = v_counted_on AND f.tenant_id IS DISTINCT FROM p_tenant_id) THEN
      RAISE EXCEPTION 'record_job_failure: job % is already recorded under a different practice — the system may not acknowledge it',
        p_job_id USING ERRCODE = '42501';
    END IF;
    IF v_counted_on IS NOT NULL THEN
      -- ★ Recorded as a repeat: acknowledging it acknowledges the row that counts it (same, gone, practice).
      UPDATE keystone_meta.job_failure
         SET acknowledged_at = pg_catalog.now(), acknowledged_by = 'system', acknowledge_reason = p_ack_reason
       WHERE id = v_counted_on AND acknowledged_at IS NULL;
      RETURN;
    END IF;
  ELSE
    -- ★ Already counted as a repeat: nothing to add (idempotent, like 0145's ON CONFLICT).
    IF v_counted_on IS NOT NULL THEN RETURN; END IF;
    -- ★★ Q3: not yet recorded, and an open row of the same (task, practice, reason) exists → count it there.
    IF NOT EXISTS (SELECT 1 FROM keystone_meta.job_failure f
                    WHERE f.job_id = p_job_id AND f.task_identifier = p_task AND f.job_created_at = p_job_created_at) THEN
      SELECT f.id INTO v_open
        FROM keystone_meta.job_failure f
       WHERE f.acknowledged_at IS NULL
         AND f.task_identifier = p_task
         AND f.tenant_id IS NOT DISTINCT FROM p_tenant_id
         AND f.reason = p_reason
       ORDER BY f.id DESC
       LIMIT 1
       FOR UPDATE;
      IF v_open IS NOT NULL THEN
        INSERT INTO keystone_meta.job_failure_repeat (job_id, task_identifier, job_created_at, failure_id)
        VALUES (p_job_id, p_task, p_job_created_at, v_open);
        UPDATE keystone_meta.job_failure
           SET repeat_count = repeat_count + 1, last_seen_at = pg_catalog.now()
         WHERE id = v_open;
        RETURN;
      END IF;
    END IF;
  END IF;

  INSERT INTO keystone_meta.job_failure AS f
         (job_id, task_identifier, job_created_at, tenant_id, reason,
          acknowledged_at, acknowledged_by, acknowledge_reason)
  VALUES (p_job_id, p_task, p_job_created_at, p_tenant_id, p_reason,
          CASE WHEN p_acknowledged THEN pg_catalog.now() END,
          CASE WHEN p_acknowledged THEN 'system' END,
          CASE WHEN p_acknowledged THEN p_ack_reason END)
  ON CONFLICT (job_id, task_identifier, job_created_at) DO UPDATE
     SET acknowledged_at    = pg_catalog.now(),
         acknowledged_by    = 'system',
         acknowledge_reason = EXCLUDED.acknowledge_reason
   WHERE f.acknowledged_at IS NULL AND EXCLUDED.acknowledged_at IS NOT NULL
     AND f.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id;
END $$;

COMMENT ON FUNCTION keystone_meta.record_job_failure(bigint, text, timestamptz, uuid, text, boolean, text) IS
  'Stage 4 Task 1 / F486, F510, F511 (0147); Task 8 (0156) — the only application write path into keystone_meta.job_failure. Identity (job_id, task, job created_at). A new give-up of the same (task, practice, reason) while a row is unacknowledged is COUNTED on that row (repeat_count, last_seen_at; its identity kept in job_failure_repeat) instead of starting a new one. Keeps the first reason, never rewrites an acknowledgement. A SYSTEM acknowledgement is refused unless the named practice no longer exists. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · the queue check's read — a repeat's identity is recorded too
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone_meta.job_failure_health(
  p_dead_job_ids bigint[], p_dead_tasks text[], p_dead_created timestamptz[])
RETURNS TABLE (unacknowledged int, unrecorded int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (SELECT pg_catalog.count(*)::int FROM keystone_meta.job_failure f WHERE f.acknowledged_at IS NULL),
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
  'Stage 4 Task 1 / F486, F510 (0147); Task 8 (0156) — the queue check''s read: count of unacknowledged ledger rows (a row counting repeats is ONE), and how many of the given graphile jobs at max_attempts (id, task, created_at — parallel arrays) have no ledger identity, either as a row or as a counted repeat. Arrays of unequal length pad with NULL, which matches nothing and so counts as unrecorded (errs loud). Aggregates only. EXECUTE to app_worker only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · Platform Jobs' read of the ledger — platform-gated inside the function
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.platform_list_job_failures()
RETURNS TABLE (id bigint, task_identifier text, tenant_id uuid, reason text,
               gave_up_at timestamptz, last_seen_at timestamptz, repeat_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.task_identifier, f.tenant_id, pg_catalog.left(f.reason, 500), f.gave_up_at, f.last_seen_at, f.repeat_count
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
  'Stage 4 Task 8 / 0156 — Platform Jobs: every UNACKNOWLEDGED give-up in the ledger with its plain reason (07 §4.7), repeat count and practice id. Gated inside on caller_is_platform(): any other context gets zero rows. Owned by app_owner (the ledger''s owner; no RLS on keystone_meta). EXECUTE to app_rw only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; c text; f text; bad text[] := '{}'; p record;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0156 is running as %, expected app_owner — never RESET ROLE', current_user;
  END IF;

  -- NEGATIVE: no application role reaches either ledger table directly.
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'keystone_meta.job_failure_repeat', c) THEN bad := bad || (r || ':repeat:' || c); END IF;
      IF has_table_privilege(r, 'keystone_meta.job_failure', c) THEN bad := bad || (r || ':job_failure:' || c); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION '0156: the ledger is reachable directly: %', bad;
  END IF;

  -- The two replaced functions keep their owner, definer-ness, empty search_path and app_worker-only EXECUTE.
  FOREACH f IN ARRAY ARRAY[
      'keystone_meta.record_job_failure(bigint,text,timestamptz,uuid,text,boolean,text)',
      'keystone_meta.job_failure_health(bigint[],text[],timestamptz[])'] LOOP
    SELECT pg_get_userbyid(proowner) AS owner, prosecdef, proconfig INTO p FROM pg_proc WHERE oid = f::regprocedure;
    IF p.owner <> 'app_owner' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '0156: % changed shape (owner %, definer %, config %)', f, p.owner, p.prosecdef, p.proconfig;
    END IF;
    IF has_function_privilege('public', f, 'EXECUTE') THEN RAISE EXCEPTION '0156: % is executable by PUBLIC', f; END IF;
    FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '0156: % can execute %', r, f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0156: app_worker lost EXECUTE on % — the worker could not record or read give-ups', f;
    END IF;
  END LOOP;

  -- The Platform Jobs read: definer, empty search_path, app_owner's, EXECUTE app_rw only.
  f := 'keystone.platform_list_job_failures()';
  SELECT pg_get_userbyid(proowner) AS owner, prosecdef, proconfig INTO p FROM pg_proc WHERE oid = f::regprocedure;
  IF p.owner <> 'app_owner' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '0156: % has the wrong shape (owner %, definer %, config %)', f, p.owner, p.prosecdef, p.proconfig;
  END IF;
  IF has_function_privilege('public', f, 'EXECUTE') THEN RAISE EXCEPTION '0156: % is executable by PUBLIC', f; END IF;
  FOREACH r IN ARRAY ARRAY['app_worker','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '0156: % can execute %', r, f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('app_rw', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0156: app_rw cannot execute % — Platform Jobs could not list give-ups', f;
  END IF;
END $$;

-- ★★ BEHAVIOUR, in a block that is always rolled back (the probe raises its own sentinel, caught below — nothing it
--    wrote survives): two give-ups of one kind are ONE open row counting 2, both identities recorded; a different
--    reason starts its own row; the Platform Jobs read gives a NON-platform context (here: none) zero rows.
DO $$
DECLARE n_open int; h record; probe_tenant uuid := '00000000-0000-4000-8000-000000000156';
BEGIN
  BEGIN
    PERFORM keystone_meta.record_job_failure(-156001, 'zprobe_0156', '2026-01-01 00:00:00.000001+00', probe_tenant, 'probe reason', false, NULL);
    PERFORM keystone_meta.record_job_failure(-156002, 'zprobe_0156', '2026-01-01 00:00:00.000002+00', probe_tenant, 'probe reason', false, NULL);
    PERFORM keystone_meta.record_job_failure(-156002, 'zprobe_0156', '2026-01-01 00:00:00.000002+00', probe_tenant, 'probe reason', false, NULL);
    SELECT count(*) INTO n_open FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_0156';
    IF n_open <> 1 OR (SELECT repeat_count FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_0156') <> 2 THEN
      RAISE EXCEPTION '0156 probe: two give-ups of one kind gave % rows / repeat_count % (expected 1 / 2; a re-record must not count twice)',
        n_open, (SELECT string_agg(repeat_count::text, ',') FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_0156');
    END IF;
    SELECT * INTO h FROM keystone_meta.job_failure_health(
      ARRAY[-156001, -156002]::bigint[], ARRAY['zprobe_0156', 'zprobe_0156'],
      ARRAY['2026-01-01 00:00:00.000001+00', '2026-01-01 00:00:00.000002+00']::timestamptz[]);
    IF h.unrecorded <> 0 THEN
      RAISE EXCEPTION '0156 probe: the counted repeat reads as unrecorded (%)', h.unrecorded;
    END IF;
    -- POSITIVE CONTROL for "unrecorded": a third job with a microsecond-different created_at is NOT covered (F510).
    SELECT * INTO h FROM keystone_meta.job_failure_health(
      ARRAY[-156002]::bigint[], ARRAY['zprobe_0156'], ARRAY['2026-01-01 00:00:00.000003+00']::timestamptz[]);
    IF h.unrecorded <> 1 THEN
      RAISE EXCEPTION '0156 probe: a different job identity was treated as recorded (unrecorded %)', h.unrecorded;
    END IF;
    PERFORM keystone_meta.record_job_failure(-156003, 'zprobe_0156', '2026-01-01 00:00:00.000003+00', probe_tenant, 'another reason', false, NULL);
    IF (SELECT count(*) FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_0156') <> 2 THEN
      RAISE EXCEPTION '0156 probe: a different reason did not start its own row';
    END IF;
    IF (SELECT count(*) FROM keystone.platform_list_job_failures()) <> 0 THEN
      RAISE EXCEPTION '0156 probe: platform_list_job_failures returned rows with no platform context';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '0156_probe_passed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '0156_probe_passed' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM keystone_meta.job_failure WHERE task_identifier = 'zprobe_0156')
     OR EXISTS (SELECT 1 FROM keystone_meta.job_failure_repeat WHERE task_identifier = 'zprobe_0156') THEN
    RAISE EXCEPTION '0156: the probe left rows behind';
  END IF;
END $$;
