-- 0562_test_data_cleanup_diagnostic_read_only
--
-- Section B (the maintainer's reorder, 1 Oct 2026 pasted brief): "delete every test record except exactly 4
-- (Example Owner client, QA admin, 'Test services', 'Test package' — create the package if
-- missing). Repoint QA login's client to Example Owner FIRST. Never touch Example Client."
--
-- ★ READ-ONLY — this migration changes NOTHING. A mass-delete of "everything that is a test
--   record" across ~20+ tables, based on my own classification of what counts as test vs real,
--   is exactly the irreversible-against-real-data case CLAUDE.md's overnight-run rule names as a
--   genuine stop condition if done blind. There is no safe non-superuser path to query production
--   directly from an investigating session tonight (no working admin UI session — F865 — and no
--   app_rw-reaching tunnel available from outside Railway's private network), so this surfaces,
--   via the deploy log (RAISE NOTICE), every tenant and every Docustay person/item/package that exists
--   today. The real delete migration is written from what this reveals and reviewed once more
--   before it ships — never guessed at blind, and Example Client's row is called out by name so it
--   cannot be mistaken for a test record by a predicate that happens to also match him.

DO $diag$
DECLARE
  v_tenant record;
  v_user record;
  v_service record;
  v_package record;
BEGIN
  RAISE NOTICE '0562 DIAGNOSTIC: listing every tenant —';
  FOR v_tenant IN SELECT id, slug, name, created_at FROM keystone.tenant ORDER BY created_at LOOP
    RAISE NOTICE '0562 TENANT: id=% slug=% name=% created_at=%',
      v_tenant.id, v_tenant.slug, v_tenant.name, v_tenant.created_at;
  END LOOP;

  RAISE NOTICE '0562 DIAGNOSTIC: listing every app_user in the FOUNDRY tenant —';
  FOR v_user IN
    SELECT u.id, u.display_name, u.email, u.role, u.staff_role, u.lifecycle_status,
           u.archived_at, u.stripe_customer_id, u.created_at
      FROM keystone.app_user u
      JOIN keystone.tenant t ON t.id = u.tenant_id
     WHERE t.slug = 'foundry' OR t.name ILIKE '%example practice%'
     ORDER BY u.created_at
  LOOP
    RAISE NOTICE '0562 APP_USER: id=% display_name=% email=% role=% staff_role=% lifecycle_status=% archived_at=% stripe_customer_id=% created_at=%',
      v_user.id, v_user.display_name, v_user.email, v_user.role, v_user.staff_role,
      v_user.lifecycle_status, v_user.archived_at, v_user.stripe_customer_id, v_user.created_at;
  END LOOP;

  RAISE NOTICE '0562 DIAGNOSTIC: listing every service in the FOUNDRY tenant —';
  FOR v_service IN
    SELECT s.id, s.name, s.active, s.price_minor, s.created_at
      FROM keystone.service s
      JOIN keystone.tenant t ON t.id = s.tenant_id
     WHERE t.slug = 'foundry' OR t.name ILIKE '%example practice%'
     ORDER BY s.created_at
  LOOP
    RAISE NOTICE '0562 SERVICE: id=% name=% active=% price_minor=% created_at=%',
      v_service.id, v_service.name, v_service.active, v_service.price_minor, v_service.created_at;
  END LOOP;

  RAISE NOTICE '0562 DIAGNOSTIC: listing every package in the FOUNDRY tenant —';
  FOR v_package IN
    SELECT p.id, p.name, p.active, p.price_minor, p.created_at
      FROM keystone.package p
      JOIN keystone.tenant t ON t.id = p.tenant_id
     WHERE t.slug = 'foundry' OR t.name ILIKE '%example practice%'
     ORDER BY p.created_at
  LOOP
    RAISE NOTICE '0562 PACKAGE: id=% name=% active=% price_minor=% created_at=%',
      v_package.id, v_package.name, v_package.active, v_package.price_minor, v_package.created_at;
  END LOOP;

  RAISE NOTICE '0562 DIAGNOSTIC: complete, no rows changed';
END
$diag$;
