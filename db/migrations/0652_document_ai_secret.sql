-- 0652 · the workspace's OWN AI provider key, sealed (shared document engine, design §6). The island's earlier secrets table was renamed mail_secret by 0620 (the mail module owns it), so
-- the island keeps its own: one row per workspace and name, the envelope sealed through the host's secrets port, never the key itself. Same shape and policies as the table 0599 made.
CREATE TABLE keystone.document_ai_secret (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name               text        NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*$'),
  secret_envelope    jsonb       NOT NULL,
  kek_version        smallint    NOT NULL DEFAULT 1 CHECK (kek_version >= 1),
  secret_fingerprint text        NOT NULL,
  updated_by         uuid        NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE keystone.document_ai_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_ai_secret FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_ai_secret USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_ai_secret FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_ai_secret FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_ai_secret FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_ai_secret TO app_rw;
GRANT SELECT, UPDATE ON keystone.document_ai_secret TO app_worker;      -- the worker opens the key to make the call; the KEK rewrap job re-seals envelopes
COMMENT ON TABLE keystone.document_ai_secret IS '0652 — a workspace''s own AI provider key as a sealed envelope (host secrets port). The key itself is never stored or returned.';
