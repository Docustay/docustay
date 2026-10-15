-- 0653 looked the practice up by slug 'example'; the public brand is now "an example organisation" (slug 'glc'), so it found nothing and switched nothing on (its NOTICE said so). This does what 0653 meant to,
-- addressing the practice the way 0545 does: by its fixed tenant id, skipping quietly where that practice is not in the database (staging, tests). See 0653 for the proofs and the ROLLBACK.
DO $$
DECLARE
  foundry_tenant_id uuid := '01a09bfe-481c-7cbe-9f80-d28b613e5bba';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone.tenant_timezones_for_health() WHERE id = foundry_tenant_id) THEN
    RAISE NOTICE '0654: the FOUNDRY tenant % is not in this database — nothing to switch on', foundry_tenant_id;
    RETURN;
  END IF;
  PERFORM set_config('keystone.tenant_id', foundry_tenant_id::text, true);
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (foundry_tenant_id, 'authoring.shared_engine', 'true'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'true'::jsonb;
  RAISE NOTICE '0654: authoring.shared_engine is ON for the FOUNDRY practice';
END $$;
