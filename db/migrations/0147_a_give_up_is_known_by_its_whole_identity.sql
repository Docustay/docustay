-- ★★★ STAGE 4 TASK 1, FIX ROUND 1 — F510 and F511, on the give-up ledger 0145 created.
--     0145 is applied locally and its checksum recorded, so it is NOT edited; this migration changes it.
--     [MEASURED] production has not run 0145 yet: both ship in the same deploy, so on production this runs
--     against an EMPTY keystone_meta.job_failure and no deployed code calls the functions it replaces.
--     That is why the two old signatures are DROPPED here rather than kept for an expand/contract window:
--     there is no previous release that calls them.
--
-- ★★★ F510 — A LEDGER ROW MUST COVER ONLY THE JOB IT WAS WRITTEN FOR.
--     0145 keyed the ledger on the graphile job_id alone, and the queue check subtracted acknowledged rows by
--     job_id alone. If graphile's id sequence ever restarted (the graphile schema reinstalled, a database rebuilt
--     while keystone_meta is kept), an OLD acknowledged row would silently cover a NEW real give-up — hidden
--     twice: `unrecorded` would skip it, and record_job_failure's ON CONFLICT (job_id) would keep the old
--     acknowledged row so it could never become unacknowledged. That is the silence Ruling R59 forbids.
--   ★★ The identity is now (job_id, task_identifier, job_created_at) — graphile's own created_at for the job,
--      which a restarted sequence cannot reproduce. The unique key, record_job_failure's ON CONFLICT and
--      job_failure_health's matching all use the SAME three columns.
--   ★ Rows written before this migration (local databases only) have no created_at to give; they get
--     '-infinity', a value no real job can have, so an old row can never cover a new give-up. New writes must
--     pass a finite created_at.
--
-- ★★★ F511 — THE SYSTEM MAY ACKNOWLEDGE ONLY A GIVE-UP WHOSE PRACTICE IS GONE.
--     0145's record_job_failure(…, acknowledged = true, …) accepted ANY job, so any code running as app_worker
--     could mark a live practice's real failure as acknowledged by 'system' and the queue check would go quiet.
--     [EXECUTED before this migration, as app_worker, rolled back] it accepted exactly that.
--   ★★ Now an acknowledgement through this function is REFUSED unless the practice the job was queued for is
--      named AND no longer exists. A live practice's give-up can only be recorded UNacknowledged; a person
--      acknowledges it through Task 10's platform-gated, audited path (07 §4.8), not this one.
--   ★★ A system acknowledgement with NO practice is refused too. The function cannot read graphile (app_owner
--      has no rights there), so it trusts the practice the caller names; allowing "no practice" would let a
--      caller skip the check by leaving it out. No system path needs it: the reaper only acknowledges jobs whose
--      payload names a practice that is gone.
--   ★ Acknowledging an existing row also requires the practice named to be the one the row already holds —
--     otherwise naming any gone uuid would acknowledge a live practice's recorded give-up.
--   ★★ HOW THE CHECK SEES keystone.tenant. record_job_failure is owned by app_owner, which FORCE RLS shows no
--      tenant rows and which has no USAGE on keystone_auth. So the check is a separate definer,
--      keystone_meta.job_practice_is_gone(uuid), OWNED BY auth_owner (tenant_health_read applies — the same
--      visibility tenant_exists and tenant_is_active use), created, revoked and granted AS auth_owner (0017 and
--      0141 lessons), and EXECUTE to app_owner ONLY — not to app_worker, not to any web role. It answers one
--      boolean about one uuid.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F510 — the identity column and the widened key.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone_meta.job_failure ADD COLUMN job_created_at timestamptz;
UPDATE keystone_meta.job_failure SET job_created_at = '-infinity' WHERE job_created_at IS NULL;
ALTER TABLE keystone_meta.job_failure ALTER COLUMN job_created_at SET NOT NULL;
ALTER TABLE keystone_meta.job_failure DROP CONSTRAINT job_failure_job_id_key;
ALTER TABLE keystone_meta.job_failure
  ADD CONSTRAINT job_failure_job_identity_key UNIQUE (job_id, task_identifier, job_created_at);

COMMENT ON COLUMN keystone_meta.job_failure.job_created_at IS
  'F510 / 0147 — graphile''s own created_at for the job. With job_id and task_identifier it is the job''s identity: a restarted graphile id sequence cannot reproduce it, so an old acknowledged row never covers a new give-up. ''-infinity'' only on rows written before 0147 (local databases), which then match no job.';
COMMENT ON COLUMN keystone_meta.job_failure.gave_up_at IS
  'When the LEDGER learned of the give-up (its insert time) — not graphile''s original failure time. For jobs closed before the ledger existed it is the time the reaper first recorded them.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F511 — the practice-gone gate, AS auth_owner.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone_meta.job_practice_is_gone(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_tenant_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = p_tenant_id);
$$;
REVOKE ALL ON FUNCTION keystone_meta.job_practice_is_gone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.job_practice_is_gone(uuid) TO app_owner;

COMMENT ON FUNCTION keystone_meta.job_practice_is_gone(uuid) IS
  'F511 / 0147 — true only when a practice is NAMED and no row for it exists (any status). Owned by auth_owner so tenant_health_read applies (FORCE RLS would show app_owner nothing). Called only inside keystone_meta.record_job_failure: EXECUTE to app_owner only.';

SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The writer and the watcher's read, with the job's whole identity.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION keystone_meta.record_job_failure(bigint, text, uuid, text, boolean, text);
DROP FUNCTION keystone_meta.job_failure_health(bigint[]);

CREATE FUNCTION keystone_meta.record_job_failure(
  p_job_id bigint, p_task text, p_job_created_at timestamptz, p_tenant_id uuid, p_reason text,
  p_acknowledged boolean, p_ack_reason text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_job_created_at IS NULL OR NOT pg_catalog.isfinite(p_job_created_at) THEN
    RAISE EXCEPTION 'record_job_failure: the job''s own created_at is part of its identity and is required (got %)',
      p_job_created_at USING ERRCODE = '22023';
  END IF;

  IF p_acknowledged THEN
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
                  AND f.tenant_id IS DISTINCT FROM p_tenant_id) THEN
      RAISE EXCEPTION 'record_job_failure: job % is already recorded under a different practice — the system may not acknowledge it',
        p_job_id USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION keystone_meta.record_job_failure(bigint, text, timestamptz, uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.record_job_failure(bigint, text, timestamptz, uuid, text, boolean, text) TO app_worker;

COMMENT ON FUNCTION keystone_meta.record_job_failure(bigint, text, timestamptz, uuid, text, boolean, text) IS
  'Stage 4 Task 1 / F486, F510, F511 (0147) — the only application write path into keystone_meta.job_failure. Identity (job_id, task, job created_at). Idempotent: keeps the first reason, never rewrites an acknowledgement. A SYSTEM acknowledgement is refused unless the named practice no longer exists (a live practice''s give-up is recorded unacknowledged; a person acknowledges it on the Task 10 path). EXECUTE to app_worker only.';

CREATE FUNCTION keystone_meta.job_failure_health(
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
                              WHERE f.job_id = d.id AND f.task_identifier = d.task AND f.job_created_at = d.created))
$$;
REVOKE ALL ON FUNCTION keystone_meta.job_failure_health(bigint[], text[], timestamptz[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.job_failure_health(bigint[], text[], timestamptz[]) TO app_worker;

COMMENT ON FUNCTION keystone_meta.job_failure_health(bigint[], text[], timestamptz[]) IS
  'Stage 4 Task 1 / F486, F510 (0147) — the queue check''s read: count of unacknowledged ledger rows, and how many of the given graphile jobs at max_attempts (id, task, created_at — parallel arrays) have no ledger row with that exact identity. Arrays of unequal length pad with NULL, which matches nothing and so counts as unrecorded (errs loud). Aggregates only. EXECUTE to app_worker only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; f text; probe record;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0147 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;
  IF to_regprocedure('keystone_meta.record_job_failure(bigint,text,uuid,text,boolean,text)') IS NOT NULL
     OR to_regprocedure('keystone_meta.job_failure_health(bigint[])') IS NOT NULL THEN
    RAISE EXCEPTION '0147: an old ledger signature survived — it would be a second door without the identity or the check';
  END IF;

  FOREACH f IN ARRAY ARRAY[
      'keystone_meta.record_job_failure(bigint,text,timestamptz,uuid,text,boolean,text)',
      'keystone_meta.job_failure_health(bigint[],text[],timestamptz[])'] LOOP
    IF has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0147: % is executable by PUBLIC', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '0147: % can execute %', r, f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0147: app_worker cannot execute % — the reaper/watcher would break', f;
    END IF;
  END LOOP;

  f := 'keystone_meta.job_practice_is_gone(uuid)';
  IF has_function_privilege('public', f, 'EXECUTE') THEN RAISE EXCEPTION '0147: % is executable by PUBLIC', f; END IF;
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '0147: % can execute % — only the ledger''s writer (app_owner) may', r, f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('app_owner', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0147: app_owner cannot execute % — record_job_failure could never acknowledge anything', f;
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = f::regprocedure) <> 'auth_owner' THEN
    RAISE EXCEPTION '0147: % is not owned by auth_owner — it would not see keystone.tenant', f;
  END IF;

  -- POSITIVE CONTROL: the watcher's read counts a job it has never heard of.
  SELECT * INTO probe FROM keystone_meta.job_failure_health(ARRAY[-1]::bigint[], ARRAY['probe'], ARRAY[now()]);
  IF probe.unrecorded IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '0147: job_failure_health did not count an unrecorded job (got %)', probe.unrecorded;
  END IF;
  -- The nil uuid names no practice that exists: the gate must say "gone" for it (it can see, and says so).
  IF NOT keystone_meta.job_practice_is_gone('00000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION '0147: job_practice_is_gone said a practice that does not exist is not gone';
  END IF;
  IF keystone_meta.job_practice_is_gone(NULL) THEN
    RAISE EXCEPTION '0147: job_practice_is_gone said "gone" for no practice at all';
  END IF;
END $$;

-- ★★ The gate must SEE a practice that exists (the FORCE-RLS owner trap would make it say "gone" for every
--    practice — which would let the system acknowledge anything). Checked as auth_owner, which can count them.
SET LOCAL ROLE auth_owner;
DO $$
DECLARE t_any uuid;
BEGIN
  SELECT id INTO t_any FROM keystone.tenant LIMIT 1;
  IF t_any IS NOT NULL AND keystone_meta.job_practice_is_gone(t_any) THEN
    RAISE EXCEPTION '0147: job_practice_is_gone said an existing practice is gone — it cannot see keystone.tenant';
  END IF;
END $$;
SET LOCAL ROLE app_owner;
