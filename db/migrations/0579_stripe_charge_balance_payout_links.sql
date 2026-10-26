-- 0579 · PAYOUT ↔ CHARGE LINKAGE FROM STRIPE'S BALANCE TRANSACTIONS (2 Oct 2026, browser check).
--
-- The Payouts screen showed "0 payments" inside both real payouts: the old itemisation
-- (PAYOUT_ITEMISE_FACT) only ever ran over keystone.payout rows, which nothing writes any more (payouts
-- are mirrored into stripe.payouts), and it wrote the link onto keystone.payment, which holds one row.
-- The sync engine has no balance-transaction table, so the charge → payout link, the real Stripe fee, the
-- net and available_on are kept here, filled from Stripe's balance_transactions API by the payout.*
-- webhooks and the nightly reconcile (src/money/payoutLinks.mjs). The views read it; nothing else does.
-- Server-only like the stripe schema: it holds Stripe ids and amounts, tenant scope comes from the join
-- through stripe.charges → stripe_customer_person in payment_effective.

CREATE TABLE IF NOT EXISTS keystone_meta.stripe_charge_balance (
  charge_id        text PRIMARY KEY,
  payout_stripe_id text,
  fee_minor        integer,
  net_minor        integer,
  available_on     date,
  balance_txn_id   text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_charge_balance_payout_idx ON keystone_meta.stripe_charge_balance (payout_stripe_id);
GRANT SELECT, INSERT, UPDATE ON keystone_meta.stripe_charge_balance TO app_rw, app_worker;

-- payout_effective: fee = Mainstay's own figure if it has one, else the sum of the linked charges' fees
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
       COALESCE(kp.fee_minor,
                (SELECT sum(scb.fee_minor)::integer FROM keystone_meta.stripe_charge_balance scb
                  WHERE scb.payout_stripe_id = sp.id))          AS fee_minor,
       kp.itemised_at,
       'stripe'::text                                           AS origin
  FROM stripe.payouts sp
  JOIN keystone.stripe_account sa ON sa.is_platform AND sa.tenant_id = keystone.current_tenant_id()
  LEFT JOIN keystone.payout kp ON kp.stripe_id = sp.id AND kp.tenant_id = sa.tenant_id
UNION ALL
SELECT kp.id, kp.tenant_id, kp.stripe_id, kp.amount_minor, kp.state, NULL::text, kp.created_at,
       kp.updated_at, kp.arrival_date, kp.statement_descriptor, kp.failure_message, kp.method,
       kp.bank_name, kp.bank_last4, kp.fee_minor, kp.itemised_at, 'mainstay'::text
  FROM keystone.payout kp
 WHERE NOT EXISTS (SELECT 1 FROM stripe.payouts sp2 WHERE sp2.id = kp.stripe_id);
GRANT SELECT ON keystone.payout_effective TO app_rw;

CREATE OR REPLACE VIEW keystone.payment_effective
WITH (security_invoker = true) AS
SELECT COALESCE(p.id, md5('charge:' || sc.id)::uuid)                       AS id,
       scp.tenant_id,
       COALESCE(p.invoice_id, inv.id)                                      AS invoice_id,
       scp.person_id                                                       AS payer_user_id,
       sc.amount::integer                                                  AS amount_minor,
       upper(sc.currency)                                                  AS currency,
       CASE WHEN sc.status = 'succeeded' THEN
              CASE WHEN sc.amount > 0 AND COALESCE(sc.amount_refunded,0) >= sc.amount THEN 'refunded'
                   WHEN COALESCE(sc.amount_refunded,0) > 0 THEN 'partially_refunded'
                   ELSE 'succeeded' END
            WHEN sc.status = 'pending' THEN 'pending'
            ELSE 'failed' END                                              AS status,
       COALESCE(sc.payment_intent, sc.id)                                  AS provider_payment_id,
       to_timestamp(sc.created)                                            AS created_at,
       COALESCE(sc.updated_at, to_timestamp(sc.created))                   AS updated_at,
       'stripe'::text                                                      AS provider,
       COALESCE(p.method, 'card')                                          AS method,
       to_timestamp(sc.created)                                            AS received_at,
       p.recorded_by,
       p.note,
       p.application_fee_minor,
       COALESCE(p.stripe_fee_minor, scb.fee_minor)                          AS stripe_fee_minor,
       COALESCE(p.net_minor, scb.net_minor)                                  AS net_minor,
       COALESCE(sc.payment_method_details->'card'->>'brand', p.card_brand) AS card_brand,
       COALESCE(sc.payment_method_details->'card'->>'last4', p.card_last_four) AS card_last_four,
       sc.id                                                               AS stripe_charge_id,
       COALESCE(p.available_on, scb.available_on)                            AS available_on,
       COALESCE(p.payout_id, spo.id)                                          AS payout_id,
       COALESCE(sc.amount_refunded, 0)::integer                            AS refunded_minor,
       'stripe'::text                                                      AS origin
  FROM stripe.charges sc
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = sc.customer
  LEFT JOIN LATERAL (
        SELECT p0.* FROM keystone.payment p0
         WHERE p0.provider = 'stripe'
           AND (p0.stripe_charge_id = sc.id OR p0.provider_payment_id IN (sc.id, sc.payment_intent))
         LIMIT 1) p ON true
  LEFT JOIN keystone_meta.stripe_charge_balance scb ON scb.charge_id = sc.id
  LEFT JOIN keystone.payout_effective spo ON spo.stripe_id = scb.payout_stripe_id
  LEFT JOIN LATERAL (
        SELECT i0.id FROM stripe.invoice_payments ip
          JOIN keystone.invoice i0 ON i0.stripe_invoice_id = ip.invoice
         WHERE ip.payment->>'payment_intent' = sc.payment_intent
         LIMIT 1) inv ON true
UNION ALL
SELECT p.id, p.tenant_id, p.invoice_id, p.payer_user_id, p.amount_minor, p.currency, p.status,
       p.provider_payment_id, p.created_at, p.updated_at, p.provider, p.method, p.received_at,
       p.recorded_by, p.note, p.application_fee_minor, p.stripe_fee_minor, p.net_minor,
       p.card_brand, p.card_last_four, p.stripe_charge_id, p.available_on, p.payout_id,
       COALESCE(p.refunded_minor, 0), 'mainstay'::text
  FROM keystone.payment p
 WHERE NOT (p.provider = 'stripe' AND EXISTS (
        SELECT 1 FROM stripe.charges sc2
          JOIN keystone.stripe_customer_person scp2 ON scp2.customer_id = sc2.customer
         WHERE p.stripe_charge_id = sc2.id OR p.provider_payment_id IN (sc2.id, sc2.payment_intent)));
GRANT SELECT ON keystone.payment_effective TO app_rw;
