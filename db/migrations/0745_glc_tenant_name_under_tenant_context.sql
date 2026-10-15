-- 0744 renamed nothing: keystone.tenant is under FORCED row-level security (tenant_isolation) and the migration role carries no tenant context, so its UPDATE matched 0 rows
-- (MEASURED in the sandbox, 14 Oct 2026). Same rename, now inside the practice's own tenant context. Reading the id is allowed by the tenant_health_read policy.
-- Idempotent; only the practice with slug 'glc' and only while it still carries the old name.
DO $$
DECLARE tid uuid;
BEGIN
  SELECT id INTO tid FROM keystone.tenant WHERE slug = 'glc' AND name = 'Example Practice Recovery Services';
  IF tid IS NOT NULL THEN
    PERFORM set_config('keystone.tenant_id', tid::text, true);
    UPDATE keystone.tenant SET name = 'Example Practice Coaching' WHERE id = tid;
  END IF;
END $$;
