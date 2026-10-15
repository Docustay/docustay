-- 0595 · THE DOCUMENTS ISLAND OWNS ITS SETTINGS (QUEUE §23 Part 2, 23.2.2; the maintainer 3 Oct 2026: "move the existing documents settings into the island").
-- `keystone.document_setting` is the island's own key/value table (typed schema + defaults live in src/documents/settings.mjs). The five `documents.*` values that the platform held in
-- its general `tenant_setting` are COPIED across (the key loses its `documents.` prefix). The old rows are left in place, inert, so a rollback loses nothing; Part 8 removes them.
-- ★ `updated_by` is an OPAQUE id, not a foreign key: the island does not reference the host's person table (Part 3 decouples the rest).
-- ★ Row-level security is FORCED, so the copy runs one practice at a time under that practice's own tenant context (the 0543 / 0592 pattern).
CREATE TABLE keystone.document_setting (
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key        text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
  value      jsonb       NOT NULL,
  updated_by uuid        NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE keystone.document_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_setting FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_setting USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_setting FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_setting FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.document_setting TO app_rw;
GRANT SELECT ON keystone.document_setting TO app_worker;

DO $copy$
DECLARE
  v_ids uuid[]; v_id uuid; i integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOR i IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
    v_id := v_ids[i];
    PERFORM set_config('keystone.tenant_id', v_id::text, true);
    INSERT INTO keystone.document_setting (tenant_id, key, value, updated_by)
    SELECT s.tenant_id, substr(s.key, length('documents.') + 1), s.value, s.updated_by
      FROM keystone.tenant_setting s
     WHERE s.tenant_id = v_id
       AND s.key IN ('documents.reminder_days', 'documents.retention_years', 'documents.resign_months',
                     'documents.phone_verification_required', 'documents.signature_validity_days')
    ON CONFLICT (tenant_id, key) DO NOTHING;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $copy$;
