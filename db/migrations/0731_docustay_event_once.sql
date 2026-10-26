-- 0731 · Launch step 6 (13 Oct 2026): "this happened once for this workspace" markers for the product's server-side usage events (signup_completed, first_document_sent, demo_converted_to_account, one demo_step
-- per kind of step). The event itself carries no name, no email and no address; this table only remembers that it was already sent so it is never counted twice. Additive and idempotent.

CREATE TABLE IF NOT EXISTS keystone.docustay_event_once (
  tenant_id uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  event_key text        NOT NULL CHECK (length(event_key) BETWEEN 1 AND 80),
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_key)
);
ALTER TABLE keystone.docustay_event_once ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_event_once FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_event_once;
CREATE POLICY tenant_isolation ON keystone.docustay_event_once USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
DROP POLICY IF EXISTS workspace_deletion ON keystone.docustay_event_once;
CREATE POLICY workspace_deletion ON keystone.docustay_event_once FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT ON keystone.docustay_event_once TO app_rw, app_worker;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0731 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
