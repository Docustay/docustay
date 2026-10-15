-- 0400_availability_cache — Stage 13 task 13.5 · G10 (the maintainer, 25 Sep: Option A) · CT-F28
CREATE TABLE keystone.availability_cache (
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id     uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  service_id  uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE CASCADE,
  day         date        NOT NULL,
  slots       jsonb       NOT NULL CHECK (jsonb_typeof(slots) = 'array'),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, host_id, service_id, day)
);
ALTER TABLE keystone.availability_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.availability_cache FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.availability_cache
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.availability_cache
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.availability_cache
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.availability_cache
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.availability_cache TO app_rw;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC, so a migration running
--     as app_owner CANNOT create a trigger on it without borrowing EXECUTE first. This is 0151's
--     §b/§e dance verbatim (0151:91-110, 234-236) — including giving it back, which 0151 asserts.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER availability_cache_refuse_reference_delete_trg AFTER DELETE ON keystone.availability_cache
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.availability_cache ENABLE ALWAYS TRIGGER availability_cache_refuse_reference_delete_trg;
CREATE TRIGGER availability_cache_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.availability_cache
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.availability_cache ENABLE ALWAYS TRIGGER availability_cache_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- the privilege the policy needs underneath it, then the visibility, TO reference_guard ONLY
GRANT SELECT ON keystone.availability_cache TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.availability_cache FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

CREATE FUNCTION keystone.availability_cache_invalidate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, keystone AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  k text  := TG_ARGV[0];
  t uuid  := coalesce(n->>'tenant_id', o->>'tenant_id')::uuid;
BEGIN
  IF k = 'tenant_setting' THEN
    IF coalesce(o->>'key', '') LIKE 'booking.%' OR coalesce(n->>'key', '') LIKE 'booking.%' THEN
      DELETE FROM keystone.availability_cache WHERE tenant_id = t;
    END IF;
  ELSIF k = 'service_row' THEN
    DELETE FROM keystone.availability_cache WHERE tenant_id = t
       AND service_id IN ((o->>'id')::uuid, (n->>'id')::uuid);
  ELSIF k = 'service_id' THEN
    DELETE FROM keystone.availability_cache WHERE tenant_id = t
       AND service_id IN ((o->>'service_id')::uuid, (n->>'service_id')::uuid);
  ELSE  -- a person column: 'host_id' or 'app_user_id'
    DELETE FROM keystone.availability_cache WHERE tenant_id = t
       AND host_id IN ((o->>k)::uuid, (n->>k)::uuid);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER availability_cache_booking AFTER INSERT OR UPDATE OR DELETE ON keystone.booking
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('host_id');
CREATE TRIGGER availability_cache_rule AFTER INSERT OR UPDATE OR DELETE ON keystone.availability_rule
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('host_id');
CREATE TRIGGER availability_cache_override AFTER INSERT OR UPDATE OR DELETE ON keystone.date_override
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('host_id');
CREATE TRIGGER availability_cache_policy AFTER INSERT OR UPDATE OR DELETE ON keystone.booking_policy
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('service_id');
CREATE TRIGGER availability_cache_setting AFTER INSERT OR UPDATE OR DELETE ON keystone.tenant_setting
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('tenant_setting');
CREATE TRIGGER availability_cache_service AFTER UPDATE OF duration_minutes, bookable, active,
  public_bookable, portal_bookable ON keystone.service
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('service_row');

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH A POSITIVE CONTROL INSIDE THE SQL ═════════════
-- ★★★ A self-check made only of negative assertions passes on a database where nothing exists at
--     all. The last assertion is the control: it asserts something that must be TRUE, so a check
--     that answered "no" to everything cannot pass. (Stage 11's 0370 is the template.)
DO $$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class
           WHERE oid = 'keystone.availability_cache'::regclass) THEN
    RAISE EXCEPTION '0400 — keystone.availability_cache is not FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'availability_cache'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','tenant_delete','reference_guard_read');
  IF n <> 5 THEN
    RAISE EXCEPTION '0400 — expected 5 policies on availability_cache, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.availability_cache'::regclass
     AND tgname IN ('availability_cache_refuse_reference_delete_trg', 'availability_cache_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0400 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS, found %', n;
  END IF;
  -- ═══ CT-F52 POINT 4b, THIRD BULLET — 0144 §e's END-STATE ASSERTION, RESTATED HERE ══════════
  -- ★★★ 0144 §e asserts that on every guarded table `reference_guard_read` exists TO
  --     reference_guard ONLY, FOR SELECT, PERMISSIVE. **That sweep is a ONE-TIME pass over the
  --     catalogue as it stood at 0144's apply time and WILL NEVER RUN AGAIN**
  --     (`0144…:134-155`, MEASURED), so a table created in this stage gets no sweep and must
  --     assert it for itself. The form below is copied verbatim from 0144 §e's `have` CTE
  --     (`db/migrations/0144_the_reference_guard_sees_through_a_role_of_its_own.sql:272-276`; the
  --     role/cmd/permissive test is line **275**, MEASURED) — the
  --     `pg_policy` CATALOGUE, not the `pg_policies` view, because only the catalogue exposes
  --     `polpermissive`. A policy written TO PUBLIC, or FOR ALL, or RESTRICTIVE would pass the
  --     name-count check above and fail here, which is the whole point.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.availability_cache'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0400 — reference_guard_read on availability_cache must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;
  -- ★ THE POSITIVE CONTROL, in the same block: these must be TRUE.
  IF NOT has_table_privilege('app_rw', 'keystone.availability_cache', 'DELETE') THEN
    RAISE EXCEPTION '0400 — app_rw lost DELETE on availability_cache; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.availability_cache', 'SELECT') THEN
    RAISE EXCEPTION '0400 — reference_guard has no SELECT on availability_cache; its policy would have nothing underneath it';
  END IF;
END $$;
