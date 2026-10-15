-- 0599 · AN ORGANISATION SENDS ITS OWN DOCUMENT EMAIL (QUEUE §23.3.4, the maintainer 3 Oct 2026; research §7.2). The island's own tables — the host never names them:
--   · `document_email_domain` — the one sending domain a practice has asked to use, its verification state and the DNS records to add (status: pending → verified | failed);
--   · `document_secret`       — encrypted secrets the island holds for a practice (today the SMTP password), as envelopes sealed by the host's secrets port (purpose `document_smtp_password`);
--   · `document_party.email_message_id / email_delivery` — which provider message carried each person's invitation, and what became of it (delivered · bounced · complained);
--   · the audit trail gains `delivered`, `bounced`, `complained` so a bounce puts the document in "fix the address".
-- Additive. Row-level security FORCED.
CREATE TABLE keystone.document_email_domain (
  tenant_id    uuid        PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  domain       text        NOT NULL CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  provider_ref text        NULL,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed')),
  records      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_error   text        NULL,
  verified_at  timestamptz NULL,
  checked_at   timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.document_email_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_email_domain FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_email_domain USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_email_domain FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_email_domain FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_email_domain FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_email_domain TO app_rw;
GRANT SELECT ON keystone.document_email_domain TO app_worker;

CREATE TABLE keystone.document_secret (
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
ALTER TABLE keystone.document_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_secret FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_secret USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_secret FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_secret FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.document_secret FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.document_secret TO app_rw;
GRANT SELECT, UPDATE ON keystone.document_secret TO app_worker;     -- the KEK rewrap job re-seals envelopes

ALTER TABLE keystone.document_party
  ADD COLUMN email_message_id text NULL,
  ADD COLUMN email_delivery   text NULL CHECK (email_delivery IN ('delivered','bounced','complained'));
CREATE INDEX document_party_by_message ON keystone.document_party (tenant_id, email_message_id) WHERE email_message_id IS NOT NULL;

ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD CONSTRAINT document_audit_event_kind_check
  CHECK (kind IN ('opened', 'link_clicked', 'verified', 'signed', 'sent', 'declined', 'executed', 'consented', 'delivered', 'bounced', 'complained'));
