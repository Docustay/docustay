-- ★★★ F499 [MEASURED, production and local, identical] — `keystone_meta.outbox_health()` had acl
--     `{=X/auth_owner,auth_owner=X/auth_owner}`. The leading `=X` is EXECUTE TO PUBLIC: every role on
--     the database — app_signup and app_embed included — could run a SECURITY DEFINER function that
--     reads `keystone.event` across every tenant with auth_owner's rights.
--
-- ★★ WHY 0129's OWN REVOKE DID NOTHING. 0129 created the function under `SET LOCAL ROLE auth_owner`,
--    then switched back to app_owner and ran `REVOKE ALL … FROM PUBLIC` and `GRANT EXECUTE … TO
--    app_worker, app_rw, app_owner`. app_owner is NOT the owner and holds no grant option, and
--    Postgres does not fail that: it WARNS ("no privileges could be revoked" / "no privileges were
--    granted") and changes nothing. The statements were in the file; their effect was not in the
--    catalog. So the default PUBLIC grant stayed and the intended grants were never made.
--    (The same trap cannot hit backup_health, alert_transition or worker_beat: app_owner owns them.)
--
-- ★★ THE FIX IS MADE AS THE OWNER. The runner is app_owner, a NOINHERIT member of auth_owner, so it
--    must SET LOCAL ROLE auth_owner for the ACL change and SET LOCAL ROLE app_owner afterwards —
--    never RESET ROLE, which would drop to the connecting superuser for the rest of the file.
--
-- ★ THE RESULTING GRANT SET is its sibling backup_health's: app_worker (watch_system) and app_rw
--   (/api/platform/health — the same systemChecks). 0129 also meant app_owner, only so its own
--   positive control could call the function; the assertion below calls it as the owner instead.
--
-- ★ THE REST OF THE CLASS. db/gates/s3_definers_not_public.mjs, run against the local database
--   BEFORE this migration, found exactly ONE SECURITY DEFINER function in keystone, keystone_meta or
--   keystone_auth executable by PUBLIC: this one. Every resolver the sign-in, signup and embed paths
--   use is granted to its role by name. The gate now keeps it that way.

SET LOCAL ROLE auth_owner;
REVOKE ALL ON FUNCTION keystone_meta.outbox_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.outbox_health() TO app_worker, app_rw;
SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT — the statement is exactly what failed silently in 0129.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn oid := 'keystone_meta.outbox_health()'::regprocedure;
  grantees text;
  r text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0141 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  -- NEGATIVE: PUBLIC, and the two public-facing roles, can no longer execute it.
  IF has_function_privilege('public', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'F499: outbox_health() is still executable by PUBLIC (acl %)',
      (SELECT proacl FROM pg_proc WHERE oid = fn);
  END IF;
  FOREACH r IN ARRAY ARRAY['app_signup', 'app_embed'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'F499: % can still execute outbox_health()', r;
    END IF;
  END LOOP;

  -- POSITIVE: the two callers can.
  FOREACH r IN ARRAY ARRAY['app_worker', 'app_rw'] LOOP
    IF NOT has_function_privilege(r, fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'F499: % lost EXECUTE on outbox_health() — the health check would break', r;
    END IF;
  END LOOP;

  -- EXACT: the explicit acl names the owner and the two callers, nobody else, and no PUBLIC entry.
  SELECT string_agg(g, ',' ORDER BY g)
    INTO grantees
    FROM pg_proc p, aclexplode(p.proacl) a,
         LATERAL (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS g) x
   WHERE p.oid = fn AND a.privilege_type = 'EXECUTE';
  IF grantees IS DISTINCT FROM 'app_rw,app_worker,auth_owner' THEN
    RAISE EXCEPTION 'F499: outbox_health() EXECUTE grantees are %, expected app_rw,app_worker,auth_owner', grantees;
  END IF;
  RAISE NOTICE '0141: outbox_health() EXECUTE grantees = % (PUBLIC revoked)', grantees;
END $$;

-- ★ POSITIVE CONTROL that the function still runs after the change — as its owner, since app_owner
--   (NOINHERIT) has no EXECUTE of its own now.
SET LOCAL ROLE auth_owner;
DO $$
DECLARE result record;
BEGIN
  SELECT * INTO result FROM keystone_meta.outbox_health();
  IF result.pending IS NULL THEN
    RAISE EXCEPTION '0141: outbox_health() returned no row';
  END IF;
END $$;
SET LOCAL ROLE app_owner;
