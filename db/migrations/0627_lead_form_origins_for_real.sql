-- 0627 · FOUND 4 Oct 2026: 0621 and 0626 changed nothing, anywhere. Both looked the practice up with a plain SELECT on keystone.tenant, which returns no row under FORCED row-level security without a tenant
-- set (the same trap 0550 documents), so they quietly returned. Production had NO growth.lead_form_origins and NO growth.lead_notification_email row. This does it with the identity-lookup function
-- (keystone.resolve_tenant_by_slug) the way 0550 does. (0621 and 0626 are applied, so they are not edited.)
-- Effect: the practice's lead-form origins become the three it was always meant to have (the Railway address of the site and both spellings of the old domain) PLUS https://example.com and
-- https://www.example.com — the old ones are kept. Existing values are merged, never replaced. Idempotent. Does nothing where no practice has the slug 'example'.
-- The notification address is NOT changed here: it changes in a later migration, after delivery to the new address has been proven.
DO $$
DECLARE v_tenant_id uuid; v_cur jsonb; v_new jsonb;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('foundry') INTO v_tenant_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
  SELECT value INTO v_cur FROM keystone.tenant_setting WHERE tenant_id = v_tenant_id AND key = 'growth.lead_form_origins';
  v_cur := COALESCE(v_cur, '[]'::jsonb);
  SELECT COALESCE(jsonb_agg(DISTINCT o ORDER BY o), '[]'::jsonb) INTO v_new FROM (
    SELECT jsonb_array_elements_text(v_cur) AS o
    UNION SELECT 'https://host.example.com' UNION SELECT 'https://example.com' UNION SELECT 'https://www.example.com'
    UNION SELECT 'https://example.com' UNION SELECT 'https://www.example.com') s;
  INSERT INTO keystone.tenant_setting (tenant_id, key, value) VALUES (v_tenant_id, 'growth.lead_form_origins', v_new)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value;
END $$;
