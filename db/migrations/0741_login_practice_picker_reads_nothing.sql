-- 0741 — R10-54. THE PRACTICE PICKER RETURNED AN EMPTY LIST, SO A PERSON IN TWO WORKSPACES COULD NOT SIGN IN.
--
-- Found by Run 10 journey FJ-003: an agency person invited to a client's workspace with the email they already use accepted, and from then on
-- `POST /api/auth/login` answered { needsPracticePick: true, practices: [] } and the sign-in page stayed on /login with no message.
-- Cause: login.mjs read `keystone.tenant` directly inside withCredentialLookup, which sets no tenant context, so forced row-level security
-- hid every row. The only way an unauthenticated caller may read tenant facts is a named `keystone.resolve_*` definer owned by auth_owner
-- (see 0121/0125). This adds one: the name, slug and logo for the tenant ids the CALLER'S OWN identity already belongs to.
-- Additive; no data touched. Returns nothing for suspended/closed workspaces (same rule as resolve_login_branding_by_slug).
BEGIN;
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.resolve_login_practices(p_ids uuid[])
RETURNS TABLE (slug text, display_name text, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.slug,
         COALESCE(NULLIF(pn.value #>> '{}', ''), t.name) AS display_name,
         NULLIF(lo.value #>> '{}', '')                   AS logo_url
  FROM keystone.tenant t
  LEFT JOIN keystone.tenant_setting pn ON pn.tenant_id = t.id AND pn.key = 'practice.name'
  LEFT JOIN keystone.tenant_setting lo ON lo.tenant_id = t.id AND lo.key = 'branding.logo_url'
  WHERE t.id = ANY(p_ids) AND t.status = 'active'
  ORDER BY t.name
$$;

REVOKE ALL ON FUNCTION keystone.resolve_login_practices(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_login_practices(uuid[]) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.resolve_login_practices(uuid[]) IS
  'R10-54 — the practice picker: slug, display name and logo for the workspaces one signed-in identity belongs to. Called only from src/auth/login.mjs with ids that identity''s own memberships produced.';

RESET ROLE;
COMMIT;
