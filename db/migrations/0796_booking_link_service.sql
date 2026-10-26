-- 0796_booking_link_service — A CUSTOM BOOKING PAGE NAMES ITS SERVICES (Booking everywhere, 22 Oct 2026; plan frame 17, spec §5.4).
--
-- Frame 17 builds a page from "which services" and "which people" (or "anyone available"). 0496 scoped a link by service
-- CATEGORY, staff and location; a category is too coarse for "Intro week: First Light Call only". This adds the service axis in
-- 0496's own shape. Same rule as 0496: no rows of a kind = unscoped on that axis (a page with no service rows offers every public
-- service; with no staff rows, anyone available).

CREATE TABLE IF NOT EXISTS keystone.booking_link_service (
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  link_id     uuid NOT NULL,
  service_id  uuid NOT NULL,
  PRIMARY KEY (tenant_id, link_id, service_id),
  CONSTRAINT booking_link_service_link_fkey FOREIGN KEY (tenant_id, link_id)
    REFERENCES keystone.booking_link (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_link_service_service_fkey FOREIGN KEY (tenant_id, service_id)
    REFERENCES keystone.service (tenant_id, id) ON DELETE CASCADE
);

-- ═══ CT-F52: RLS (ENABLE + FORCE), tenant policies, reference-guard read, refuse-reference triggers, grants ═══
DO $rls$
BEGIN
  ALTER TABLE keystone.booking_link_service ENABLE ROW LEVEL SECURITY;
  ALTER TABLE keystone.booking_link_service FORCE  ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'keystone' AND tablename = 'booking_link_service' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON keystone.booking_link_service USING (tenant_id = keystone.current_tenant_id());
    CREATE POLICY tenant_insert ON keystone.booking_link_service FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
    CREATE POLICY tenant_update ON keystone.booking_link_service FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
    CREATE POLICY tenant_delete ON keystone.booking_link_service FOR DELETE USING (tenant_id = keystone.current_tenant_id());
    CREATE POLICY reference_guard_read ON keystone.booking_link_service FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
  END IF;
END
$rls$;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.booking_link_service TO app_rw;
GRANT SELECT ON keystone.booking_link_service TO app_worker;
GRANT SELECT ON keystone.booking_link_service TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'booking_link_service_refuse_reference_delete_trg') THEN
    CREATE TRIGGER booking_link_service_refuse_reference_delete_trg AFTER DELETE ON keystone.booking_link_service
      REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
    ALTER TABLE keystone.booking_link_service ENABLE ALWAYS TRIGGER booking_link_service_refuse_reference_delete_trg;
    CREATE TRIGGER booking_link_service_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.booking_link_service
      FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
    ALTER TABLE keystone.booking_link_service ENABLE ALWAYS TRIGGER booking_link_service_refuse_reference_truncate_trg;
  END IF;
END
$trg$;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

DO $check$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.booking_link_service'::regclass) THEN
    RAISE EXCEPTION '0796: booking_link_service must FORCE row level security';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.booking_link_service', 'INSERT') THEN
    RAISE EXCEPTION '0796: app_rw cannot write booking_link_service';
  END IF;
  RAISE NOTICE '0796: booking_link_service ready';
END
$check$;
