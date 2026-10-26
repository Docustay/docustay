-- 0630 · PART 29 STEP 1 — Docustay billing state and the product as a property of the organisation. Additive and idempotent.
--  · tenant.product            'mainstay' | 'docustay' — which brand an organisation's emails, signing pages and PDFs carry (decision D1). Set when a Docustay workspace is activated.
--  · mainstay_subscription     past_due_since (the FIRST failed payment, cleared on payment — the 14-day grace clock, never shown to anyone), founders_price (anyone who subscribes on or before
--                              31 Dec 2026 keeps their price for life — the flag belongs to the workspace), billing_interval ('month'|'year'), stripe_price_id.
--  · billing_event             the Stripe events already applied to a subscription (event id is the key), so a replayed delivery changes nothing.
ALTER TABLE keystone.tenant ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'mainstay';
DO $$ BEGIN
  ALTER TABLE keystone.tenant ADD CONSTRAINT tenant_product_check CHECK (product IN ('mainstay','docustay'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- a workspace that already is a Docustay workspace (shape 'documents') is a Docustay organisation
UPDATE keystone.tenant SET product = 'docustay' WHERE shape = 'documents' AND product <> 'docustay';

ALTER TABLE keystone.mainstay_subscription ADD COLUMN IF NOT EXISTS past_due_since timestamptz;
ALTER TABLE keystone.mainstay_subscription ADD COLUMN IF NOT EXISTS founders_price boolean NOT NULL DEFAULT false;
ALTER TABLE keystone.mainstay_subscription ADD COLUMN IF NOT EXISTS billing_interval text;
ALTER TABLE keystone.mainstay_subscription ADD COLUMN IF NOT EXISTS stripe_price_id text;
DO $$ BEGIN
  ALTER TABLE keystone.mainstay_subscription ADD CONSTRAINT mainstay_subscription_interval_check CHECK (billing_interval IS NULL OR billing_interval IN ('month','year'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS keystone.billing_event (
  event_id    text PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.billing_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.billing_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.billing_event;
CREATE POLICY tenant_isolation ON keystone.billing_event USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT ON keystone.billing_event TO app_rw;
GRANT SELECT, INSERT ON keystone.billing_event TO app_worker;
