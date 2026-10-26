-- 0682 · A workspace's own wording for its document emails (Final Push FP-K1/K2, 7 Oct 2026). Additive. One row per message type and language; a missing row means "the standard wording".
-- Kinds: invitation, reminder, completed, declined, voided, expired, code, receipt. The body is plain text with {{variables}} that the server substitutes (no template language is run).
CREATE TABLE keystone.document_email_message (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  kind         text        NOT NULL CHECK (kind IN ('invitation','reminder','completed','declined','voided','expired','code','receipt')),
  locale       text        NOT NULL DEFAULT 'en' CHECK (locale ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),
  subject      text        NULL CHECK (subject IS NULL OR char_length(subject) <= 200),
  preview      text        NULL CHECK (preview IS NULL OR char_length(preview) <= 200),
  body         text        NULL CHECK (body IS NULL OR char_length(body) <= 5000),
  button_label text        NULL CHECK (button_label IS NULL OR char_length(button_label) <= 60),
  footer       text        NULL CHECK (footer IS NULL OR char_length(footer) <= 500),
  updated_by   uuid        NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_email_message_once UNIQUE (tenant_id, kind, locale)
);
ALTER TABLE keystone.document_email_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_email_message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_email_message USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_email_message FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_email_message FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_email_message FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_email_message FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_email_message TO app_rw;
GRANT SELECT ON keystone.document_email_message TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_email_message_refuse_reference_delete_trg AFTER DELETE ON keystone.document_email_message
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_email_message ENABLE ALWAYS TRIGGER document_email_message_refuse_reference_delete_trg;
CREATE TRIGGER document_email_message_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_email_message
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_email_message ENABLE ALWAYS TRIGGER document_email_message_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ── The email log (FP-K4) and the sending guard (FP-K6), same migration: they read each other. ──
-- One row per email Docustay sent about a document, to a person named on that document. No body and no link: the subject, who it went to, what happened to it.
CREATE TABLE keystone.document_email_log (
  id                  uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id           uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id         uuid        NULL,
  party_id            uuid        NULL,
  seat                text        NULL CHECK (seat IS NULL OR char_length(seat) <= 80),
  kind                text        NOT NULL CHECK (kind IN ('invitation','reminder','completed','declined','voided','expired','code','receipt','other')),
  to_email            text        NOT NULL CHECK (char_length(to_email) <= 254),
  subject             text        NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  status              text        NOT NULL CHECK (status IN ('sent','delivered','bounced','complained','failed','skipped','paused','limit_reached')),
  provider_message_id text        NULL CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  error               text        NULL CHECK (error IS NULL OR char_length(error) <= 300),
  is_test             boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_email_log_recent_idx   ON keystone.document_email_log (tenant_id, created_at DESC, id DESC);
CREATE INDEX document_email_log_provider_idx ON keystone.document_email_log (tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX document_email_log_document_idx ON keystone.document_email_log (tenant_id, instance_id) WHERE instance_id IS NOT NULL;

ALTER TABLE keystone.document_email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_email_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_email_log USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_email_log FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_email_log FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_email_log FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_email_log FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_email_log TO app_rw;
GRANT SELECT ON keystone.document_email_log TO reference_guard;

-- A workspace whose emails bounce or are reported as spam is PAUSED before it can put the whole sending account at risk. One row per workspace; the owner resumes it from Settings once the list is clean.
CREATE TABLE keystone.document_email_guard (
  tenant_id     uuid        PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  paused_at     timestamptz NULL,
  paused_reason text        NULL CHECK (paused_reason IS NULL OR char_length(paused_reason) <= 300),
  resumed_at    timestamptz NULL,
  resumed_by    uuid        NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.document_email_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_email_guard FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_email_guard USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_email_guard FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_email_guard FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_email_guard FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.document_email_guard TO app_rw;
GRANT SELECT ON keystone.document_email_guard TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_email_log_refuse_reference_delete_trg AFTER DELETE ON keystone.document_email_log
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_email_log ENABLE ALWAYS TRIGGER document_email_log_refuse_reference_delete_trg;
CREATE TRIGGER document_email_log_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_email_log
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_email_log ENABLE ALWAYS TRIGGER document_email_log_refuse_reference_truncate_trg;
CREATE TRIGGER document_email_guard_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_email_guard
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_email_guard ENABLE ALWAYS TRIGGER document_email_guard_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
