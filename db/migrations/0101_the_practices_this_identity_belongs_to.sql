-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P5.1 — THE TENANT SWITCHER NEEDS TO NAME THE PRACTICES, AND NOTHING COULD.
--
-- ★★★ `resolve_tenants_by_firebase_uid` returns IDS. A switcher showing a person two uuids has not
--     been built. The NAMES live in `keystone.tenant`, and a signed-in session is scoped to ONE
--     tenant — so `tenant_isolation` hides every other practice from the very query that needs
--     them. **The switcher is not blocked by a missing route; it is blocked by RLS, correctly.**
--
-- ★★ SO IT IS A DEFINER OWNED BY `auth_owner`, THE SAME PATTERN AND THE SAME OWNER AS THE RESOLVER
--    IT SITS BESIDE. `keystone.tenant` already carries `tenant_health_read FOR SELECT TO auth_owner
--    USING (true)` (0017), which is why THIS owner can read a tenant row and `app_owner` cannot —
--    the lesson 0100 had to relearn the hard way.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT IT DELIBERATELY DOES NOT DO.
--   · It does NOT take a tenant id — only a uid. There is no way to ask it "who else is in
--     practice X"; it can only answer "which practices is THIS identity in", which is a fact about
--     the caller rather than an oracle about anybody else.
--   · It returns ONLY active practices. A suspended practice in a switcher is a door that opens
--     onto a refusal, and `resolve_tenants_by_firebase_uid` already applies the same status gate —
--     a switcher listing a practice login would then reject is worse than one that omits it.
--   · It returns NO counts, NO roles, NO membership dates. The switcher needs a name to show and a
--     slug to log in with. Everything else would be a second, unasked question answered across a
--     tenant boundary.
-- ★ The ARCHIVED person is excluded by `credential_uid_lookup` (0097) without this function
--   mentioning it — the policy hides the row, so an archived identity's practices simply are not
--   there. One rule, one place, and it already covers this new reader.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.practices_for_firebase_uid(p_uid text)
RETURNS TABLE (id uuid, slug text, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.slug, t.name
    FROM keystone.app_user u
    JOIN keystone.tenant  t ON t.id = u.tenant_id
   WHERE u.firebase_uid = p_uid
     AND p_uid IS NOT NULL
     AND p_uid <> ''
     AND t.status = 'active'
   ORDER BY t.name
$$;

REVOKE ALL ON FUNCTION keystone.practices_for_firebase_uid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.practices_for_firebase_uid(text) TO app_rw;

-- ★★ `auth_owner` NEEDS `name` AND `slug` ON app_user's JOIN PARTNER, NOT ON app_user ITSELF. 0031
--    granted it column-level SELECT on (firebase_uid, tenant_id) ON PURPOSE, and this function
--    reads exactly those two from `app_user` — naming a third would be
--    "permission denied for table app_user" and would break LOGIN, not just the switcher (0096).
COMMENT ON FUNCTION keystone.practices_for_firebase_uid(text) IS
  'P5.1 — the practices one identity belongs to, by name, for the tenant switcher. ★★★ A DEFINER '
  'because a signed-in session is scoped to ONE tenant and tenant_isolation hides the others from '
  'the caller. Owned by auth_owner, which keystone.tenant admits via tenant_health_read (0017). '
  'Takes a uid ONLY — it cannot be asked who else is in a practice. Active practices only, matching '
  'the status gate login already applies, so the switcher never offers a door that then refuses.';

RESET ROLE;
