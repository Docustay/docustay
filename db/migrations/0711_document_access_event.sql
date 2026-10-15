-- 0711 · Run 7 part 6: THE ACCESS LOG. One row each time someone on the team opens a document, downloads its file or exports a list of documents or responses, in a workspace that handles
-- health information (health.enabled). Kept six years (the retention sweep never removes these), exportable by owners. The document and the person are SNAPSHOTS (title, name, email) plus opaque
-- ids with no foreign key, so a row stands after its document or person is gone — the same rule as document_party (0598). Forced row security like every tenant table. Insert and read only:
-- nothing in the application updates or deletes a row.
CREATE TABLE IF NOT EXISTS keystone.document_access_event (
  id            uuid          PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid          NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  at            timestamptz   NOT NULL DEFAULT now(),
  action        text          NOT NULL CHECK (action IN ('view','download','export')),
  instance_id   uuid          NULL,
  title         text          NULL CHECK (title IS NULL OR char_length(title) <= 300),
  what          text          NULL CHECK (what IS NULL OR char_length(what) <= 120),
  user_ref      uuid          NULL,
  user_name     text          NULL CHECK (user_name IS NULL OR char_length(user_name) <= 200),
  user_email    text          NULL CHECK (user_email IS NULL OR char_length(user_email) <= 320),
  ip            inet          NULL
);
CREATE INDEX IF NOT EXISTS document_access_event_tenant_at_idx ON keystone.document_access_event (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS document_access_event_instance_idx ON keystone.document_access_event (tenant_id, instance_id);

ALTER TABLE keystone.document_access_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_access_event FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.document_access_event;
DROP POLICY IF EXISTS tenant_insert ON keystone.document_access_event;
DROP POLICY IF EXISTS reference_guard_read ON keystone.document_access_event;
CREATE POLICY tenant_isolation ON keystone.document_access_event USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_access_event FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_access_event FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT ON keystone.document_access_event TO app_rw, app_worker;
GRANT SELECT ON keystone.document_access_event TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DROP TRIGGER IF EXISTS document_access_event_refuse_reference_delete_trg ON keystone.document_access_event;
CREATE TRIGGER document_access_event_refuse_reference_delete_trg AFTER DELETE ON keystone.document_access_event
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_access_event ENABLE ALWAYS TRIGGER document_access_event_refuse_reference_delete_trg;
DROP TRIGGER IF EXISTS document_access_event_refuse_reference_truncate_trg ON keystone.document_access_event;
CREATE TRIGGER document_access_event_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_access_event
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
