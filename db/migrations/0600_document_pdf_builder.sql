-- 0600 · THE UPLOAD FLOW'S DATA (QUEUE §23 Part 4: 23.4.1 – 23.4.15). See specs/proofs/part-4/AUDIT.md §4.
--
--  1. A THIRD BUILDER, `pdf`: an uploaded file with fields placed on its pages. Only the CHECK constraints are widened (builder, body kind, snapshot builder list); no row is rewritten.
--       template body / frozen body = { kind:'pdf', schema_version:1, file:{ file_id, sha256, page_count, pages:[{w,h}], name }, roles:[…], fields:[…] }
--  2. `document_file` — the BYTES' ledger: original / converted / final / attachment, each with its SHA-256, size, page sizes and storage key. Bytes live in object storage, never in Postgres.
--     Once the owning document is executed the row cannot be changed or deleted (outside the audited delete reason after retention) — it is the original the final copy was made from.
--  3. A recipient with no account signs under the role `signer_N` (a person is NAMED on the row; the role says which seat they sat in). `signature_record` and `document_party` accept it.
--  4. `document_party` learns what a recipient has DONE so far (viewed, saved-for-later progress, a decline reason); `document_instance` learns the send's options and a scheduled send time.
-- ★ Additive except the widened CHECKs. Row-level security FORCED on the new table.

-- ── 1 · the builder ──────────────────────────────────────────────────────────
ALTER TABLE keystone.document_template DROP CONSTRAINT document_template_builder_check;
ALTER TABLE keystone.document_template ADD  CONSTRAINT document_template_builder_check CHECK (builder = ANY (ARRAY['contract','form','pdf']));
ALTER TABLE keystone.document_instance DROP CONSTRAINT document_instance_builder_check;
ALTER TABLE keystone.document_instance ADD  CONSTRAINT document_instance_builder_check CHECK (builder = ANY (ARRAY['contract','form','pdf']));

ALTER TABLE keystone.document_template DROP CONSTRAINT template_body_array_matches_kind;
ALTER TABLE keystone.document_template ADD  CONSTRAINT template_body_array_matches_kind CHECK (
     (builder = 'contract' AND body ? 'sections' AND jsonb_typeof(body -> 'sections') = 'array' AND NOT (body ? 'fields'))
  OR (builder = 'form'     AND body ? 'fields'   AND jsonb_typeof(body -> 'fields')   = 'array' AND NOT (body ? 'sections'))
  OR (builder = 'pdf'      AND body ? 'fields'   AND jsonb_typeof(body -> 'fields')   = 'array' AND jsonb_typeof(body -> 'file') = 'object' AND NOT (body ? 'sections')));

ALTER TABLE keystone.document_template DROP CONSTRAINT template_body_not_empty;
ALTER TABLE keystone.document_template ADD  CONSTRAINT template_body_not_empty CHECK (
  CASE
    WHEN builder = 'contract' AND body ? 'sections' THEN jsonb_array_length(body -> 'sections') > 0
    WHEN builder = 'form'     AND body ? 'fields'   THEN jsonb_array_length(body -> 'fields') > 0
    WHEN builder = 'pdf'      AND body ? 'file'     THEN true          -- a document with no fields yet is a draft in the placing step, not an empty template
    ELSE false
  END);

ALTER TABLE keystone.document_instance DROP CONSTRAINT snapshot_is_readable;
ALTER TABLE keystone.document_instance ADD  CONSTRAINT snapshot_is_readable CHECK (
  template_snapshot IS NULL OR (
        template_snapshot ? 'law3_version' AND (template_snapshot ->> 'law3_version') = '1'
    AND template_snapshot ? 'builder'      AND (template_snapshot ->> 'builder') = ANY (ARRAY['contract','form','pdf'])
    AND template_snapshot ? 'title'        AND length(COALESCE(template_snapshot ->> 'title', '')) > 0
    AND template_snapshot ? 'disclosure'   AND (template_snapshot -> 'disclosure') ? 'status'
    AND ((template_snapshot -> 'disclosure') ->> 'status') = ANY (ARRAY['CAPTURED','NOT_ACCEPTED','NO_CONSUMER_SIGNER'])));

