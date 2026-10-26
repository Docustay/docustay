-- 0625_install_needs_setup — a self-hosted install is "new" while no organisation exists, ignoring the closed placeholder practice the fresh-database build leaves behind (it exists only so migration 0010's
-- guard has a staff row to count). Supersedes keystone.setup_needed() (0624), which counted the placeholder and so could never say "needs setup" on a built database. (0624 is already applied and is not edited.)
CREATE OR REPLACE FUNCTION keystone.install_needs_setup() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = keystone, pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM keystone.tenant WHERE slug <> 'bootstrap-placeholder')
$$;
REVOKE ALL ON FUNCTION keystone.install_needs_setup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.install_needs_setup() TO app_rw;
-- the tenant table is only readable by auth_owner (the identity-lookup owner), as for resolve_tenant_by_slug
ALTER FUNCTION keystone.install_needs_setup() OWNER TO auth_owner;
