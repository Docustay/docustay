-- 0604 · A RECIPIENT WITH NO ACCOUNT CAN SIGN, AND WHAT THEY FILLED IN IS KEPT (QUEUE §23.4.10, §23.4.4).
--
--  1. The person's `document_party` row is their identity on an uploaded document, so a sign link opens a transaction whose viewer (`current_user_id()`) is that party's id. Row-level security learns
--     that viewer: it may READ the document it was sent (once it is sent) and may move it forward (sent → partially_signed → executed, the last only when every signer on the send has signed). It can
--     reach nothing else: no other document, no draft, no other practice. the platform people are untouched — their policies are unchanged and this adds a separate permissive policy.
--  2. `document_field_value` — every value a person typed or picked, and every mark they drew into a field, kept per field and per document with its own SHA-256, append-only (like `signature_record`).
--     The signed copy is built from these rows; the certificate cites their hashes.
-- ★ Additive. FORCED row-level security on the new table.

CREATE POLICY party_read ON keystone.document_instance FOR SELECT USING (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND state <> 'draft' AND archived_at IS NULL
  AND EXISTS (SELECT 1 FROM keystone.document_party p
               WHERE p.id = keystone.current_user_id() AND p.tenant_id = document_instance.tenant_id AND p.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id)));

CREATE POLICY party_marks_progress ON keystone.document_instance FOR UPDATE USING (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND state IN ('sent','partially_signed') AND archived_at IS NULL
  AND EXISTS (SELECT 1 FROM keystone.document_party p
               WHERE p.id = keystone.current_user_id() AND p.tenant_id = document_instance.tenant_id AND p.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id)))
WITH CHECK (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND (
       state IN ('partially_signed','declined')
    OR (state = 'executed' AND NOT EXISTS (SELECT 1 FROM keystone.document_party q
                                            WHERE q.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id) AND q.action_role = 'signer' AND q.status <> 'signed'))));

CREATE TABLE keystone.document_field_value (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,   -- the document the field is on (a member of a package, or the document itself)
  party_id    uuid        NOT NULL REFERENCES keystone.document_party(id) ON DELETE CASCADE,
  field_id    text        NOT NULL CHECK (length(field_id) BETWEEN 1 AND 64),
  field_type  text        NOT NULL,
  value       text        NULL CHECK (value IS NULL OR length(value) <= 5000),                    -- typed text, a choice, "true"/"false", or a date
  mark_image  text        NULL CHECK (mark_image IS NULL OR (mark_image LIKE 'data:image/png;base64,%' AND length(mark_image) <= 204800)),
  value_sha256 text       NOT NULL CHECK (value_sha256 ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, field_id)
);
CREATE INDEX document_field_value_by_party ON keystone.document_field_value (tenant_id, party_id);
ALTER TABLE keystone.document_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_field_value FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_field_value USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_field_value FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT ON keystone.document_field_value TO app_rw;
GRANT SELECT ON keystone.document_field_value TO app_worker;

CREATE FUNCTION keystone.document_field_value_is_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND nullif(btrim(coalesce(current_setting('keystone.record_delete_reason', true), '')), '') IS NOT NULL THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'what a person filled in on a signed document is part of the record and cannot be changed (U25)' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER document_field_value_no_update BEFORE UPDATE ON keystone.document_field_value FOR EACH ROW EXECUTE FUNCTION keystone.document_field_value_is_immutable();
CREATE TRIGGER document_field_value_no_delete BEFORE DELETE ON keystone.document_field_value FOR EACH ROW EXECUTE FUNCTION keystone.document_field_value_is_immutable();
