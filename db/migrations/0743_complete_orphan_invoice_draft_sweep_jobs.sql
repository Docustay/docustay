-- FOUND 14 Oct 2026: nine graphile jobs for task `invoice_draft_sweep` (one per workspace, run_at 2 Oct 10:00 UTC, attempts 0) have waited 12+ days.
-- The task was REMOVED from the code (commit 1e7122f38, "remove the live Stripe draft, build one invoice once at Send"), so no worker registers it
-- and graphile never picks the jobs up. They are the "oldest due job" the health watcher reports and they can never run. Completing them removes
-- queue rows only (no person's data, no ledger row); a task name that IS registered is never touched. Idempotent; skipped where graphile_worker is absent.
DO $$
DECLARE ids bigint[];
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'graphile_worker') THEN
    SELECT array_agg(id) INTO ids FROM graphile_worker.jobs WHERE task_identifier = 'invoice_draft_sweep' AND attempts = 0 AND locked_at IS NULL;
    IF ids IS NOT NULL THEN PERFORM graphile_worker.complete_jobs(ids); END IF;
  END IF;
END $$;
