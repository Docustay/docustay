-- 0647_job_run_retention
-- D-021 (Part 32 addendum 2, found on the sandbox 6 Oct): keystone_meta.job_run had NO retention. Every background task writes one row per run per practice; the sandbox (about 40 test workspaces) wrote about 900,000 rows a day (3.2 million, 642 MB in 3.5 days) and filled its 2 GB database volume, after which sign-ups answered 500. In production the same growth is practice-count x tasks x minutes, so it would have filled the production volume.
-- Fix: record_job_run keeps its signature and grants, and every 50th insert (by row id, so it is deterministic and costs one small delete per 50 runs) deletes at most 5,000 old rows: finished more than 14 days ago when ok, more than 90 days ago when failed. The Platform lister reads a 7-day window, so nothing visible changes.
-- Additive and idempotent: CREATE OR REPLACE of the same function; no table change.
CREATE OR REPLACE FUNCTION keystone_meta.record_job_run(p_task text, p_tenant_id uuid, p_started timestamptz, p_finished timestamptz, p_outcome text, p_summary text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO keystone_meta.job_run (task, tenant_id, started_at, finished_at, outcome, summary)
  VALUES (p_task, p_tenant_id, p_started, p_finished, p_outcome, p_summary) RETURNING id INTO v_id;
  IF v_id % 50 = 0 THEN
    DELETE FROM keystone_meta.job_run
     WHERE id IN (SELECT id FROM keystone_meta.job_run
                   WHERE (outcome = 'ok' AND finished_at < now() - interval '14 days') OR (outcome = 'failed' AND finished_at < now() - interval '90 days')
                   ORDER BY id LIMIT 5000);
  END IF;
END $$;
REVOKE ALL ON FUNCTION keystone_meta.record_job_run(text, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.record_job_run(text, uuid, timestamptz, timestamptz, text, text) TO app_worker;
