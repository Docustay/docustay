-- 0142_a_listener_gives_up_once
-- Stage 3 Task 5, fix round 1 — review F2.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ (a) job.gave_up IS WRITTEN AT MOST ONCE PER (listener, event). The dispatcher writes it after the
--     tenant transaction commits, on the worker's own connection. Two dispatches for the same practice
--     running at once (a re-enqueued job, a second worker) both saw the same dead row with
--     gave_up_reported_at NULL and both wrote — and record_platform_event (0138) is a plain INSERT.
--   ★★ Fixed at the database, where two processes cannot both be right: a partial UNIQUE index on
--      (subject, facts->>'event_id') for job.gave_up rows, and the writer inserts ON CONFLICT DO NOTHING
--      and returns the EXISTING row's id, so both callers get the same answer and mark their row reported.
--      Rows without an event_id fact (none are written by the dispatcher) are not constrained.
--
-- ★★★ (b) A REPORT THAT ALWAYS FAILS IS BOUNDED. `event_delivery.gave_up_report_attempts` counts failed
--     writes; the dispatcher stops selecting a row at the bound (src/events/outbox.mjs
--     GAVE_UP_REPORT_MAX_ATTEMPTS), logs one loud error at the transition, and orders the owed list by
--     this count so a failing row can never occupy the front of the window ahead of rows that would work.
--
-- ★★ THE WRITER KEEPS 0138's PRIVILEGE PATTERN, AND THE REVOKE IS RUN BY ITS OWNER. `CREATE OR REPLACE`
--    with the same signature keeps the OID and the ACL, but the REVOKE FROM PUBLIC is re-issued anyway and
--    ASSERTED — F499's root cause was a REVOKE run by a non-owner, which Postgres accepts with only a
--    WARNING. This migration runs as app_owner (db/migrate.mjs), which owns the function; the owner is
--    asserted before the REVOKE so a future ownership change fails here instead of warning.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.event_delivery
  ADD COLUMN IF NOT EXISTS gave_up_report_attempts integer NOT NULL DEFAULT 0
    CHECK (gave_up_report_attempts >= 0);

COMMENT ON COLUMN keystone.event_delivery.gave_up_report_attempts IS
  'Stage 3 T5 fix 1 (F2). Failed attempts to write this dead row''s job.gave_up platform event. The dispatcher '
  'stops retrying at its bound and logs once; a row at the bound with gave_up_reported_at NULL was never reported.';

CREATE UNIQUE INDEX IF NOT EXISTS platform_event_gave_up_once
  ON keystone_meta.platform_event (subject, (facts->>'event_id'))
  WHERE kind = 'job.gave_up' AND facts ? 'event_id';

CREATE OR REPLACE FUNCTION keystone_meta.record_platform_event(p_kind text, p_subject text, p_facts jsonb)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, keystone_meta
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO keystone_meta.platform_event (kind, subject, facts)
  VALUES (p_kind, p_subject, coalesce(p_facts, '{}'::jsonb))
  ON CONFLICT (subject, (facts->>'event_id')) WHERE kind = 'job.gave_up' AND facts ? 'event_id'
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- ★ The same give-up was already recorded (a concurrent or repeated report): return THAT row.
    SELECT pe.id INTO v_id FROM keystone_meta.platform_event pe
     WHERE pe.kind = 'job.gave_up' AND pe.subject = p_subject
       AND pe.facts ? 'event_id' AND pe.facts->>'event_id' = p_facts->>'event_id';
  END IF;
  RETURN v_id;
END $$;

DO $owner$
BEGIN
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc
       WHERE oid = 'keystone_meta.record_platform_event(text,text,jsonb)'::regprocedure) <> current_user THEN
    RAISE EXCEPTION '0142: record_platform_event is not owned by % — a REVOKE from here would only warn (F499)', current_user;
  END IF;
END $owner$;
REVOKE ALL ON FUNCTION keystone_meta.record_platform_event(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.record_platform_event(text, text, jsonb) TO app_worker;

DO $check$
DECLARE
  fn  oid := 'keystone_meta.record_platform_event(text,text,jsonb)'::regprocedure;
  a   bigint;
  b   bigint;
  n   integer;
  ev  text := gen_random_uuid()::text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0142 is running as %, expected app_owner — never RESET ROLE', current_user;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn) THEN
    RAISE EXCEPTION '0142: record_platform_event lost SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = fn
                  AND proconfig @> ARRAY['search_path=pg_catalog, keystone_meta']) THEN
    RAISE EXCEPTION '0142: record_platform_event search_path is not pinned (%)', (SELECT proconfig FROM pg_proc WHERE oid = fn);
  END IF;
  IF has_function_privilege('public', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0142: record_platform_event is executable by PUBLIC (acl %)', (SELECT proacl FROM pg_proc WHERE oid = fn);
  END IF;
  IF NOT has_function_privilege('app_worker', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0142: app_worker lost EXECUTE on record_platform_event';
  END IF;
  IF has_function_privilege('app_rw', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0142: app_rw can EXECUTE record_platform_event';
  END IF;

  -- ★ Behaviour: the same give-up twice → one row, one id. A different event → a second row (control).
  a := keystone_meta.record_platform_event('job.gave_up', 'listener:m0142_probe',
         jsonb_build_object('event_id', ev, 'listener', 'm0142_probe', 'attempts', 6));
  b := keystone_meta.record_platform_event('job.gave_up', 'listener:m0142_probe',
         jsonb_build_object('event_id', ev, 'listener', 'm0142_probe', 'attempts', 6));
  SELECT count(*) INTO n FROM keystone_meta.platform_event WHERE subject = 'listener:m0142_probe';
  IF a IS NULL OR a <> b OR n <> 1 THEN
    RAISE EXCEPTION '0142: a repeated job.gave_up was not de-duplicated (ids %/%, rows %)', a, b, n;
  END IF;
  b := keystone_meta.record_platform_event('job.gave_up', 'listener:m0142_probe',
         jsonb_build_object('event_id', gen_random_uuid()::text, 'listener', 'm0142_probe', 'attempts', 6));
  SELECT count(*) INTO n FROM keystone_meta.platform_event WHERE subject = 'listener:m0142_probe';
  IF b = a OR n <> 2 THEN
    RAISE EXCEPTION '0142: control — a different event''s give-up was not recorded (rows %)', n;
  END IF;
  DELETE FROM keystone_meta.platform_event WHERE subject = 'listener:m0142_probe';
END
$check$;
