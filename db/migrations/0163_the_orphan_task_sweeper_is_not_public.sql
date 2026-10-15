-- 0163_the_orphan_task_sweeper_is_not_public
-- Stage 4 Task 14 · Phase B · task-14-review.md MN-2.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0044'S TRAP, ONE MORE TIME. A new function is EXECUTE-able by PUBLIC until told otherwise. 0157
-- remembered that for the function it created (`keystone.document_exists_in_practice`, 0157:119-121)
-- and 0145/0156/0158/0159/0160/0161 remembered it for theirs. The three functions 0056/0058 created
-- — which 0157 then rewrote — never did, so they still carry `=X/app_owner`:
--
--     keystone.task_subject_checkable_types()
--     keystone.task_subject_exists(text, uuid)
--     keystone.close_tasks_with_missing_subjects()
--
-- ★★ THIS IS A FOOTGUN REMOVED, NOT A HOLE CLOSED, and saying which one matters. MEASURED, before
--    this migration: `app_embed`, `app_signup` and `app_worker` hold neither SELECT nor UPDATE on
--    `keystone.task` or on any subject table, and all three functions are INVOKER (not definer —
--    `prosecdef = f`), so every read and write inside them is still filtered by the CALLER's grants
--    and the CALLER's RLS. A PUBLIC caller could only ever learn what it could already read.
--    What PUBLIC execute costs is the audit: "who can run the orphan sweeper" had no answer smaller
--    than "everyone", and the sweeper's whole job is closing other people's work.
--
-- ★ app_rw already holds EXECUTE explicitly (`app_rw=X/app_owner`), which is why the REVOKE does not
--   take the sweeper away from the one role that runs it (src/queue/tasks.mjs:973, inside
--   `withTenant`). The GRANTs below are therefore re-affirmations, written out so the end state is
--   visible in one place rather than inferred from three migrations.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $precondition$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0163: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
END
$precondition$;

-- ── §1 · REVOKE, THEN RE-GRANT THE ONE ROLE THAT CALLS THEM ──────────────────────────────────────
REVOKE ALL ON FUNCTION keystone.task_subject_checkable_types()          FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.task_subject_exists(text, uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.close_tasks_with_missing_subjects()     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION keystone.task_subject_checkable_types()       TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.task_subject_exists(text, uuid)      TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.close_tasks_with_missing_subjects()  TO app_rw;

-- ── §2 · THE TWO-SIDED ACL SELF-TEST (0141/0145 pattern) ─────────────────────────────────────────
DO $assert$
DECLARE
  f record;
  v_closed int; v_skipped int;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0163 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  FOR f IN
    SELECT p.oid::regprocedure::text AS sig, p.prosecdef,
           has_function_privilege('app_rw',     p.oid, 'EXECUTE') AS rw,
           has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
           has_function_privilege('app_embed',  p.oid, 'EXECUTE') AS embed,
           has_function_privilege('app_signup', p.oid, 'EXECUTE') AS signup,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public
      FROM pg_proc p
     WHERE p.oid IN ('keystone.task_subject_checkable_types()'::regprocedure,
                     'keystone.task_subject_exists(text, uuid)'::regprocedure,
                     'keystone.close_tasks_with_missing_subjects()'::regprocedure)
  LOOP
    -- ★ THE POSITIVE HALF: the sweeper's own role must still be able to run it. A REVOKE that took
    --   EXECUTE away from everyone would satisfy the negative half perfectly and break the product.
    IF NOT f.rw THEN
      RAISE EXCEPTION '0163: app_rw lost EXECUTE on % — the sweeper cannot run', f.sig;
    END IF;
    -- ★ THE NEGATIVE HALF.
    IF f.public OR f.worker OR f.embed OR f.signup THEN
      RAISE EXCEPTION '0163: % is still reachable — PUBLIC=% worker=% embed=% signup=%',
        f.sig, f.public, f.worker, f.embed, f.signup;
    END IF;
    -- ★ And none of the three may quietly have become a definer: the argument above ("a PUBLIC caller
    --   could only learn what it could already read") rests entirely on them being INVOKER.
    IF f.prosecdef THEN
      RAISE EXCEPTION '0163: % is SECURITY DEFINER — its grants mean something different now', f.sig;
    END IF;
  END LOOP;

  -- ★★ RUNTIME PROBE as the real role, against a practice id that exists nowhere: the sweep must run
  --    to completion (not raise "permission denied") and touch nothing.
  PERFORM set_config('keystone.tenant_id', keystone.uuid_generate_v7()::text, true);
  PERFORM set_config('keystone.user_id', '', true);
  SET LOCAL ROLE app_rw;
  SELECT s.closed_count, s.skipped_unverifiable INTO v_closed, v_skipped
    FROM keystone.close_tasks_with_missing_subjects() s;
  SET LOCAL ROLE app_owner;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_closed IS DISTINCT FROM 0 OR v_skipped IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '0163: the probe sweep in an empty practice reported closed=% skipped=%', v_closed, v_skipped;
  END IF;
END
$assert$;
