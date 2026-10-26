-- 0670 · B13 — THE ASSISTANT CHAT (design: specs/AI-CHAT-SPEC-6OCT.md §8). Four additive tables, FORCED row-level security, tenant-scoped like the rest of Documents.
--   document_chat_conversation — one per conversation, owned by one person
--   document_chat_message      — what was said, exactly as sent to / received from the provider (the open document's text is NOT stored here: it is rebuilt each turn)
--   document_chat_summary      — the compacted older part of a long conversation (the full log stays in document_chat_message)
--   document_chat_proposal     — a suggestion the assistant made, with what it would change, and what the person did with it
-- Retention (setting ai.chat_retention_days) is a worker sweep that deletes these rows; the separate action log (document_ai_action, 0669) holds no text and is not touched by it.
CREATE TABLE keystone.document_chat_conversation (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  owner_user_id uuid        NULL,
  screen        text        NULL CHECK (screen IS NULL OR char_length(screen) <= 200),
  document_id   uuid        NULL,
  template_id   uuid        NULL,
  title         text        NULL CHECK (title IS NULL OR char_length(title) <= 120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chat_conversation_owner_fkey FOREIGN KEY (tenant_id, owner_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (owner_user_id)
);
CREATE UNIQUE INDEX document_chat_conversation_tenant_id_key ON keystone.document_chat_conversation (tenant_id, id);
CREATE INDEX document_chat_conversation_owner_idx ON keystone.document_chat_conversation (tenant_id, owner_user_id, last_at DESC);

ALTER TABLE keystone.document_chat_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_chat_conversation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_chat_conversation USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_chat_conversation FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_chat_conversation FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_chat_conversation FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_chat_conversation FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_chat_conversation TO app_rw;
GRANT SELECT ON keystone.document_chat_conversation TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_chat_conversation_refuse_reference_delete_trg AFTER DELETE ON keystone.document_chat_conversation
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_conversation ENABLE ALWAYS TRIGGER document_chat_conversation_refuse_reference_delete_trg;
CREATE TRIGGER document_chat_conversation_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_chat_conversation
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_conversation ENABLE ALWAYS TRIGGER document_chat_conversation_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

CREATE TABLE keystone.document_chat_message (
  id                    uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id             uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  conversation_id       uuid        NOT NULL,
  seq                   integer     NOT NULL,
  role                  text        NOT NULL CHECK (role IN ('user','assistant')),
  content               jsonb       NOT NULL,
  input_tokens          integer     NULL,
  output_tokens         integer     NULL,
  cache_read_tokens     integer     NULL,
  cache_creation_tokens integer     NULL,
  model                 text        NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chat_message_conversation_fkey FOREIGN KEY (tenant_id, conversation_id) REFERENCES keystone.document_chat_conversation (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT document_chat_message_seq_key UNIQUE (tenant_id, conversation_id, seq)
);
CREATE UNIQUE INDEX document_chat_message_tenant_id_key ON keystone.document_chat_message (tenant_id, id);
CREATE INDEX document_chat_message_created_idx ON keystone.document_chat_message (tenant_id, created_at);

ALTER TABLE keystone.document_chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_chat_message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_chat_message USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_chat_message FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_chat_message FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_chat_message FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, DELETE ON keystone.document_chat_message TO app_rw;
GRANT SELECT ON keystone.document_chat_message TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_chat_message_refuse_reference_delete_trg AFTER DELETE ON keystone.document_chat_message
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_message ENABLE ALWAYS TRIGGER document_chat_message_refuse_reference_delete_trg;
CREATE TRIGGER document_chat_message_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_chat_message
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_message ENABLE ALWAYS TRIGGER document_chat_message_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

CREATE TABLE keystone.document_chat_summary (
  id                  uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id           uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  conversation_id     uuid        NOT NULL,
  covers_through_seq  integer     NOT NULL,
  text                text        NOT NULL CHECK (char_length(text) <= 6000),
  tokens              integer     NULL,
  model               text        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chat_summary_conversation_fkey FOREIGN KEY (tenant_id, conversation_id) REFERENCES keystone.document_chat_conversation (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX document_chat_summary_conv_idx ON keystone.document_chat_summary (tenant_id, conversation_id, covers_through_seq DESC);

ALTER TABLE keystone.document_chat_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_chat_summary FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_chat_summary USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_chat_summary FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_chat_summary FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_chat_summary FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, DELETE ON keystone.document_chat_summary TO app_rw;
GRANT SELECT ON keystone.document_chat_summary TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_chat_summary_refuse_reference_delete_trg AFTER DELETE ON keystone.document_chat_summary
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_summary ENABLE ALWAYS TRIGGER document_chat_summary_refuse_reference_delete_trg;
CREATE TRIGGER document_chat_summary_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_chat_summary
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_summary ENABLE ALWAYS TRIGGER document_chat_summary_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

CREATE TABLE keystone.document_chat_proposal (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  conversation_id uuid        NOT NULL,
  message_seq     integer     NULL,
  kind            text        NOT NULL CHECK (kind IN ('changes','values')),
  summary         text        NULL CHECK (summary IS NULL OR char_length(summary) <= 300),
  patches         jsonb       NULL,
  vals            jsonb       NULL,
  previous_source jsonb       NULL,
  state           text        NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','accepted','rejected','undone')),
  decided_by      uuid        NULL,
  decided_at      timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chat_proposal_conversation_fkey FOREIGN KEY (tenant_id, conversation_id) REFERENCES keystone.document_chat_conversation (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX document_chat_proposal_tenant_id_key ON keystone.document_chat_proposal (tenant_id, id);
CREATE INDEX document_chat_proposal_created_idx ON keystone.document_chat_proposal (tenant_id, created_at);

ALTER TABLE keystone.document_chat_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_chat_proposal FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_chat_proposal USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_chat_proposal FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_chat_proposal FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_chat_proposal FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_chat_proposal FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_chat_proposal TO app_rw;
GRANT SELECT ON keystone.document_chat_proposal TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_chat_proposal_refuse_reference_delete_trg AFTER DELETE ON keystone.document_chat_proposal
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_proposal ENABLE ALWAYS TRIGGER document_chat_proposal_refuse_reference_delete_trg;
CREATE TRIGGER document_chat_proposal_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_chat_proposal
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_proposal ENABLE ALWAYS TRIGGER document_chat_proposal_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
