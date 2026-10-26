-- 0575_stripe_account_map_payout_view_resync_link
--
-- specs/STRIPE-MIRROR.md §4 stage (e) — three things the effective views (0574) need next to them:
--
-- 1 · `keystone.stripe_account` — WHICH PRACTICE OWNS WHICH STRIPE ACCOUNT. Account-level Stripe
--     objects (payouts, balance) carry no customer, so there is no person to map them through the way
--     charges/invoices/subscriptions are. This table is also the first piece of the privacy plan in
--     specs/QUEUE.md ("BLOCKER BEFORE ANY SECOND PRACTICE"): the platform's own account (FOUNDRY today)
--     is a row with is_platform = true; an Express-connected practice later gets its own row, and
--     every account-level mirror read filters through it.
-- 2 · `keystone.payout_effective` — payouts as Stripe says them (stripe.payouts, which this work now
--     populates itself: the sync engine has no payout support), keyed to the practice through (1),
--     with Workbench's own itemisation facts (itemised_at) left-joined from keystone.payout.
-- 3 · Link the synthetic payment row migration 0565 invented for AHHJTSBE-0003 (provider_payment_id
--     'resync_0565_…') to the REAL Stripe charge it stands for. [MEASURED against production] Stripe
--     holds charge stripe_id_EXAMPLE ($900, stripe_id_EXAMPLE); without the link
--     payment_effective shows that $900 twice (once from the mirror, once as 0565's stand-in).
--     Corrects Workbench's own record only — no Stripe call, no money moved. Same named exception
--     0565 itself used for this exact client (protected_real_client, migration 0500).

CREATE TABLE IF NOT EXISTS keystone.stripe_account (
  stripe_account_id text PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES keystone.tenant(id),
  is_platform       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stripe_account_one_platform
  ON keystone.stripe_account ((true)) WHERE is_platform;
ALTER TABLE keystone.stripe_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.stripe_account FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.stripe_account;
CREATE POLICY tenant_isolation ON keystone.stripe_account
  USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT ON keystone.stripe_account TO app_rw;

-- Seed: FOUNDRY is the platform's own main account (CLAUDE.md, 29 Sep 2026 ruling) — NOT a connected
-- account. Tolerant of a database with no FOUNDRY tenant (fresh/test databases).
DO $seed$
DECLARE v_tenant uuid;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('foundry') INTO v_tenant;
  IF v_tenant IS NULL THEN
    RAISE NOTICE '0575: no tenant with slug foundry — stripe_account not seeded (fresh/test database)';
  ELSE
    PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
    INSERT INTO keystone.stripe_account (stripe_account_id, tenant_id, is_platform)
    VALUES ('acct_EXAMPLE_PLATFORM', v_tenant, true)
    ON CONFLICT (stripe_account_id) DO NOTHING;
    -- Express-connected practices: one row each, from the existing mapping.
    INSERT INTO keystone.stripe_account (stripe_account_id, tenant_id, is_platform)
    SELECT ca.stripe_account_id, ca.tenant_id, false FROM keystone.connect_account ca
     WHERE ca.stripe_account_id IS NOT NULL AND ca.tenant_id = v_tenant
    ON CONFLICT (stripe_account_id) DO NOTHING;
  END IF;
END
$seed$;

CREATE OR REPLACE VIEW keystone.payout_effective
WITH (security_invoker = true) AS
SELECT COALESCE(kp.id, md5('payout:' || sp.id)::uuid)           AS id,
       sa.tenant_id,
       sp.id                                                    AS stripe_id,
       sp.amount::integer                                       AS amount_minor,
       CASE sp.status WHEN 'paid' THEN 'paid' WHEN 'in_transit' THEN 'in_transit'
                      WHEN 'failed' THEN 'failed' WHEN 'canceled' THEN 'cancelled'
                      ELSE 'pending' END                        AS state,
       sp.status                                                AS stripe_status,
       to_timestamp(sp.created)                                 AS created_at,
       COALESCE(sp.updated_at, to_timestamp(sp.created))        AS updated_at,
       to_timestamp(NULLIF(sp.arrival_date,'')::bigint)::date   AS arrival_date,
       sp.statement_descriptor,
       sp.failure_message,
       sp.method,
       COALESCE(sp.bank_account->>'bank_name', kp.bank_name)    AS bank_name,
       COALESCE(sp.bank_account->>'last4', kp.bank_last4)       AS bank_last4,
       kp.fee_minor,
       kp.itemised_at,
       'stripe'::text                                           AS origin
  FROM stripe.payouts sp
  JOIN keystone.stripe_account sa ON sa.is_platform AND sa.tenant_id = keystone.current_tenant_id()
  LEFT JOIN keystone.payout kp ON kp.stripe_id = sp.id AND kp.tenant_id = sa.tenant_id
UNION ALL
SELECT kp.id, kp.tenant_id, kp.stripe_id, kp.amount_minor, kp.state, NULL::text, kp.created_at,
       kp.updated_at, kp.arrival_date, kp.statement_descriptor, kp.failure_message, kp.method,
       kp.bank_name, kp.bank_last4, kp.fee_minor, kp.itemised_at, 'workbench'::text
  FROM keystone.payout kp
 WHERE NOT EXISTS (SELECT 1 FROM stripe.payouts sp2 WHERE sp2.id = kp.stripe_id);
GRANT SELECT ON keystone.payout_effective TO app_rw;

-- 3 · the 0565 stand-in payment -> the real charge
DO $link$
DECLARE
  v_tenant uuid;
  v_person uuid := '01a0dc5b-b4b8-71f2-a0dd-09ee06ea9733';   -- Example Client
  v_updated int;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('foundry') INTO v_tenant;
  IF v_tenant IS NULL THEN
    RAISE NOTICE '0575: no tenant with slug foundry — nothing to link';
    RETURN;
  END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  PERFORM set_config('keystone.user_id', v_person::text, true);
  PERFORM set_config('keystone.protected_write_reason',
    '0575: link 0565''s stand-in payment to the real Stripe charge stripe_id_EXAMPLE so the mirror does not show the same $900 twice; Workbench''s own record only, no Stripe call, no money moved.',
    true);
  UPDATE keystone.payment
     SET stripe_charge_id    = 'stripe_id_EXAMPLE',
         provider_payment_id = 'stripe_id_EXAMPLE',
         updated_at          = now()
   WHERE tenant_id = v_tenant
     AND provider_payment_id = 'resync_0565_stripe_id_EXAMPLE'
     AND amount_minor = 90000;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  PERFORM set_config('keystone.protected_write_reason', '', true);
  RAISE NOTICE '0575: linked % stand-in payment row(s) to the real charge', v_updated;
END
$link$;

DO $check$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pg_views WHERE schemaname='keystone' AND viewname='payout_effective';
  IF v <> 1 THEN RAISE EXCEPTION '0575 self-check: payout_effective missing'; END IF;
END
$check$;
