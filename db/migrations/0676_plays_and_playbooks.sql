-- FINAL PUSH Stage 4 (7 Oct 2026): Plays and Playbooks.
--   · document_play: a workspace's own play (Pro). Its words live in IMMUTABLE versions (document_play_version); `current_version` is the published one (0 = never published, so unusable).
--   · document_playbook: a named bundle of plays (play names, in order).
--   · document_instance.play_ref: which play (and version) made a document — "builtin:<name>@<hash8>" or "ws:<play id>@<n>".
--   · the chat can show a "this is Pro" card (proposal kind 'pro').
CREATE TABLE keystone.document_play (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name            text        NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  kind            text        NOT NULL CHECK (kind IN ('document','addon','house_style','form')),
  category        text        NOT NULL CHECK (category IN ('contracts','legal','waivers','work','payments','property','forms','addons','house')),
  title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description     text        NOT NULL CHECK (char_length(description) BETWEEN 12 AND 240),
  current_version integer     NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  archived        boolean     NOT NULL DEFAULT false,
  created_by      uuid        NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_play_name_once UNIQUE (tenant_id, name)
);
CREATE TABLE keystone.document_play_version (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  play_id     uuid        NOT NULL REFERENCES keystone.document_play(id) ON DELETE CASCADE,
  version     integer     NOT NULL CHECK (version >= 1),
  source      text        NOT NULL CHECK (char_length(source) <= 60000),
  hash        text        NOT NULL,
  created_by  uuid        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_play_version_once UNIQUE (play_id, version)
);
CREATE OR REPLACE FUNCTION keystone.document_play_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'a play version is never changed: save a new version' USING ERRCODE = '23000'; END $$;
CREATE TRIGGER document_play_version_immutable_trg BEFORE UPDATE ON keystone.document_play_version FOR EACH ROW EXECUTE FUNCTION keystone.document_play_version_immutable();
CREATE TABLE keystone.document_playbook (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name        text        NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 240),
  plays       text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(plays) <= 12),
  archived    boolean     NOT NULL DEFAULT false,
  created_by  uuid        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_playbook_name_once UNIQUE (tenant_id, name)
);
CREATE INDEX document_play_version_play_idx ON keystone.document_play_version (play_id, version DESC);
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS play_ref text NULL CHECK (play_ref IS NULL OR char_length(play_ref) <= 120);

ALTER TABLE keystone.document_play ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_play FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_play USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_play FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_play FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_play FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_play FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_play TO app_rw;
GRANT SELECT ON keystone.document_play TO reference_guard;

ALTER TABLE keystone.document_play_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_play_version FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_play_version USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_play_version FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_play_version FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_play_version FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_play_version FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_play_version TO app_rw;
GRANT SELECT ON keystone.document_play_version TO reference_guard;

ALTER TABLE keystone.document_playbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_playbook FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_playbook USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_playbook FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.document_playbook FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.document_playbook FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_playbook FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_playbook TO app_rw;
GRANT SELECT ON keystone.document_playbook TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_play_refuse_reference_delete_trg AFTER DELETE ON keystone.document_play
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_play ENABLE ALWAYS TRIGGER document_play_refuse_reference_delete_trg;
CREATE TRIGGER document_play_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_play
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_play ENABLE ALWAYS TRIGGER document_play_refuse_reference_truncate_trg;
CREATE TRIGGER document_play_version_refuse_reference_delete_trg AFTER DELETE ON keystone.document_play_version
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_play_version ENABLE ALWAYS TRIGGER document_play_version_refuse_reference_delete_trg;
CREATE TRIGGER document_play_version_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_play_version
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_play_version ENABLE ALWAYS TRIGGER document_play_version_refuse_reference_truncate_trg;
CREATE TRIGGER document_playbook_refuse_reference_delete_trg AFTER DELETE ON keystone.document_playbook
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_playbook ENABLE ALWAYS TRIGGER document_playbook_refuse_reference_delete_trg;
CREATE TRIGGER document_playbook_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_playbook
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_playbook ENABLE ALWAYS TRIGGER document_playbook_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'keystone.document_chat_proposal'::regclass AND contype = 'c' AND (pg_get_constraintdef(oid) ILIKE '%kind%' OR pg_get_constraintdef(oid) ILIKE '%state%') LOOP
    EXECUTE format('ALTER TABLE keystone.document_chat_proposal DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE keystone.document_chat_proposal
  ADD CONSTRAINT document_chat_proposal_kind_check  CHECK (kind IN ('changes','values','people','details','created','template','confirm','questions','pro')),
  ADD CONSTRAINT document_chat_proposal_state_check CHECK (state IN ('proposed','accepted','rejected','undone','confirmed','failed'));
