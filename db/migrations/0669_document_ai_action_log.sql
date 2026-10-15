-- 0669 · B11 — THE AI ACTION LOG. One row each time the assistant proposes something and each time a person accepts or rejects it. It records WHAT happened (counts, the document, who, which model, tokens) and NEVER the prompt text or the document text.
-- Append-only (no update, no delete path). Additive.
CREATE TABLE keystone.document_ai_action (
  id             uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid        NULL,
  job_id         uuid        NULL,
  kind           text        NOT NULL CHECK (kind IN ('draft','edit','fill','chat')),
  action         text        NOT NULL CHECK (action IN ('proposed','failed','accepted','rejected','undone')),
  target_type    text        NULL CHECK (target_type IN ('document','template')),
  target_id      uuid        NULL,
  counts         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provider       text        NULL,
  model          text        NULL,
  input_tokens   integer     NULL,
  output_tokens  integer     NULL,
  note           text        NULL CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT document_ai_action_actor_fkey FOREIGN KEY (tenant_id, actor_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (actor_user_id)
);
CREATE UNIQUE INDEX document_ai_action_tenant_id_key ON keystone.document_ai_action (tenant_id, id);
CREATE INDEX document_ai_action_tenant_at_idx ON keystone.document_ai_action (tenant_id, at DESC);
CREATE INDEX document_ai_action_job_idx ON keystone.document_ai_action (tenant_id, job_id);

ALTER TABLE keystone.document_ai_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_ai_action FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_ai_action USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_ai_action FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_ai_action FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT ON keystone.document_ai_action TO app_rw;
GRANT SELECT ON keystone.document_ai_action TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_ai_action_refuse_reference_delete_trg AFTER DELETE ON keystone.document_ai_action
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_action ENABLE ALWAYS TRIGGER document_ai_action_refuse_reference_delete_trg;
CREATE TRIGGER document_ai_action_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_ai_action
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_action ENABLE ALWAYS TRIGGER document_ai_action_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
