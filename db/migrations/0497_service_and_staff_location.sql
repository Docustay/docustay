-- 0497_service_and_staff_location
--
-- Stage 20 §5 — LOCATION vs Square (Ty, 25 Sep 2026): "service-to-location and staff-to-location
-- are the real gaps — without them a second location is cosmetic." 0381 built the places; nothing
-- says WHAT is offered WHERE or WHO works WHERE. These two join tables say it.
--
-- SEMANTICS (the back-compat rule, same shape as 0496's scope axes): NO rows for a service/staff
-- member = offered/working at EVERY location — so a single-location practice never has to touch
-- this, and every existing service and coach keeps behaving exactly as today the moment the tables
-- exist. Rows present = restricted to the listed locations. Enforcement is server-side in the
-- availability and public-booking reads, not a trigger — a booking's location is a policy fact,
-- not a row-integrity fact.
--
-- DELIBERATELY DEFERRED (planned, not built — Ty's §5 ruling "build them last or defer with a
-- reason"):
--   · RESOURCES (rooms, chairs, equipment) — nothing in the product books a resource yet; a
--     resource model with no booker is BUILT-AND-WIRED-TO-NOTHING, failure №1.
--   · PER-LOCATION PRICING — the schema already exists (0413: price.location_id + delivery_mode,
--     "most-specific active row wins"); what is missing is a writer UI, which belongs with the
--     price-variations screen, not here.
--   · location.opening_hours writer — D7's column still has no writer; the hours editor is a
--     screen task and goes with the location management screen (F12), not a migration.
--
-- CT-F52 — the new-tenant-table checklist for both tables (idiom from 0381/0496).

CREATE TABLE keystone.service_location (
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  service_id  uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, service_id, location_id),
  CONSTRAINT service_location_service_fkey FOREIGN KEY (tenant_id, service_id)
    REFERENCES keystone.service (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT service_location_location_fkey FOREIGN KEY (tenant_id, location_id)
    REFERENCES keystone.location (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE keystone.service_location IS
  '0497 (§5). Which locations offer this service. NO rows = every location (single-location
   practices never touch this). Enforced in availability/public-booking reads, server-side.';

CREATE TABLE keystone.staff_location (
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, app_user_id, location_id),
  CONSTRAINT staff_location_user_fkey FOREIGN KEY (tenant_id, app_user_id)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT staff_location_location_fkey FOREIGN KEY (tenant_id, location_id)
    REFERENCES keystone.location (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE keystone.staff_location IS
  '0497 (§5). Which locations this staff member works at. NO rows = every location. A shift
   (0382) at a location the member is restricted away from is refused server-side at write time.';

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_location','staff_location'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_update ON keystone.%I FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_delete ON keystone.%I FOR DELETE USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY reference_guard_read ON keystone.%I FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON keystone.%I TO reference_guard', t);
  END LOOP;
END
$rls$;

-- ★★★ THE EXECUTE LEND (0381's idiom): CREATE TRIGGER requires EXECUTE on the trigger function.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

DO $trg$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_location','staff_location'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON keystone.%I REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()', t || '_refuse_reference_delete_trg', t);
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', t, t || '_refuse_reference_delete_trg');
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON keystone.%I FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()', t || '_refuse_reference_truncate_trg', t);
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', t, t || '_refuse_reference_truncate_trg');
  END LOOP;
END
$trg$;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- self-check — by content
DO $check$
DECLARE t text; n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_location','staff_location'] LOOP
    SELECT count(*) INTO n FROM pg_policy WHERE polrelid = ('keystone.' || t)::regclass;
    IF n < 5 THEN RAISE EXCEPTION '0497: keystone.% has % policies, expected >= 5', t, n; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('keystone.' || t)::regclass AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '0497: keystone.% is not ENABLE + FORCE RLS', t;
    END IF;
    SELECT count(*) INTO n FROM pg_trigger
     WHERE tgrelid = ('keystone.' || t)::regclass AND NOT tgisinternal AND tgenabled = 'A';
    IF n <> 2 THEN RAISE EXCEPTION '0497: keystone.% has % ENABLE ALWAYS triggers, expected 2', t, n; END IF;
  END LOOP;
END
$check$;
