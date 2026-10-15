-- 0621 · Batch A (the maintainer, 3 Oct 2026): what used to be typed into the backend for one practice becomes that practice's own SETTINGS, so an example organisation is a normal tenant.
--   growth.lead_form_origins       the websites allowed to post the public lead form (was a list in src/http/publicCorsAllowlist.mjs)
--   growth.lead_notification_email where "new lead" mail goes (was an address in src/routes/publicLeads.mjs)
-- Seeded for the practice whose slug is 'example' so behaviour does not change; nothing in the code names it. Idempotent; never overwrites a value someone set.
DO $$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM keystone.tenant WHERE slug = 'foundry';
  IF v_tenant_id IS NULL THEN RETURN; END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'growth.lead_form_origins', '["https://host.example.com","https://example.com","https://www.example.com"]'::jsonb)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'growth.lead_notification_email', '"maintainer@example.com"'::jsonb)
  ON CONFLICT (tenant_id, key) DO NOTHING;
END $$;
