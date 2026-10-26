-- 0674 · Forms and People (Final push Stage 2, 7 Oct 2026). Additive.
--   · a template can be a FORM (collects from many people through a public link): collects_many + form_settings (expiry, response limit, email check, copy-to, intro);
--     the link itself (on/off and its name) is the existing self_serve_enabled / self_serve_slug
--   · a document records how it started: source_channel = 'form' for a response
--   · document_contact: the People page. Saved automatically from signers and form respondents; deleting a contact never deletes a signed document.
ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS collects_many boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS form_settings jsonb   NULL;
ALTER TABLE keystone.document_instance
  ADD COLUMN IF NOT EXISTS source_channel text NULL CHECK (source_channel IS NULL OR source_channel IN ('form'));
CREATE INDEX IF NOT EXISTS document_instance_form_idx ON keystone.document_instance (tenant_id, template_id, created_at DESC) WHERE source_channel = 'form';

CREATE TABLE keystone.document_contact (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  first_name       text        NOT NULL DEFAULT '' CHECK (char_length(first_name) <= 120),
  last_name        text        NOT NULL DEFAULT '' CHECK (char_length(last_name) <= 120),
  email            text        NOT NULL CHECK (char_length(email) <= 254 AND email = lower(email)),
  language         text        NULL CHECK (language IS NULL OR char_length(language) <= 8),
  source           text        NOT NULL DEFAULT 'signer' CHECK (source IN ('signer','form','manual')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_contact_email_once UNIQUE (tenant_id, email)
);
CREATE INDEX document_contact_recent_idx ON keystone.document_contact (tenant_id, last_activity_at DESC);

ALTER TABLE keystone.document_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_contact FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_contact USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_contact FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_contact FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_contact FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_contact FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_contact TO app_rw;
GRANT SELECT ON keystone.document_contact TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_contact_refuse_reference_delete_trg AFTER DELETE ON keystone.document_contact
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_contact ENABLE ALWAYS TRIGGER document_contact_refuse_reference_delete_trg;
CREATE TRIGGER document_contact_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_contact
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_contact ENABLE ALWAYS TRIGGER document_contact_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
