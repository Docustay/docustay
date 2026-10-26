-- 0792 — VISITOR CHOICE PER SERVICE, AND REPLAY-SAFE PUBLIC BOOKING (Ty, 22 Oct 2026; spec BOOKING-EVERYWHERE §4, §5.2).
--   booking_policy.visitor_can_choose   per-service override of the practice setting booking.show_staff_choice (NULL = practice)
--   keystone.public_booking_request     one row per (practice, idempotency key) for the browser door, the website's
--                                       server-to-server door and the client app. Replaces the in-process Map the s2s door
--                                       used (lost on restart, not shared between instances). Rows older than a day are swept.

ALTER TABLE keystone.booking_policy
  ADD COLUMN IF NOT EXISTS visitor_can_choose boolean;

CREATE TABLE IF NOT EXISTS keystone.public_booking_request (
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  idempotency_key  text        NOT NULL,
  door             text        NOT NULL,
  booking_id       uuid,
  response         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key),
  CONSTRAINT public_booking_request_key_shape CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  CONSTRAINT public_booking_request_door_check CHECK (door IN ('page', 's2s', 'app', 'manage'))
);
CREATE INDEX IF NOT EXISTS public_booking_request_created_idx ON keystone.public_booking_request (created_at);

DO $rls$
BEGIN
  ALTER TABLE keystone.public_booking_request ENABLE ROW LEVEL SECURITY;
  ALTER TABLE keystone.public_booking_request FORCE  ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'keystone' AND tablename = 'public_booking_request' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON keystone.public_booking_request USING (tenant_id = keystone.current_tenant_id());
    CREATE POLICY tenant_insert ON keystone.public_booking_request FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
    CREATE POLICY tenant_update ON keystone.public_booking_request FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
    CREATE POLICY tenant_delete ON keystone.public_booking_request FOR DELETE USING (tenant_id = keystone.current_tenant_id());
    CREATE POLICY reference_guard_read ON keystone.public_booking_request FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
  END IF;
END
$rls$;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.public_booking_request TO app_rw;
GRANT SELECT, DELETE ON keystone.public_booking_request TO app_worker;
GRANT SELECT ON keystone.public_booking_request TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'public_booking_request_refuse_reference_delete_trg') THEN
    CREATE TRIGGER public_booking_request_refuse_reference_delete_trg AFTER DELETE ON keystone.public_booking_request
      REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
    ALTER TABLE keystone.public_booking_request ENABLE ALWAYS TRIGGER public_booking_request_refuse_reference_delete_trg;
    CREATE TRIGGER public_booking_request_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.public_booking_request
      FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
    ALTER TABLE keystone.public_booking_request ENABLE ALWAYS TRIGGER public_booking_request_refuse_reference_truncate_trg;
  END IF;
END
$trg$;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
