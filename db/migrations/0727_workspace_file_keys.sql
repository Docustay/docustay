-- 0727 · per-workspace keys for the stored document files (Run 9 Part 4.4).
-- Every PDF, upload and sealed copy a workspace stores is encrypted before it reaches the bucket, with a data key that belongs to that workspace alone. The key is never kept in the clear:
-- it is sealed through the platform's envelope (src/secrets/envelope.mjs: AES-256-GCM, the platform key, AAD bound to the workspace and the purpose "workspace_file_key"), so a copied row
-- cannot be opened in another workspace. One row per key. Exactly one is 'active' (new files use it); a rotated-out key is 'retiring' until the re-encrypt job has moved every file off it,
-- then 'retired'. A key row is never deleted while its workspace exists — a restored backup must still open every file it points at. Same shape and policies as the table 0652 made.
CREATE TABLE keystone.workspace_file_key (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key_no             integer     NOT NULL CHECK (key_no >= 1),
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retiring', 'retired')),
  secret_envelope    jsonb       NOT NULL,
  kek_version        smallint    NOT NULL DEFAULT 1 CHECK (kek_version >= 1),
  secret_fingerprint text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  retired_at         timestamptz NULL,
  files_sealed_at    timestamptz NULL,   -- set on the active key when a full pass of the re-encrypt job found every stored file of the workspace on it; NULL means the job still has to look
  UNIQUE (tenant_id, key_no)
);
-- two writers racing to make a workspace's first key: the second insert collides here and reads the winner's row
CREATE UNIQUE INDEX workspace_file_key_one_active ON keystone.workspace_file_key (tenant_id) WHERE status = 'active';
ALTER TABLE keystone.workspace_file_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.workspace_file_key FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.workspace_file_key USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.workspace_file_key FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.workspace_file_key FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.workspace_file_key FOR DELETE USING (tenant_id = keystone.current_tenant_id());
-- the web process makes a workspace's first key the moment it stores its first file; the worker rotates, re-encrypts and re-wraps. Nobody deletes a key row except the workspace-erasure procedure.
GRANT SELECT, INSERT, UPDATE ON keystone.workspace_file_key TO app_rw;
GRANT SELECT, INSERT, UPDATE ON keystone.workspace_file_key TO app_worker;
COMMENT ON TABLE keystone.workspace_file_key IS '0727 — a workspace''s data key for its stored document files, sealed through the platform envelope (AAD = workspace + purpose). The key itself is never stored or returned in the clear.';
-- the platform-key re-wrap job (src/secrets/rewrap.mjs) finds this table's rows by `WHERE kek_version = $1`, like the other storing tables (0217)
CREATE INDEX workspace_file_key_kek_version_idx ON keystone.workspace_file_key (kek_version) WHERE kek_version <> 1;
