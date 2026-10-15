-- 0620 · THE SHARED MAIL MODULE (QUEUE Batch A, the maintainer 3 Oct 2026). One sending identity per organisation, used by every email family (the platform's templates and the Documents island).
-- The island's two mail tables MOVE into the module (renamed, data and policies kept): `document_email_domain` → `mail_domain`, `document_secret` → `mail_secret`.
-- New: `mail_identity` (mode, From, Reply-To, SMTP settings, per-organisation sending limit), `mail_usage` (sends per day, for the limit), `mail_event` (delivered / bounced / complained, by provider message id).
-- The island's `email.*` settings values are copied into `mail_identity` and removed from `document_setting`. Additive for the data; row-level security FORCED on every new table.
ALTER TABLE keystone.document_email_domain RENAME TO mail_domain;
ALTER TABLE keystone.document_secret       RENAME TO mail_secret;

CREATE TABLE keystone.mail_identity (
  tenant_id     uuid        PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  mode          text        NOT NULL DEFAULT 'platform' CHECK (mode IN ('platform','domain','smtp','mailbox')),
  from_name     text        NOT NULL DEFAULT '',
  from_address  text        NOT NULL DEFAULT '',
  reply_to      text        NOT NULL DEFAULT '',
  smtp_host     text        NOT NULL DEFAULT '',
  smtp_port     integer     NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_user     text        NOT NULL DEFAULT '',
  smtp_security text        NOT NULL DEFAULT 'starttls' CHECK (smtp_security IN ('starttls','tls','none')),
  daily_limit   integer     NULL CHECK (daily_limit IS NULL OR daily_limit >= 0),
  updated_by    uuid        NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE keystone.mail_usage (
  tenant_id uuid    NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  day       date    NOT NULL,
  sent      integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (tenant_id, day)
);
CREATE TABLE keystone.mail_event (
  id                  uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id           uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  provider_message_id text        NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('delivered','bounced','complained')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_message_id, kind)
);
CREATE INDEX mail_event_by_kind ON keystone.mail_event (tenant_id, kind, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mail_identity','mail_usage','mail_event'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_update ON keystone.%I FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON keystone.%I TO app_rw, app_worker', t);
  END LOOP;
  EXECUTE 'CREATE POLICY tenant_delete ON keystone.mail_identity FOR DELETE USING (tenant_id = keystone.current_tenant_id())';
  EXECUTE 'GRANT DELETE ON keystone.mail_identity TO app_rw';
END $$;

-- copy the island's email.* settings into the module, then take them out of the island's table
INSERT INTO keystone.mail_identity (tenant_id, mode, from_name, from_address, reply_to, smtp_host, smtp_port, smtp_user, smtp_security)
SELECT t.tenant_id,
       coalesce(max(CASE WHEN s.key='email.provider' THEN s.value #>> '{}' END), 'platform'),
       coalesce(max(CASE WHEN s.key='email.from_name' THEN s.value #>> '{}' END), ''),
       coalesce(max(CASE WHEN s.key='email.from_address' THEN s.value #>> '{}' END), ''),
       coalesce(max(CASE WHEN s.key='email.reply_to' THEN s.value #>> '{}' END), ''),
       coalesce(max(CASE WHEN s.key='email.smtp_host' THEN s.value #>> '{}' END), ''),
       coalesce(max(CASE WHEN s.key='email.smtp_port' THEN (s.value #>> '{}')::int END), 587),
       coalesce(max(CASE WHEN s.key='email.smtp_user' THEN s.value #>> '{}' END), ''),
       coalesce(max(CASE WHEN s.key='email.smtp_security' THEN s.value #>> '{}' END), 'starttls')
  FROM (SELECT DISTINCT tenant_id FROM keystone.document_setting WHERE key LIKE 'email.%') t
  JOIN keystone.document_setting s ON s.tenant_id = t.tenant_id AND s.key LIKE 'email.%'
 GROUP BY t.tenant_id
ON CONFLICT (tenant_id) DO NOTHING;
DELETE FROM keystone.document_setting WHERE key LIKE 'email.%';
