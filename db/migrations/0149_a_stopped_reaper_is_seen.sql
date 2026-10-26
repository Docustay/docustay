-- ★★★ STAGE 4 TASK 1, FIX ROUND 2 — RULING R61b: A TRIPPED REAPER BREAKER MUST REACH A PERSON.
--     reap_orphan_jobs' circuit breaker (F509) stops the run when the reads of keystone.tenant disagree with
--     each other. Fix round 1 only logged it. The review (task-1-fix1-review.md, I2) proved that THROWING
--     would not help: sweep_tenants re-adds the reaper every 60 s with jobKeyMode 'replace', which resets
--     attempts and last_error, so the job never reaches max_attempts and the queue check never sees it — and a
--     throw racing a sweep can leave a permanently dead, tenant-less row nobody can acknowledge.
--   ★★ So on a trip the reaper touches nothing, does NOT throw, and records a PLATFORM FACT through the writer
--      the worker already holds (keystone_meta.record_platform_event, 0138/0142 — EXECUTE app_worker):
--        kind 'job.reaper_stopped' · subject 'job:reap_orphan_jobs' · facts = the trip reason as an enum and
--        counts. No practice id: a platform fact carries no tenant data.
--   ★★ The queue check reads it back through keystone_meta.reaper_stop_health() (below): 'problem', naming the
--      reason, while a trip fact is under 5 minutes old. The reaper runs every minute, so a cause that persists
--      keeps re-recording and keeps the check red; a cause that clears stops recording and the check recovers.
--   ★ The kind is 'job.reaper_stopped' rather than the brief's example 'jobs.reaper_stopped': the existing
--     job-shaped kind is singular ('job.gave_up'), and one prefix per family keeps the list greppable.
--
-- ★ Pattern of 0129/0138/0147: SECURITY DEFINER owned by app_owner (the table's owner; keystone_meta is outside
--   RLS), SET search_path = '', REVOKE ALL FROM PUBLIC, EXECUTE to exactly one role (app_worker). Aggregates
--   only — the reader never returns facts wholesale.

ALTER TABLE keystone_meta.platform_event DROP CONSTRAINT platform_event_kind_check;
ALTER TABLE keystone_meta.platform_event ADD CONSTRAINT platform_event_kind_check CHECK (kind IN (
  'health.check_failed', 'health.check_recovered',
  'backup.verified', 'backup.failed',
  'job.gave_up', 'job.reaper_stopped'));

CREATE FUNCTION keystone_meta.reaper_stop_health()
RETURNS TABLE (reason text, stopped_at timestamptz, trips int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH recent AS (
    SELECT e.id, e.created_at,
           -- ★ Only an enum-shaped reason is passed back; anything else is reported as 'unknown'.
           CASE WHEN (e.facts->>'reason') OPERATOR(pg_catalog.~) '^[a-z_]{1,40}$' THEN e.facts->>'reason' ELSE 'unknown' END AS reason
      FROM keystone_meta.platform_event e
     WHERE e.kind = 'job.reaper_stopped'
       AND e.created_at > pg_catalog.now() - interval '5 minutes')
  SELECT (SELECT r.reason FROM recent r ORDER BY r.created_at DESC, r.id DESC LIMIT 1),
         (SELECT pg_catalog.max(r.created_at) FROM recent r),
         (SELECT pg_catalog.count(*)::int FROM recent r)
   WHERE EXISTS (SELECT 1 FROM recent)
$$;
REVOKE ALL ON FUNCTION keystone_meta.reaper_stop_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.reaper_stop_health() TO app_worker;

COMMENT ON FUNCTION keystone_meta.reaper_stop_health() IS
  'Stage 4 Task 1 fix round 2 / R61b (0149) — the queue check''s read of the reaper''s circuit-breaker trips: the newest trip reason (enum), its time and the count, over the last 5 minutes; zero rows when there is none. EXECUTE to app_worker only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; f text := 'keystone_meta.reaper_stop_health()'; probe record; n int; fresh bigint; stale bigint;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0149 is running as %, expected app_owner — never RESET ROLE', current_user;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
    RAISE EXCEPTION '0149: % is not SECURITY DEFINER', f;
  END IF;
  IF has_function_privilege('public', f, 'EXECUTE') THEN RAISE EXCEPTION '0149: % is executable by PUBLIC', f; END IF;
  FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '0149: % can execute %', r, f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0149: app_worker cannot execute % — the queue check would break', f;
  END IF;

  -- Behaviour, both directions: a 6-minute-old trip is NOT counted; a fresh one IS (positive control).
  INSERT INTO keystone_meta.platform_event (kind, subject, facts, created_at)
  VALUES ('job.reaper_stopped', 'job:m0149_probe', '{"reason":"lister_empty"}', now() - interval '6 minutes')
  RETURNING id INTO stale;
  SELECT count(*) INTO n FROM keystone_meta.reaper_stop_health() h
   WHERE h.stopped_at = (SELECT created_at FROM keystone_meta.platform_event WHERE id = stale);
  IF n <> 0 THEN RAISE EXCEPTION '0149: a 6-minute-old trip was still counted'; END IF;
  INSERT INTO keystone_meta.platform_event (kind, subject, facts, created_at)
  VALUES ('job.reaper_stopped', 'job:m0149_probe', '{"reason":"m0149_probe"}', now())
  RETURNING id INTO fresh;
  SELECT * INTO probe FROM keystone_meta.reaper_stop_health();
  IF probe.trips IS NULL OR probe.trips < 1 THEN
    RAISE EXCEPTION '0149: a fresh trip was not counted (%)', probe;
  END IF;
  DELETE FROM keystone_meta.platform_event WHERE id IN (stale, fresh);
END $$;
