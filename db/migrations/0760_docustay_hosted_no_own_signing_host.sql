-- 0760 · Docustay v1 item 9: the HOSTED Docustay service has no own signing address any more (one signing page, on Docustay's own host).
-- A hostname a Docustay workspace attached earlier stays in keystone.custom_domain (never deleted) but stops answering: the two lookups used by the host guard and by public pages on a
-- workspace's own domain return nothing for a Docustay workspace. the platform workspaces are unchanged. A self-hosted install never asks (every host is the owner's own: customHost.mjs isPlatformHost).
CREATE OR REPLACE FUNCTION keystone.custom_domain_host_status(p_host text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.status FROM keystone.custom_domain d
  WHERE d.hostname = lower(p_host) AND d.status IN ('pending','verifying','live')
    AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = d.tenant_id AND t.product = 'docustay')
$$;

CREATE OR REPLACE FUNCTION keystone.custom_domain_host_tenant(p_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.tenant_id FROM keystone.custom_domain d
  WHERE d.hostname = lower(p_host) AND d.status = 'live'
    AND NOT EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = d.tenant_id AND t.product = 'docustay')
$$;
