-- 0685 · The webhook relay (Final Push FP-D4, 7 Oct 2026). Additive. An endpoint whose address is `relay://…` is never called over the network: its signed deliveries are stored here, and the `docustay listen` command
-- (running on a developer's laptop, which no server can reach) polls for them and forwards each to localhost with the SAME signature headers. Kept 24 hours.
CREATE TABLE keystone.webhook_relay_event (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  endpoint_id uuid        NOT NULL,
  event_id    uuid        NOT NULL,
  topic       text        NULL CHECK (topic IS NULL OR char_length(topic) <= 120),
  headers     jsonb       NOT NULL CHECK (jsonb_typeof(headers) = 'object'),
  body        text        NOT NULL CHECK (char_length(body) <= 1000000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_relay_event_poll_idx ON keystone.webhook_relay_event (tenant_id, endpoint_id, id);
ALTER TABLE keystone.webhook_relay_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.webhook_relay_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.webhook_relay_event USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.webhook_relay_event FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.webhook_relay_event FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.webhook_relay_event FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, DELETE ON keystone.webhook_relay_event TO app_rw;
GRANT SELECT ON keystone.webhook_relay_event TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER webhook_relay_event_refuse_reference_delete_trg AFTER DELETE ON keystone.webhook_relay_event
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.webhook_relay_event ENABLE ALWAYS TRIGGER webhook_relay_event_refuse_reference_delete_trg;
CREATE TRIGGER webhook_relay_event_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.webhook_relay_event
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.webhook_relay_event ENABLE ALWAYS TRIGGER webhook_relay_event_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
