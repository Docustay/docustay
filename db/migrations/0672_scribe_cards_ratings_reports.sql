-- 0672 · Scribe grows up (7 Oct 2026). Additive.
--   · a proposal can now be of kind people / details / created / template / confirm (a card the person presses), carrying its action, its payload, the draft it is about and what happened;
--   · a rating table (thumbs up or down: only the rating and the ids, never text);
--   · a report table for "Talk to a person" and "Report a problem" (the screen, the route, ids; text only when the person ticks the box).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'keystone.document_chat_proposal'::regclass AND contype = 'c' AND (pg_get_constraintdef(oid) ILIKE '%kind%' OR pg_get_constraintdef(oid) ILIKE '%state%') LOOP
    EXECUTE format('ALTER TABLE keystone.document_chat_proposal DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE keystone.document_chat_proposal
  ADD CONSTRAINT document_chat_proposal_kind_check  CHECK (kind IN ('changes','values','people','details','created','template','confirm')),
  ADD CONSTRAINT document_chat_proposal_state_check CHECK (state IN ('proposed','accepted','rejected','undone','confirmed','failed')),
  ADD COLUMN IF NOT EXISTS action      text  NULL CHECK (action IS NULL OR action IN ('send','remind','resend','void','copy','use_template','bulk_send','support')),
  ADD COLUMN IF NOT EXISTS payload     jsonb NULL,
  ADD COLUMN IF NOT EXISTS document_id uuid  NULL,
  ADD COLUMN IF NOT EXISTS result      jsonb NULL;
CREATE INDEX IF NOT EXISTS document_chat_proposal_document_idx ON keystone.document_chat_proposal (tenant_id, document_id) WHERE document_id IS NOT NULL;

-- the action log gains two actions: a draft the assistant made, and a card the person pressed (the note says which: send, remind, resend, void, copy, use_template, bulk_send, support)
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'keystone.document_ai_action'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%proposed%' LOOP
    EXECUTE format('ALTER TABLE keystone.document_ai_action DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE keystone.document_ai_action ADD CONSTRAINT document_ai_action_action_check CHECK (action IN ('proposed','failed','accepted','rejected','undone','created','confirmed'));

CREATE TABLE keystone.document_chat_rating (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  conversation_id uuid        NOT NULL,
  message_seq     integer     NOT NULL,
  user_id         uuid        NULL,
  rating          smallint    NOT NULL CHECK (rating IN (-1, 1)),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chat_rating_conversation_fkey FOREIGN KEY (tenant_id, conversation_id) REFERENCES keystone.document_chat_conversation (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT document_chat_rating_once UNIQUE (tenant_id, conversation_id, message_seq)
);

ALTER TABLE keystone.document_chat_rating ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_chat_rating FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_chat_rating USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_chat_rating FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_chat_rating FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_chat_rating FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_chat_rating FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_chat_rating TO app_rw;
GRANT SELECT ON keystone.document_chat_rating TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_chat_rating_refuse_reference_delete_trg AFTER DELETE ON keystone.document_chat_rating
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_rating ENABLE ALWAYS TRIGGER document_chat_rating_refuse_reference_delete_trg;
CREATE TRIGGER document_chat_rating_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_chat_rating
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_rating ENABLE ALWAYS TRIGGER document_chat_rating_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

CREATE TABLE keystone.document_chat_report (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  conversation_id uuid        NULL,
  reporter_id     uuid        NULL,
  kind            text        NOT NULL CHECK (kind IN ('person','problem')),
  screen          text        NULL CHECK (screen IS NULL OR char_length(screen) <= 200),
  document_id     uuid        NULL,
  include_text    boolean     NOT NULL DEFAULT false,
  note            text        NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  document_text   text        NULL CHECK (document_text IS NULL OR char_length(document_text) <= 20000),
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE keystone.document_chat_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_chat_report FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_chat_report USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_chat_report FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_chat_report FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_chat_report FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_chat_report FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_chat_report TO app_rw;
GRANT SELECT ON keystone.document_chat_report TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_chat_report_refuse_reference_delete_trg AFTER DELETE ON keystone.document_chat_report
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_report ENABLE ALWAYS TRIGGER document_chat_report_refuse_reference_delete_trg;
CREATE TRIGGER document_chat_report_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_chat_report
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_chat_report ENABLE ALWAYS TRIGGER document_chat_report_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
