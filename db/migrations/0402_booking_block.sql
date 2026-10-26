-- 0402_booking_block — Stage 13 task 13.7 · CT-F30
CREATE TABLE keystone.booking_block (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id       uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  label         text        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  repeat        text        NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekdays', 'weekly')),
  repeat_until  date        NULL,
  skipped_dates date[]      NOT NULL DEFAULT '{}',
  created_by    uuid        NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_block_forward CHECK (ends_at > starts_at),
  CONSTRAINT booking_block_same_day CHECK (ends_at - starts_at <= interval '24 hours'),
  CONSTRAINT booking_block_until_needs_repeat CHECK (repeat_until IS NULL OR repeat <> 'none')
);
CREATE INDEX booking_block_host ON keystone.booking_block (tenant_id, host_id, starts_at);
ALTER TABLE keystone.booking_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_block FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.booking_block USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.booking_block FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.booking_block FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.booking_block TO app_rw;
CREATE TRIGGER availability_cache_block AFTER INSERT OR UPDATE OR DELETE ON keystone.booking_block
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('host_id');

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER booking_block_refuse_reference_delete_trg AFTER DELETE ON keystone.booking_block
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.booking_block ENABLE ALWAYS TRIGGER booking_block_refuse_reference_delete_trg;
CREATE TRIGGER booking_block_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.booking_block
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.booking_block ENABLE ALWAYS TRIGGER booking_block_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.booking_block TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.booking_block FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH A POSITIVE CONTROL INSIDE THE SQL ═════════════
DO $$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.booking_block'::regclass) THEN
    RAISE EXCEPTION '0402 — keystone.booking_block is not FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking_block'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0402 — expected 4 policies on booking_block, found %', n;
  END IF;
  -- ★ and NO tenant_delete, because there is no DELETE grant and no delete path (see below).
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='booking_block' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0402 — booking_block has a tenant_delete policy but no delete path; remove one or the other';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.booking_block'::regclass
     AND tgname IN ('booking_block_refuse_reference_delete_trg','booking_block_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0402 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS, found %', n;
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
     WHERE polrelid = 'keystone.booking_block'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0402 — reference_guard_read on booking_block must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;
  -- ★ THE POSITIVE CONTROL, in the same block: these must be TRUE.
  IF NOT has_table_privilege('app_rw', 'keystone.booking_block', 'UPDATE') THEN
    RAISE EXCEPTION '0402 — app_rw lost UPDATE on booking_block; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.booking_block', 'SELECT') THEN
    RAISE EXCEPTION '0402 — reference_guard has no SELECT on booking_block; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.booking_block', 'DELETE') THEN
    RAISE EXCEPTION '0402 — app_rw must NOT hold DELETE on booking_block (a block is stopped or skipped, never deleted)';
  END IF;
END $$;
