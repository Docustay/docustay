-- 0031_uid_resolver_owner
-- P17.9 — D-17.27. ★★★ SECURITY DEFINER IS NOT A BYPASS. THE *OWNER* IS WHAT MATTERS, AND
--                      keystone.app_user IS FORCE RLS.
--
-- ★★★ THE MEASUREMENT. [EXECUTED 2026-09-13] as `app_rw`, with no tenant context — the exact
-- condition `withCredentialLookup` runs in:
--       SELECT keystone.resolve_tenant_by_slug('y1-alpha')            →  a uuid
--       SELECT count(*) FROM keystone.resolve_tenants_by_firebase_uid(…)  →  0
--     Two SECURITY DEFINER functions, same schema, same search_path, opposite results. The
--     difference is not in the bodies:
--       resolve_tenant_by_slug            owned by **auth_owner**
--       resolve_tenants_by_firebase_uid   owned by **app_owner**   ← mine, from 0030
--     ★★ `keystone.tenant` carries `tenant_health_read | FOR SELECT TO auth_owner USING (true)`.
--        THAT policy — not the definer keyword — is why the slug resolver can read a tenant before
--        any tenant context exists. My function inherited only `tenant_isolation`
--        (`id = current_tenant_id()`), and with no GUC set that admits nothing, so it returned an
--        empty set and login answered `invalid credential` to a valid credential.
--
-- ★★★ THIS IS THE SAME LESSON AS D-12.0's `FORCE ROW LEVEL SECURITY` NOTE, ARRIVING A THIRD TIME:
--     FORCE applies policies to the table OWNER TOO, and neither `SECURITY DEFINER` nor owning the
--     table buys an exemption. ONLY a policy naming the definer's owner, or a BYPASSRLS role, does.
--     ★ Recorded this bluntly because it has now cost three separate wrong-cause investigations in
--       this project, and each time the code "looked like" it should work.
--
-- ★ WHY MOVE THE OWNER RATHER THAN ADD A POLICY FOR app_owner: `auth_owner` is already the
--   established owner of credential-resolution definers (it is NOLOGIN, NOBYPASSRLS, and owns
--   `keystone_auth`), and the login path's other resolver is already one of them. Two resolvers on
--   one code path owned by two different roles, with two different policy sets, is the kind of
--   asymmetry that produces exactly the bug above.

ALTER FUNCTION keystone.resolve_tenants_by_firebase_uid(text) OWNER TO auth_owner;

-- ★★★ AND THE POLICY IT NEEDS, AS NARROW AS THE FUNCTION'S ACTUAL JOB.
-- ★★ NOT `USING (true)`. The function only ever asks "which tenants has this uid got a row in", so
--    the policy admits ONLY rows that CARRY a uid. Every person created by staff who has never
--    signed in — the majority of a practice's client list — stays invisible to this role entirely.
--    A resolver that cannot see a row cannot leak it, whatever a future body does.
-- ★ It is SELECT-only. auth_owner gets no INSERT, UPDATE or DELETE on app_user, so the credential
--   path cannot modify a person, cannot change a staff_role, and cannot re-point a firebase_uid.
CREATE POLICY credential_uid_lookup ON keystone.app_user
  FOR SELECT TO auth_owner
  USING (firebase_uid IS NOT NULL);

COMMENT ON POLICY credential_uid_lookup ON keystone.app_user IS
  'P17.9 / D-17.27. Lets the auth_owner-owned SECURITY DEFINER resolvers read the uid→tenant links, '
  'and NOTHING else: SELECT only, and only rows that already carry a firebase_uid, so people who '
  'have never signed in are invisible to the credential path. Required because app_user is FORCE '
  'RLS — SECURITY DEFINER alone grants no exemption, only a policy naming the owner does, which is '
  'why the same function returned rows under auth_owner and an empty set under app_owner.';

-- ★ Column-level privilege, not table-wide: the body reads exactly these two.
GRANT SELECT (firebase_uid, tenant_id) ON keystone.app_user TO auth_owner;
