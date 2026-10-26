-- 0735 · Billing audit (13 Oct 2026, after the $1 live test): the consent and cancellation record for a Docustay subscription. California's automatic-renewal law (AB 2863) asks the seller to keep proof of
-- the person's express consent to the renewal terms, and of a cancellation, for three years. One append-only row per fact: `renewal_terms_accepted` (the person agreed at checkout), `cancel_intent`
-- (the cancel page was opened and the confirm step issued, so a stray click can never cancel), `cancel_confirmed`, `resumed`. Additive and idempotent; no row is ever updated or deleted except with the whole workspace.

CREATE TABLE IF NOT EXISTS keystone.docustay_billing_record (
  id                     uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id              uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  kind                   text        NOT NULL CHECK (kind IN ('renewal_terms_accepted', 'cancel_intent', 'cancel_confirmed', 'resumed')),
  at                     timestamptz NOT NULL DEFAULT now(),
  actor_user_id          uuid        NULL,
  stripe_subscription_id text        NULL,
  detail                 jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS docustay_billing_record_lookup ON keystone.docustay_billing_record (tenant_id, kind, at DESC);
ALTER TABLE keystone.docustay_billing_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_billing_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_billing_record;
CREATE POLICY tenant_isolation ON keystone.docustay_billing_record USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
DROP POLICY IF EXISTS workspace_deletion ON keystone.docustay_billing_record;
CREATE POLICY workspace_deletion ON keystone.docustay_billing_record FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT ON keystone.docustay_billing_record TO app_rw, app_worker;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0735 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
