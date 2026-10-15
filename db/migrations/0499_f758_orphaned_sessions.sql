-- 0499_f758_orphaned_sessions
--
-- F758 — RULED 25 Sep 2026 (the maintainer delegated: "decide and record: clean them or carry them"). CLEAN.
--
-- MEASURED on production (read-only, 25 Sep 2026): 619 rows in keystone_auth.session, 403 of them
-- pointing at an app_user AND a tenant that no longer exist (one user 01a09f6c-0fb6-749d…, one tenant
-- 01a09f6c-0fb5-7be7…). All three session FKs are marked VALID yet are violated in place — the parent
-- rows were removed around them with triggers bypassed. Consequences of carrying them:
--   · a pg_dump of production does NOT restore: the FK re-attach fails (it did, for this rehearsal),
--     so the backup is not a backup;
--   · they are sign-ins for an identity nobody can hold — no data, no owner, no use.
-- A session row carries no client data. Deleting a dead session is what sign-out does.
--
-- keystone_auth.session is owned by auth_owner with a deny_all policy (RLS on, not forced), so the
-- owner performs the delete. The count is not hard-coded — the rehearsal copy and production differ.

SET LOCAL ROLE auth_owner;

DO $f758$
DECLARE
  v_orphans integer;
  v_gone    integer;
  v_live    integer;
BEGIN
  -- ★ tenant_id and app_user_id are NULLABLE (a sign-in before a practice is chosen); NULL is not
  --   an orphan — only a value pointing at nothing is.
  SELECT count(*) INTO v_live FROM keystone_auth.session s
   WHERE NOT ((s.app_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.app_user_id))
             OR (s.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = s.tenant_id))
             OR (s.viewing_as_app_user_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.viewing_as_app_user_id)));

  SELECT count(*) INTO v_orphans FROM keystone_auth.session s
   WHERE (s.app_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.app_user_id))
      OR (s.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = s.tenant_id))
      OR (s.viewing_as_app_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.viewing_as_app_user_id));

  DELETE FROM keystone_auth.session s
   WHERE (s.app_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.app_user_id))
      OR (s.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = s.tenant_id))
      OR (s.viewing_as_app_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.viewing_as_app_user_id));
  GET DIAGNOSTICS v_gone = ROW_COUNT;

  IF v_gone <> v_orphans THEN
    RAISE EXCEPTION '0499: counted % orphaned sessions but deleted % — the owner could not see them all', v_orphans, v_gone;
  END IF;

  -- POSITIVE CONTROL: every session that pointed at a real user and tenant is still there.
  IF (SELECT count(*) FROM keystone_auth.session) <> v_live THEN
    RAISE EXCEPTION '0499: live sessions changed — expected %, found %', v_live, (SELECT count(*) FROM keystone_auth.session);
  END IF;

  IF EXISTS (SELECT 1 FROM keystone_auth.session s
              WHERE (s.app_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.app_user_id))
                      OR (s.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = s.tenant_id))
                      OR (s.viewing_as_app_user_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = s.viewing_as_app_user_id))) THEN
    RAISE EXCEPTION '0499: orphaned sessions remain after the delete';
  END IF;

  RAISE NOTICE '0499 F758: % orphaned session(s) removed, % live session(s) kept', v_gone, v_live;
END
$f758$;

SET LOCAL ROLE app_owner;