ALTER TABLE keystone.document_instance DROP CONSTRAINT template_body_is_readable;
ALTER TABLE keystone.document_instance ADD  CONSTRAINT template_body_is_readable CHECK (
  template_body_snapshot IS NULL OR (
        template_body_snapshot ? 'kind' AND (template_body_snapshot ->> 'kind') = ANY (ARRAY['contract','form','pdf'])
    AND template_body_snapshot ? 'schema_version'
    AND ( ((template_body_snapshot ->> 'kind') = 'contract' AND jsonb_typeof(template_body_snapshot -> 'sections') = 'array' AND jsonb_array_length(template_body_snapshot -> 'sections') > 0)
       OR ((template_body_snapshot ->> 'kind') = 'form'     AND jsonb_typeof(template_body_snapshot -> 'fields') = 'array')
       OR ((template_body_snapshot ->> 'kind') = 'pdf'      AND jsonb_typeof(template_body_snapshot -> 'fields') = 'array' AND jsonb_typeof(template_body_snapshot -> 'file') = 'object'))));

-- ── 3 · a recipient's seat ────────────────────────────────────────────────────
ALTER TABLE keystone.signature_record DROP CONSTRAINT signature_record_role_check;
ALTER TABLE keystone.signature_record ADD  CONSTRAINT signature_record_role_check CHECK (
  role = ANY (ARRAY['pir','parent','coach','client','consultant','familyMember','recipient']) OR role ~ '^signer_[0-9]{1,3}$');
ALTER TABLE keystone.document_party DROP CONSTRAINT document_party_role_check;
ALTER TABLE keystone.document_party ADD  CONSTRAINT document_party_role_check CHECK (
  role = ANY (ARRAY['pir','parent','coach','client','consultant','familyMember','recipient']) OR role ~ '^signer_[0-9]{1,3}$');

-- ── 4 · what a recipient has done; the send's options ─────────────────────────
ALTER TABLE keystone.document_party
  ADD COLUMN viewed_at      timestamptz NULL,
  ADD COLUMN progress       jsonb       NULL CHECK (progress IS NULL OR jsonb_typeof(progress) = 'object'),   -- saved-for-later field values (never evidence until signed)
  ADD COLUMN decline_reason text        NULL,
  ADD COLUMN completed_at   timestamptz NULL;
ALTER TABLE keystone.document_instance
  ADD COLUMN send_options     jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(send_options) = 'object'),
  ADD COLUMN scheduled_send_at timestamptz NULL,
  ADD COLUMN final_sha256     text        NULL CHECK (final_sha256 IS NULL OR final_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN voided_at        timestamptz NULL,
  ADD COLUMN void_reason      text        NULL;

-- ── 2 · the file ledger ───────────────────────────────────────────────────────
CREATE TABLE keystone.document_file (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id  uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('original','converted','final','attachment')),
  name         text        NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 255),
  mime         text        NOT NULL,
  byte_size    bigint      NOT NULL CHECK (byte_size > 0),
  sha256       text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key  text        NOT NULL CHECK (length(storage_key) > 0),
  page_count   integer     NULL CHECK (page_count IS NULL OR page_count > 0),
  pages        jsonb       NULL CHECK (pages IS NULL OR jsonb_typeof(pages) = 'array'),                    -- [{w,h}] in PDF points, one per page
  meta         jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),             -- flags found at processing: scanned, locked, already_signed, acroform …
  position     integer     NOT NULL DEFAULT 1 CHECK (position >= 1),
  created_by   uuid        NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, storage_key)
);
CREATE INDEX document_file_by_instance ON keystone.document_file (tenant_id, instance_id, kind, position);
ALTER TABLE keystone.document_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_file FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_file USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_file FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_file FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_file FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_file TO app_rw;
GRANT SELECT ON keystone.document_file TO app_worker;

-- the bytes of a signed document are the record: an executed or declined document's files cannot be changed or deleted (the audited delete reason, after retention, still removes the whole document)
CREATE FUNCTION keystone.document_file_is_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' AND nullif(btrim(coalesce(current_setting('keystone.record_delete_reason', true), '')), '') IS NOT NULL THEN RETURN OLD; END IF;
  SELECT state INTO st FROM keystone.document_instance WHERE id = OLD.instance_id;
  IF st IN ('executed','declined') AND NOT (TG_OP = 'UPDATE' AND OLD.kind = 'final') THEN
    RAISE EXCEPTION 'the files of an % document are the record of what was signed and cannot be changed (U25)', st USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_file_frozen BEFORE UPDATE OR DELETE ON keystone.document_file FOR EACH ROW EXECUTE FUNCTION keystone.document_file_is_frozen();
