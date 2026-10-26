-- 0640 · PART 30 item 10 — SENDING FROM THE ORGANISATION'S OWN MAILBOX (Google or Microsoft), and an honest record when a chosen sender could not be used.
--  · keystone.mail_mailbox — one connected mailbox per organisation: which provider, which address, whether it still works. The refresh token itself is NOT here: it is a sealed envelope in mail_secret (name 'mailbox_refresh_token'), like the SMTP password.
--  · mail_identity.fallback_* — every time an organisation chose its own sender (domain, mail server, mailbox) and the mail went out from the platform address instead, this says when, why and how many times. Before this the fallback was silent at send time.
-- Additive only. Row-level security FORCED.
CREATE TABLE keystone.mail_mailbox (
  tenant_id    uuid        PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  provider     text        NOT NULL CHECK (provider IN ('google','microsoft')),
  email        text        NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  display_name text        NULL CHECK (display_name IS NULL OR length(display_name) <= 200),
  scopes       text[]      NOT NULL DEFAULT '{}',
  status       text        NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_reconnect')),
  last_error   text        NULL CHECK (last_error IS NULL OR length(last_error) <= 300),
  connected_by uuid        NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.mail_mailbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.mail_mailbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.mail_mailbox USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.mail_mailbox FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.mail_mailbox FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete ON keystone.mail_mailbox FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.mail_mailbox TO app_rw;
GRANT SELECT, UPDATE ON keystone.mail_mailbox TO app_worker;

ALTER TABLE keystone.mail_identity
  ADD COLUMN IF NOT EXISTS fallback_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS fallback_reason text        NULL CHECK (fallback_reason IS NULL OR length(fallback_reason) <= 400),
  ADD COLUMN IF NOT EXISTS fallback_count  integer     NOT NULL DEFAULT 0;
