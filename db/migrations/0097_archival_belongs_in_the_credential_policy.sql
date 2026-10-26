-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CORRECTS 0096 — WHICH BROKE LOGIN FOR EVERYBODY, AND WAS CAUGHT BY ITS OWN POSITIVE CONTROL.
--
-- ★★★ [EXECUTED, immediately after 0096] the FIRST call — the LIVE, un-archived person, the
--     positive control — failed:
--
--       error: permission denied for table app_user
--       where: SQL function "resolve_tenants_by_firebase_uid" statement 1
--
--     0096 added `AND u.archived_at IS NULL` to the resolver body. 0031 had granted `auth_owner`
--     **column-level** SELECT on exactly two columns:
--
--       GRANT SELECT (firebase_uid, tenant_id) ON keystone.app_user TO auth_owner;
--
--     Reading a third column is a privilege error, not a wrong answer — so the resolver stopped
--     returning ANY tenant for ANY uid, and nobody could sign in.
--   ★★ THE NEGATIVE ASSERTION ALONE WOULD HAVE PASSED. "An archived person resolves 0 tenants" was
--      true — because EVERY person resolved 0 tenants. It is the paired positive that failed, and
--      that is the whole reason the rule exists. §MUTATION's words: *"a 'must not' with no paired
--      'must' passes when everything is broken."*
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FIX IS THE POLICY, NOT A WIDER GRANT — AND IT IS BETTER THAN WHAT 0096 ATTEMPTED.
--
--   The obvious repair is `GRANT SELECT (archived_at) ... TO auth_owner`, and it would work. This
--   does it in the policy instead, for a reason 0031 already wrote down about itself:
--     *"A resolver that cannot see a row cannot leak it, whatever a future body does."*
--
--   ★★ Put in `credential_uid_lookup`, the archived person becomes invisible to the CREDENTIAL PATH
--      AS A WHOLE — to this resolver, and to every other auth_owner-owned definer that reads
--      app_user, including ones not yet written. Put in one function body, it protects that one
--      function and the next resolver starts again from nothing.
--   ★ And it needs no new privilege. A policy's USING expression is part of the table's own
--      security definition and is not subject to the column ACL a query's own references are, so
--      the grant stays at the two columns 0031 chose on purpose.
--
-- ★ The body's line is removed in the same migration. Two mechanisms for one rule is the
--   DUPLICATE-TRUTH class this register has recorded six times; the policy is the one that holds.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP POLICY credential_uid_lookup ON keystone.app_user;

CREATE POLICY credential_uid_lookup ON keystone.app_user
  FOR SELECT TO auth_owner
  USING (firebase_uid IS NOT NULL AND archived_at IS NULL);

COMMENT ON POLICY credential_uid_lookup ON keystone.app_user IS
  'P17.9 / D-17.27, extended at P2 CLOSE. Lets the auth_owner-owned SECURITY DEFINER resolvers read '
  'the uid→tenant links, and NOTHING else: SELECT only, only rows that already carry a firebase_uid, '
  'and ★★★ only rows that are NOT ARCHIVED — archival revokes a person, so the credential path must '
  'not be able to see them at all. Expressed here rather than in a resolver body because a row this '
  'policy hides cannot be leaked by any future function, and because the grant is deliberately '
  'column-level (firebase_uid, tenant_id) — a body reading archived_at is a privilege error.';

-- ★★ THE BODY GOES BACK TO READING ONLY THE TWO GRANTED COLUMNS. Identical to its pre-0096 text.
SET ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.resolve_tenants_by_firebase_uid(p_uid text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id
    FROM keystone.app_user u
    JOIN keystone.tenant  t ON t.id = u.tenant_id
   WHERE u.firebase_uid = p_uid
     AND p_uid IS NOT NULL
     AND p_uid <> ''
     -- ★★ THE SAME STATUS GATE AS resolve_tenant_by_slug. Disabling a tenant must log its people
     --    out of it, and that cannot depend on which resolver the login path happens to call.
     AND t.status = 'active'
     -- ★★★ THERE IS NO archived_at TEST HERE AND THERE MUST NOT BE. auth_owner holds SELECT on
     --     (firebase_uid, tenant_id) ONLY, so naming a third column here is
     --     "permission denied for table app_user" and login stops working for everybody — MEASURED,
     --     by 0096, which did exactly that. The archived person is excluded by the
     --     credential_uid_lookup POLICY above, where it costs no privilege and covers every
     --     resolver rather than this one.
   ORDER BY t.id
$$;

COMMENT ON FUNCTION keystone.resolve_tenants_by_firebase_uid(text) IS
  'Login-time membership resolution. ★★★ An archived person resolves NO tenants — enforced by the '
  'credential_uid_lookup policy on app_user, NOT by a predicate in this body: auth_owner has '
  'column-level SELECT on (firebase_uid, tenant_id) only, so reading archived_at here is a '
  'privilege error that breaks login for everybody (0096, reverted by 0097).';

RESET ROLE;
