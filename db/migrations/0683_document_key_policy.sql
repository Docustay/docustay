-- 0683 · Draft-only keys and per-key daily limits (Final Push FP-G1, 7 Oct 2026). Additive. Three tables, none deletable by the app:
--   document_key_policy      — per key: draft_only (it may make and edit drafts; a send waits for a person), max drafts a day, max sends a day.
--   document_key_usage_day   — per key per day: drafts made, sends made (an exact counter, bumped in the same transaction as the work).
--   document_send_approval — a send a draft-only key asked for; a person approves or declines it in the app.
-- A key with no policy row behaves exactly as before.
CREATE TABLE keystone.document_key_policy (
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  token_id          text        NOT NULL CHECK (char_length(token_id) <= 40),
  draft_only        boolean     NOT NULL DEFAULT false,
  max_drafts_per_day integer    NULL CHECK (max_drafts_per_day IS NULL OR max_drafts_per_day BETWEEN 1 AND 100000),
  max_sends_per_day  integer    NULL CHECK (max_sends_per_day IS NULL OR max_sends_per_day BETWEEN 1 AND 100000),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, token_id)
);
ALTER TABLE keystone.document_key_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_key_policy FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_key_policy USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_key_policy FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_key_policy FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_key_policy FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.document_key_policy TO app_rw;
GRANT SELECT ON keystone.document_key_policy TO reference_guard;

CREATE TABLE keystone.document_key_usage_day (
  tenant_id uuid    NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  token_id  text    NOT NULL CHECK (char_length(token_id) <= 40),
  day       date    NOT NULL,
  drafts    integer NOT NULL DEFAULT 0 CHECK (drafts >= 0),
  sends     integer NOT NULL DEFAULT 0 CHECK (sends >= 0),
  PRIMARY KEY (tenant_id, token_id, day)
);
ALTER TABLE keystone.document_key_usage_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_key_usage_day FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_key_usage_day USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_key_usage_day FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_key_usage_day FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_key_usage_day FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.document_key_usage_day TO app_rw;
GRANT SELECT ON keystone.document_key_usage_day TO reference_guard;

CREATE TABLE keystone.document_send_approval (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id  uuid        NOT NULL,
  token_id     text        NOT NULL CHECK (char_length(token_id) <= 40),
  key_name     text        NULL CHECK (key_name IS NULL OR char_length(key_name) <= 120),
  test         boolean     NOT NULL DEFAULT false,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz NULL,
  decided_by   uuid        NULL,
  note         text        NULL CHECK (note IS NULL OR char_length(note) <= 500)
);
-- one open request per document: a second ask from the agent is the same ask
CREATE UNIQUE INDEX document_send_approval_open_idx ON keystone.document_send_approval (tenant_id, instance_id) WHERE status = 'pending';
CREATE INDEX document_send_approval_recent_idx ON keystone.document_send_approval (tenant_id, requested_at DESC);
ALTER TABLE keystone.document_send_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_send_approval FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_send_approval USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_send_approval FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_send_approval FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_send_approval FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.document_send_approval TO app_rw;
GRANT SELECT ON keystone.document_send_approval TO reference_guard;
