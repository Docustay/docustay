-- FINAL PUSH Stage 6 / FP-C1 (7 Oct 2026): the developer's OWN reference on documents and templates. `metadata` = key-value text the developer chooses (at most 20 keys, enforced by the server and by this CHECK's size bound);
-- `external_id` = their id for the thing. `party_refs` = per seat {externalId, metadata}, kept on the document so a person's row needs no change. Additive; existing rows read as empty.
ALTER TABLE keystone.document_instance
  ADD COLUMN IF NOT EXISTS metadata    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16000),
  ADD COLUMN IF NOT EXISTS external_id text  NULL CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS party_refs  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(party_refs) = 'object' AND pg_column_size(party_refs) <= 32000);
ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS metadata    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16000),
  ADD COLUMN IF NOT EXISTS external_id text  NULL CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 200);
CREATE INDEX IF NOT EXISTS document_instance_external_idx ON keystone.document_instance (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_instance_metadata_idx ON keystone.document_instance USING gin (metadata jsonb_path_ops) WHERE metadata <> '{}'::jsonb;
