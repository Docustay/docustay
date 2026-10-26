-- ★★★ STAGE 18 TASK 18.20 — JOB RUN LEDGER (spec § platform facts).
--     Every background job run records task, practice, start, end, outcome and an optional short
--     summary in the platform's own facts schema (R-12: THE SAME SHAPE AS Stage 16's `automation_run`).
--
--   ★★ OWNERSHIP, STATED ONCE SO NEITHER TABLE GROWS INTO THE OTHER:
--     · `automation_run` — one row per AUTOMATION ACTION inside a practice; tenant-scoped; the
--       practice reads it (F11's receipt, F09's counts).
--     · `keystone_meta.job_run` — one row per BACKGROUND JOB RUN; platform-wide; no tenant_id;
--       reached only through definers; read only by Platform.
--   ★ Column vocabulary is DELIBERATELY IDENTICAL to automation_run (started_at, finished_at,
--     outcome, summary) so the two read the same way. This migration copies automation_run's exact
--     column names and outcome vocabulary; if they differ, REFRESH reads them from Stage 16 and
--     this task follows them.

CREATE TABLE keystone_meta.job_run (
  id          bigserial   PRIMARY KEY,
  task        text        NOT NULL CHECK (task ~ '^[a-z][a-z0-9_]*$'),
  tenant_id   uuid        NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL CHECK (finished_at >= started_at),
  outcome     text        NOT NULL CHECK (outcome IN ('ok','failed')),
  summary     text        NULL CHECK (summary IS NULL OR char_length(summary) <= 120)
);
CREATE INDEX job_run_task_recent ON keystone_meta.job_run (task, finished_at DESC);
-- no RLS (keystone_meta holds platform facts, no tenant rows are readable by any app role); no grants to app roles
COMMENT ON TABLE keystone_meta.job_run IS
  'Stage 18 Task 18.20 — background job runs: task name, tenant (if tenant-scoped), timing, outcome (ok or failed), and optional short summary. Platform-wide facts with no RLS. Read only through keystone.platform_list_job_runs() (gated). No application role holds any grant on this table.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WRITE — the only application write path.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.record_job_run(p_task text, p_tenant_id uuid, p_started timestamptz, p_finished timestamptz, p_outcome text, p_summary text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO keystone_meta.job_run (task, tenant_id, started_at, finished_at, outcome, summary)
  VALUES (p_task, p_tenant_id, p_started, p_finished, p_outcome, p_summary) $$;
REVOKE ALL ON FUNCTION keystone_meta.record_job_run(text, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.record_job_run(text, uuid, timestamptz, timestamptz, text, text) TO app_worker;
GRANT USAGE ON SCHEMA keystone_meta TO app_worker;

COMMENT ON FUNCTION keystone_meta.record_job_run(text, uuid, timestamptz, timestamptz, text, text) IS
  'Stage 18 Task 18.20 — the only application write path into keystone_meta.job_run. EXECUTE to app_worker only; the worker holds no table rights. Wrapped by src/queue/runLedger.mjs.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- READ — the Platform lister. Gated on caller_is_platform() exactly as platform_list_platform_events().
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.platform_list_job_runs()
RETURNS TABLE (task text, runs_7d int, last_started timestamptz, last_finished timestamptz, last_outcome text, last_summary text, last_duration_ms int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH all_runs AS (
    SELECT j.* FROM keystone_meta.job_run j
    WHERE keystone.caller_is_platform()
  )
  SELECT
    a.task,
    count(*) FILTER (WHERE a.finished_at >= now() - '7 days'::interval)::int AS runs_7d,
    (array_agg(a.started_at ORDER BY a.finished_at DESC))[1] AS last_started,
    (array_agg(a.finished_at ORDER BY a.finished_at DESC))[1] AS last_finished,
    (array_agg(a.outcome ORDER BY a.finished_at DESC))[1] AS last_outcome,
    (array_agg(a.summary ORDER BY a.finished_at DESC))[1] AS last_summary,
    (EXTRACT(EPOCH FROM
      ((array_agg(a.finished_at ORDER BY a.finished_at DESC))[1] -
       (array_agg(a.started_at ORDER BY a.finished_at DESC))[1])) * 1000)::int AS last_duration_ms
  FROM all_runs a
  GROUP BY a.task
  ORDER BY a.task $$;
REVOKE ALL ON FUNCTION keystone.platform_list_job_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_job_runs() TO app_rw;

COMMENT ON FUNCTION keystone.platform_list_job_runs() IS
  'Stage 18 Task 18.20 — platform job run summary per task: runs in 7 days, last timing and outcome, summary of the last run. Gated on caller_is_platform() exactly as platform_list_platform_events(). Read by 18.21''s Platform Jobs screen.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE IT, IN THE MIGRATION, IN BOTH DIRECTIONS. A grant nobody has seen refuse is not installed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; c text; bad text[] := '{}';
BEGIN
  -- NEGATIVE: no application role holds ANY table privilege on job_run.
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'keystone_meta.job_run', c) THEN bad := bad || (r || ':' || c); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'job_run is reachable directly: % — app_rw must never read job facts and app_worker holds zero table rights', bad;
  END IF;

  -- The writer: app_worker yes (POSITIVE), app_rw / app_embed / app_signup no.
  IF NOT has_function_privilege('app_worker', 'keystone_meta.record_job_run(text,uuid,timestamptz,timestamptz,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_worker cannot EXECUTE record_job_run — the worker could not record a job run';
  END IF;
  IF has_function_privilege('app_rw', 'keystone_meta.record_job_run(text,uuid,timestamptz,timestamptz,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw can EXECUTE record_job_run — a web process could forge a job run';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_embed')
     AND has_function_privilege('app_embed', 'keystone_meta.record_job_run(text,uuid,timestamptz,timestamptz,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_embed can EXECUTE record_job_run';
  END IF;

  -- The lister: app_rw yes (POSITIVE), app_worker no.
  IF NOT has_function_privilege('app_rw', 'keystone.platform_list_job_runs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE platform_list_job_runs — the Platform route could not read anything';
  END IF;
  IF has_function_privilege('app_worker', 'keystone.platform_list_job_runs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_worker can EXECUTE platform_list_job_runs';
  END IF;

  -- No PUBLIC EXECUTE on either definer.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('keystone_meta.record_job_run(text,uuid,timestamptz,timestamptz,text,text)'::regprocedure,
                              'keystone.platform_list_job_runs()'::regprocedure)
                AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'))) THEN
    RAISE EXCEPTION 'a job_run definer is EXECUTE to PUBLIC';
  END IF;
  RAISE NOTICE 'job_run: writer and lister grants proven in both directions';
END $$;
