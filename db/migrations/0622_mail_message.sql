-- 0622 · WHICH ORGANISATION SENT THIS MESSAGE (Batch A). Every email the mail module sends now records its provider message id against the organisation. Why: from Batch A every organisation on the platform default
-- sends from the PRODUCT'S domain (hello@example.com), so a provider webhook's From-domain can no longer tell whose message bounced; the message id can. `mail_message_tenant(id)` is the one pre-context lookup the
-- webhook door uses (a bare uuid, like resolve_webhook_source), and the recorded event then lands on the right organisation.
CREATE TABLE keystone.mail_message (
  provider_message_id text        PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_message_by_tenant ON keystone.mail_message (tenant_id, created_at DESC);
ALTER TABLE keystone.mail_message ENABLE ROW LEVEL SECURITY;      -- ENABLE (not FORCE): the definer lookup below reads it as the table owner
CREATE POLICY tenant_isolation ON keystone.mail_message USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.mail_message FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT ON keystone.mail_message TO app_rw, app_worker;

CREATE FUNCTION keystone.mail_message_tenant(p_message_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.tenant_id FROM keystone.mail_message m WHERE m.provider_message_id = p_message_id
$$;
REVOKE ALL ON FUNCTION keystone.mail_message_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.mail_message_tenant(text) TO app_rw;
