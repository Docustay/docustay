-- 0691 · REMEMBER THIS FORM (specs/final-push/PDF-FIELD-DETECTION-SPEC.md §5). When a workspace sends a document made from an uploaded PDF, the page layout (a small picture hash of each page) and the fields the person
-- finally placed are kept, so the SAME form uploaded again comes up with the corrected boxes already in place. Per workspace; a self-host keeps it in its own database. Additive.
CREATE TABLE keystone.document_form_layout (
  id          uuid         PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid         NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name        text         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  page_count  integer      NOT NULL CHECK (page_count BETWEEN 1 AND 2000),
  pages       jsonb        NOT NULL,                                     -- [{ "hash": "16 hex" }] one per page
  roles       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  fields      jsonb        NOT NULL,
  uses        integer      NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_by  uuid         NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT document_form_layout_pages_shape CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) = page_count),
  CONSTRAINT document_form_layout_fields_shape CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) <= 2000),
  CONSTRAINT document_form_layout_user_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX document_form_layout_tenant_id_key ON keystone.document_form_layout (tenant_id, id);
CREATE INDEX document_form_layout_tenant_pages_idx ON keystone.document_form_layout (tenant_id, page_count, updated_at DESC);

ALTER TABLE keystone.document_form_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_form_layout FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_form_layout USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_form_layout FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_form_layout FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_form_layout TO app_rw, app_worker;
GRANT SELECT ON keystone.document_form_layout TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_form_layout_refuse_reference_delete_trg AFTER DELETE ON keystone.document_form_layout
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_form_layout ENABLE ALWAYS TRIGGER document_form_layout_refuse_reference_delete_trg;
CREATE TRIGGER document_form_layout_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_form_layout
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_form_layout ENABLE ALWAYS TRIGGER document_form_layout_refuse_reference_truncate_trg;
