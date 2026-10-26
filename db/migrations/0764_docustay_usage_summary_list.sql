-- 0764 · Docustay v1 item 24: the monthly usage summary email. The worker needs the workspaces that had billable usage in a month (ids only).
GRANT SELECT (tenant_id, occurred_at) ON keystone.docustay_usage_event TO auth_owner;
DROP POLICY IF EXISTS docustay_usage_summary_read ON keystone.docustay_usage_event;
CREATE POLICY docustay_usage_summary_read ON keystone.docustay_usage_event FOR SELECT TO auth_owner USING (true);
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone_auth.list_docustay_usage_tenants(p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 500)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT DISTINCT u.tenant_id FROM keystone.docustay_usage_event u WHERE u.occurred_at >= p_from AND u.occurred_at < p_to ORDER BY u.tenant_id LIMIT greatest(1, least(p_limit, 2000));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_docustay_usage_tenants(timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_usage_tenants(timestamptz, timestamptz, integer) TO app_worker;
SET LOCAL ROLE app_owner;
DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0764 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
