-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P6.81 — THE GRANT, DONE PROPERLY, AND CHECKED AFTERWARDS.
--
-- ★★★ `0104` REPORTED `ok (1ms)` AND GRANTED NOTHING. That is the whole lesson and it is worth more
--     than the grant itself:
--       **`GRANT` BY A ROLE THAT LACKS THE GRANT OPTION RAISES A *WARNING*, NOT AN ERROR.**
--     Postgres prints `WARNING: no privileges were granted for ...` and the statement SUCCEEDS. A
--     migration runner reading exit status — and this one reads statement success — records the
--     migration as applied. The schema is then permanently marked done and the privilege does not
--     exist. ★★ Same family as the deploy that "succeeded" while shipping nothing: **the thing that
--     reports success is not the thing that did the work.**
--
-- ★★ AND THE REASON 0104 LACKED THE OPTION IS THE SECOND LESSON: IT ASSUMED AN OWNER.
--    [MEASURED 2026-09-15] `graphile_worker` is owned by **`app_worker` on deployed** and by
--    **`keystone_admin` locally**. 0104 hard-coded `SET LOCAL ROLE app_worker`, which is the owner on
--    one database and a stranger on the other. ★★★ **Ownership is environment state, not a constant** —
--    so this file does not name an owner at all. It resets to the CONNECTING role, which is a
--    superuser on both, and lets that role grant.
--
-- ★★★ AND IT VERIFIES ITSELF. A migration whose whole purpose is a privilege must ASSERT the
--     privilege afterwards, or it can only ever report that it ran. This one raises if `app_rw`
--     cannot read the view when it finishes — so it is impossible for this to be marked applied
--     again while doing nothing.
--
-- ★ WHY THE PRIVILEGE IS WANTED: `/platform/jobs` shows the OUTBOX (`keystone.event`, 100% processed
--   and permanently reassuring) while `graphile_worker.jobs` holds 97 jobs every one of which carries
--   a `last_error`. Read-only, and the only consumer is platform-gated — `authorise.mjs:102-105`
--   requires `tenant.is_platform` READ FROM THE DATABASE plus rank `super_admin_1`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RAISE NOTICE 'graphile_worker schema absent — nothing to grant';
    RETURN;
  END IF;

  -- ★ The connecting role, whoever it is. No owner is named: see the header.
  RESET ROLE;
  GRANT USAGE  ON SCHEMA graphile_worker TO app_rw;
  GRANT SELECT ON graphile_worker.jobs  TO app_rw;

  -- ★★★ THE POST-CONDITION. Without this the file is indistinguishable from 0104.
  IF NOT has_schema_privilege('app_rw', 'graphile_worker', 'USAGE')
     OR NOT has_table_privilege('app_rw', 'graphile_worker.jobs', 'SELECT') THEN
    RAISE EXCEPTION
      'GRANT did not take effect: app_rw still cannot read graphile_worker.jobs. '
      'The connecting role (%) lacks the grant option on objects owned by %. '
      'Postgres WARNS rather than errors on such a GRANT, which is why 0104 reported success.',
      current_user, (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'graphile_worker');
  END IF;

  SET LOCAL ROLE app_owner;   -- hand the session back to the migration's own role
  RAISE NOTICE 'app_rw can now read graphile_worker.jobs';
END $$;
