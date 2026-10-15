-- 0607 · A RESUMABLE UPLOAD (QUEUE §23.4.1: "resumable… up to 100 MB"). The application accepts at most 1 MiB per request, so a file travels as numbered parts of at most 768 KiB. Each part is stored as its own object
-- through the `files` port and recorded here; `complete` joins them, checks the total and the SHA-256 the page computed, and starts the draft document. An interrupted upload is resumed by asking which parts arrived.
-- Parts are removed once the file is in (and by the same job that ages out stale uploads — an upload nobody completes within a day is abandoned).
CREATE TABLE keystone.document_upload (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_by   uuid        NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  name         text        NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 255),
  size_bytes   bigint      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  part_bytes   integer     NOT NULL CHECK (part_bytes BETWEEN 65536 AND 786432),
  sha256       text        NULL CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),                 -- what the page computed, checked at complete
  parts        jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parts) = 'object'),       -- { "<n>": {"key":"…","size":123} }
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete','abandoned')),
  instance_id  uuid        NULL REFERENCES keystone.document_instance(id) ON DELETE SET NULL,        -- set when the upload became a document
  package_lead_id uuid     NULL,                                                                      -- an upload that is a further document of a package names the lead it joins
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_upload_open ON keystone.document_upload (tenant_id, created_at) WHERE status = 'open';
ALTER TABLE keystone.document_upload ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_upload FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_upload USING (tenant_id = keystone.current_tenant_id() AND (created_by = keystone.current_user_id() OR created_by IS NULL));
CREATE POLICY tenant_insert    ON keystone.document_upload FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.document_upload TO app_rw;
GRANT SELECT, UPDATE ON keystone.document_upload TO app_worker;
