-- §25.4 / F910 — a workspace's OWN hostname must find its workspace for the public pages that need one (the self-serve link /s/<slug>).
-- Like keystone.resolve_tenant_by_slug it answers a uuid for a public name; unlike the status function it answers ONLY for a hostname that is live (DNS verified + certificate issued).
CREATE FUNCTION keystone.custom_domain_host_tenant(p_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.tenant_id FROM keystone.custom_domain d
  WHERE d.hostname = lower(p_host) AND d.status = 'live'
$$;
REVOKE ALL ON FUNCTION keystone.custom_domain_host_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.custom_domain_host_tenant(text) TO app_rw;
COMMENT ON FUNCTION keystone.custom_domain_host_tenant(text) IS 'Live custom hostname -> its workspace id, for public pages on a workspace''s own domain. Nothing else is returned; unknown or not-yet-live hosts get NULL.';
