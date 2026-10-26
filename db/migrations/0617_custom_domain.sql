-- 0617 — OWN-DOMAIN SIGNING LINKS (QUEUE §25.4). A workspace (Mainstay or Docustay) can serve its sign / verify pages from its own hostname, e.g. sign.example.com.
-- One row per hostname a workspace attached. The row tracks OUR view of it: the Railway custom-domain id, the DNS records the owner must (or we did) add, and when TLS went live.
-- ★ Additive, one table + one lookup function. RLS FORCED: staff of the tenant read/write their own rows; nothing is deleted (a removed domain is status 'removed', kept for the record).
-- ★ The lookup function answers ONE question for a request that arrives on an unknown Host before any tenant exists: "is this hostname one a workspace attached, and is it usable?" It returns text only (the status), never a tenant or a row.
CREATE TABLE keystone.custom_domain (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id),
  hostname           text        NOT NULL CHECK (hostname = lower(hostname) AND length(hostname) BETWEEN 4 AND 253 AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verifying','live','failed','removed')),
  dns_mode           text        NOT NULL DEFAULT 'manual' CHECK (dns_mode IN ('porkbun','manual')),
  railway_domain_id  text,
  records            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  certificate_status text,
  last_error         text        CHECK (last_error IS NULL OR length(last_error) <= 500),
  last_checked_at    timestamptz,
  live_at            timestamptz,
  removed_at         timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX custom_domain_hostname_in_use ON keystone.custom_domain (hostname) WHERE status <> 'removed';
CREATE INDEX custom_domain_by_tenant ON keystone.custom_domain (tenant_id, created_at DESC);
ALTER TABLE keystone.custom_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.custom_domain FORCE  ROW LEVEL SECURITY;
CREATE POLICY staff_read   ON keystone.custom_domain FOR SELECT
  USING (tenant_id = keystone.current_tenant_id() AND EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff'));
CREATE POLICY staff_insert ON keystone.custom_domain FOR INSERT
  WITH CHECK (tenant_id = keystone.require_tenant_id() AND EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff'));
CREATE POLICY staff_update ON keystone.custom_domain FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id() AND EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff'))
  WITH CHECK (tenant_id = keystone.current_tenant_id());
-- a signing link is built inside a signer's or a sweep's transaction, which has no staff viewer: it may read ONLY the live hostname of its own tenant
CREATE POLICY live_read    ON keystone.custom_domain FOR SELECT
  USING (tenant_id = keystone.current_tenant_id() AND status = 'live');
GRANT SELECT, INSERT, UPDATE ON keystone.custom_domain TO app_rw;
GRANT SELECT ON keystone.custom_domain TO app_worker;

-- the lookup function runs as the table's owner, and FORCE RLS applies to the owner: this policy is what lets the function (and only the owner role, which no request ever uses) answer a host question with no tenant yet
CREATE POLICY host_lookup  ON keystone.custom_domain FOR SELECT TO app_owner USING (true);
CREATE FUNCTION keystone.custom_domain_host_status(p_host text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.status FROM keystone.custom_domain d
  WHERE d.hostname = lower(p_host) AND d.status IN ('pending','verifying','live')
$$;
REVOKE ALL ON FUNCTION keystone.custom_domain_host_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.custom_domain_host_status(text) TO app_rw, app_owner;
COMMENT ON TABLE keystone.custom_domain IS 'A hostname a workspace attached to serve its signing links (Railway custom domain). Never deleted; removal is a status.';
COMMENT ON FUNCTION keystone.custom_domain_host_status(text) IS 'Host -> status text for a request on an unknown Host before a tenant exists. Returns text only: no tenant, no row.';
