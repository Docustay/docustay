-- Run 9 Part 3.6 — A PLAYBOOK THAT RUNS (R9-a, R9-b; Pro `playbooks`).
-- The existing `document_playbook` (a named bundle of plays for Scribe) gains a FLOW: when a document made from a chosen template or form is signed by everyone, only if its answers
-- say so, send another template to the person who signed it (their answers filling its boxes), wait, then remind and tell the owner. A playbook with no flow stays a bundle of plays.
-- One run per (playbook, signed document): `document_playbook_run`. A wait is the run's own `next_run_at`, read by the due sweep — no second scheduler. Sends go through the one send path,
-- so only what a playbook sends counts toward the month's documents.
ALTER TABLE keystone.document_playbook
  ADD COLUMN IF NOT EXISTS flow        jsonb       NULL,
  ADD COLUMN IF NOT EXISTS enabled     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS run_count   integer     NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz NULL;
ALTER TABLE keystone.document_playbook DROP CONSTRAINT IF EXISTS document_playbook_enabled_needs_flow;
ALTER TABLE keystone.document_playbook ADD CONSTRAINT document_playbook_enabled_needs_flow CHECK (NOT enabled OR flow IS NOT NULL);
ALTER TABLE keystone.document_playbook DROP CONSTRAINT IF EXISTS document_playbook_flow_shape;
ALTER TABLE keystone.document_playbook ADD CONSTRAINT document_playbook_flow_shape CHECK (flow IS NULL OR (jsonb_typeof(flow) = 'object' AND jsonb_typeof(flow->'steps') = 'array' AND jsonb_array_length(flow->'steps') <= 12 AND pg_column_size(flow) <= 32768));
CREATE INDEX IF NOT EXISTS document_playbook_enabled_idx ON keystone.document_playbook (tenant_id) WHERE enabled AND NOT archived;

CREATE TABLE IF NOT EXISTS keystone.document_playbook_run (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  playbook_id        uuid        NOT NULL REFERENCES keystone.document_playbook(id) ON DELETE CASCADE,
  source_instance_id uuid        NULL REFERENCES keystone.document_instance(id) ON DELETE SET NULL,
  actor_user_id      uuid        NOT NULL,                     -- the playbook's owner when the run started: the run reads and sends as them (checked to be staff every time)
  status             text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'waiting', 'due', 'done', 'stopped', 'failed')),
  step               integer     NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 12),
  answers            jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object' AND pg_column_size(answers) <= 65536),
  sent_instance_id   uuid        NULL,                         -- the document this run sent last (the wait and the reminder are about it)
  log                jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(log) = 'array' AND jsonb_array_length(log) <= 60),
  next_run_at        timestamptz NULL CHECK ((status = 'waiting') = (next_run_at IS NOT NULL)),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz NULL CHECK ((status IN ('done', 'stopped', 'failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT document_playbook_run_once UNIQUE (tenant_id, playbook_id, source_instance_id)
);
CREATE INDEX IF NOT EXISTS document_playbook_run_due_idx ON keystone.document_playbook_run (tenant_id, next_run_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS document_playbook_run_book_idx ON keystone.document_playbook_run (tenant_id, playbook_id, created_at DESC);

ALTER TABLE keystone.document_playbook_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_playbook_run FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_playbook_run USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_playbook_run FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_playbook_run FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY workspace_deletion ON keystone.document_playbook_run FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT, UPDATE ON keystone.document_playbook_run TO app_rw;
GRANT SELECT, INSERT, UPDATE ON keystone.document_playbook_run TO app_worker;
GRANT SELECT, UPDATE ON keystone.document_playbook TO app_worker;   -- the worker finds the playbooks a signed document starts and counts their runs
DROP TRIGGER IF EXISTS ks_notify_change ON keystone.document_playbook_run;
CREATE TRIGGER ks_notify_change AFTER INSERT OR DELETE OR UPDATE ON keystone.document_playbook_run FOR EACH ROW EXECUTE FUNCTION keystone.ks_notify_change('documents');
