-- 0770 — test sends show in a webhook's delivery list (R13-D197, 23 Oct 2026).
-- POST /api/v1/webhooks/{id}/test made no keystone.event, so it could never appear in keystone.webhook_delivery (event_id is a
-- RESTRICT reference to a real event). A developer who sends a test and then opens the deliveries list saw nothing, although the
-- receiver answered. Like Stripe's test events, a test send is now kept here (one row per send, no payload) and listed with test: true.
-- Test sends still never count toward disabling a webhook and never retry.

CREATE TABLE IF NOT EXISTS keystone.webhook_test_send (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  endpoint_id     uuid        NOT NULL REFERENCES keystone.webhook_endpoint(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL,
  topic           text        NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  status          text        NOT NULL CHECK (status IN ('delivered','failed','timed_out','skipped')),
  response_status integer     CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  error           text        CHECK (error IS NULL OR length(error) <= 1000),
  attempted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_test_send_endpoint_idx ON keystone.webhook_test_send (endpoint_id, attempted_at DESC);

ALTER TABLE keystone.webhook_test_send ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.webhook_test_send FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.webhook_test_send;
DROP POLICY IF EXISTS tenant_insert ON keystone.webhook_test_send;
DROP POLICY IF EXISTS reference_guard_read ON keystone.webhook_test_send;
DROP POLICY IF EXISTS workspace_deletion ON keystone.webhook_test_send;
CREATE POLICY tenant_isolation ON keystone.webhook_test_send USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.webhook_test_send FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.webhook_test_send FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
CREATE POLICY workspace_deletion ON keystone.webhook_test_send FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT ON keystone.webhook_test_send TO app_rw, app_worker;
GRANT SELECT ON keystone.webhook_test_send TO reference_guard;

-- the reference workspace's rows cannot be deleted or truncated (0133's guard), like every other tenant table
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DROP TRIGGER IF EXISTS webhook_test_send_refuse_reference_delete_trg ON keystone.webhook_test_send;
CREATE TRIGGER webhook_test_send_refuse_reference_delete_trg AFTER DELETE ON keystone.webhook_test_send REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.webhook_test_send ENABLE ALWAYS TRIGGER webhook_test_send_refuse_reference_delete_trg;
DROP TRIGGER IF EXISTS webhook_test_send_refuse_reference_truncate_trg ON keystone.webhook_test_send;
CREATE TRIGGER webhook_test_send_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.webhook_test_send FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
