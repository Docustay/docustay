-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P6.81 — LET THE PLATFORM READ THE WORKER QUEUE, SO A STUCK JOB IS VISIBLE.
--
-- ★★★ THERE ARE TWO QUEUES AND THE SCREEN ONLY EVER SHOWED ONE.
--     `/platform/jobs` is titled "Job queue" and reads `keystone.event` — the OUTBOX, which on the
--     deployed database is 66 rows and 100% processed, i.e. permanently reassuring.
--     Meanwhile `graphile_worker.jobs` — the queue that actually runs work — holds
--     [MEASURED 2026-09-15 on deployed] **97 jobs, every one of them carrying a `last_error`**:
--         archive_document_pdf        87 jobs, 8–13 attempts of 25
--         deliver_notification_email  10 jobs, 13 attempts of 25
--     Nothing in the product reads that table. ★★ The build doc recorded 29 such jobs; it is now 97.
--     **It tripled BECAUSE nobody can see it** — that is what an invisible queue does.
--
-- ★★ WHY A GRANT IS NEEDED AT ALL. `graphile_worker` and its `jobs` view are owned by `app_worker`,
--    and [MEASURED] `app_rw` had neither USAGE on the schema nor SELECT on the view. A descriptor
--    reading it would not have shown an empty list — it would have raised a permission error on the
--    one screen whose job is to report errors.
--
-- ★★★ AND WHY THIS IS SAFE, WHICH IS THE PART THAT MATTERS. `graphile_worker.jobs` IS NOT
--     TENANT-SCOPED AND RLS DOES NOT APPLY TO IT. The only surface that reads it is `/platform/jobs`,
--     and `src/nav/authorise.mjs:102-105` refuses every `/platform` row unless BOTH hold:
--       · the tenant's `is_platform` is true — read FROM THE DATABASE, never from a client claim, and
--       · the caller's rank is exactly `super_admin_1`.
--     That is the platform namespace doing its job. ★ A SELECT grant to `app_rw` is still a real
--     widening: any future route could read it. The mitigation is that it is READ-ONLY and that the
--     one consumer is platform-gated — recorded here so the next person weighs it knowingly.
--
-- ★★ THE ROLE DANCE IS DELIBERATE AND IS NOT AN ESCALATION HATCH. Migrations run as `app_owner`,
--    which [MEASURED] is NOT a member of `app_worker` and therefore cannot grant on `app_worker`'s
--    objects. The connecting superuser IS a member, so this resets to it, becomes the OWNER, grants,
--    and hands the session back to `app_owner`. Nothing else in this file runs elevated.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- ★ Guarded, because a fresh database may not have run the worker's own migrations yet. Absence is
  --   a legitimate state; a FAILED GRANT on a schema that IS present is not, and still raises.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RESET ROLE;                      -- back to the connecting superuser
    SET LOCAL ROLE app_worker;       -- become the owner of the schema and the view
    GRANT USAGE ON SCHEMA graphile_worker TO app_rw;
    GRANT SELECT ON graphile_worker.jobs TO app_rw;
    SET LOCAL ROLE app_owner;        -- and hand the session straight back
    RAISE NOTICE 'granted app_rw read on graphile_worker.jobs';
  ELSE
    RAISE NOTICE 'graphile_worker schema absent — nothing to grant';
  END IF;
END $$;
