-- 0582 · "REMOVE FROM PLATFORM'S VIEW ONLY" (QUEUE §3 A, the maintainer's Stripe rules for the shared Delete).
--
-- Payments, refunds, credit notes, disputes, payouts and subscriptions are STRIPE's records; the platform mirrors them
-- (keystone.*_effective unions the mirror with the platform's own rows). Deleting one from the platform must NOT touch
-- Stripe and must not come back on the next webhook — so the shared delete writes a tombstone here and the Stripe
-- branch of each effective view skips tombstoned objects. the platform's own row (if any) is deleted for real.
-- Server-side only: written by src/records/delete.mjs, read by the views (security_invoker, tenant-scoped).

CREATE TABLE IF NOT EXISTS keystone.stripe_hidden (
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  stripe_id  text        NOT NULL,
  kind       text        NOT NULL,
  hidden_by  uuid,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, stripe_id)
);
ALTER TABLE keystone.stripe_hidden ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.stripe_hidden FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.stripe_hidden
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, DELETE ON keystone.stripe_hidden TO app_rw;

CREATE OR REPLACE VIEW keystone.refund_effective
WITH (security_invoker = true) AS
SELECT COALESCE(rr.id, md5('refund:' || r.id)::uuid)  AS id,
       scp.tenant_id,
       r.id                                           AS stripe_id,
       r.amount::integer                              AS amount_minor,
       CASE r.status WHEN 'succeeded' THEN 'succeeded' WHEN 'pending' THEN 'pending'
                     WHEN 'requires_action' THEN 'pending'
                     WHEN 'canceled' THEN 'canceled' ELSE 'failed' END AS state,
       to_timestamp(r.created)                        AS created_at,
       COALESCE(r.updated_at, to_timestamp(r.created)) AS updated_at,
       r.charge                                       AS stripe_charge_id,
       pe.id                                          AS payment_id,
       r.reason,
       'stripe'::text                                 AS origin
  FROM stripe.refunds r
  JOIN stripe.charges sc ON sc.id = r.charge
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = sc.customer
  LEFT JOIN keystone.refund rr ON rr.stripe_id = r.id
  LEFT JOIN keystone.payment_effective pe ON pe.stripe_charge_id = r.charge
 WHERE NOT EXISTS (SELECT 1 FROM keystone.stripe_hidden h WHERE h.tenant_id = scp.tenant_id AND h.stripe_id = r.id)
UNION ALL
SELECT rr.id, rr.tenant_id, rr.stripe_id, rr.amount_minor, rr.state, rr.created_at, rr.updated_at,
       rr.stripe_charge_id, rr.payment_id, rr.reason, 'workbench'::text
  FROM keystone.refund rr
 WHERE NOT EXISTS (SELECT 1 FROM stripe.refunds r2 WHERE r2.id = rr.stripe_id);
GRANT SELECT ON keystone.refund_effective TO app_rw;

CREATE OR REPLACE VIEW keystone.dispute_effective
WITH (security_invoker = true) AS
SELECT COALESCE(kd.id, md5('dispute:' || d.id)::uuid) AS id,
       scp.tenant_id,
       d.id                                           AS stripe_id,
       d.amount::integer                              AS amount_minor,
       CASE d.status
            WHEN 'won' THEN 'won'
            WHEN 'lost' THEN 'lost'
            WHEN 'charge_refunded' THEN 'won'
            WHEN 'warning_closed' THEN 'won'
            WHEN 'warning_needs_response' THEN 'warning_under_review'
            WHEN 'warning_under_review' THEN 'warning_under_review'
            WHEN 'needs_response' THEN 'under_review'
            WHEN 'under_review' THEN 'under_review'
            ELSE COALESCE(kd.state, 'under_review') END AS state,
       d.status                                       AS stripe_status,
       to_timestamp(d.created)                        AS created_at,
       COALESCE(d.updated_at, to_timestamp(d.created)) AS updated_at,
       d.charge                                       AS stripe_charge_id,
       d.reason,
       to_timestamp(NULLIF(d.evidence_details->>'due_by','')::bigint)  AS evidence_due_by,
       kd.evidence_submitted_at,
       pe.id                                          AS payment_id,
       kd.fee_minor,
       'stripe'::text                                 AS origin
  FROM stripe.disputes d
  JOIN stripe.charges sc ON sc.id = d.charge
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = sc.customer
  LEFT JOIN keystone.dispute kd ON kd.stripe_id = d.id
  LEFT JOIN keystone.payment_effective pe ON pe.stripe_charge_id = d.charge
 WHERE NOT EXISTS (SELECT 1 FROM keystone.stripe_hidden h WHERE h.tenant_id = scp.tenant_id AND h.stripe_id = d.id)
UNION ALL
SELECT kd.id, kd.tenant_id, kd.stripe_id, kd.amount_minor, kd.state, NULL::text, kd.created_at,
       kd.updated_at, kd.stripe_charge_id, kd.reason, kd.evidence_due_by, kd.evidence_submitted_at,
       kd.payment_id, kd.fee_minor, 'workbench'::text
  FROM keystone.dispute kd
 WHERE NOT EXISTS (SELECT 1 FROM stripe.disputes d2 WHERE d2.id = kd.stripe_id);
GRANT SELECT ON keystone.dispute_effective TO app_rw;

CREATE OR REPLACE VIEW keystone.credit_note_effective
WITH (security_invoker = true) AS
SELECT COALESCE(kc.id, md5('creditnote:' || cn.id)::uuid) AS id,
       scp.tenant_id,
       COALESCE(kc.invoice_id, ie.id)                AS invoice_id,
       cn.id                                         AS stripe_credit_note_id,
       COALESCE(cn.number, kc.number_ours)           AS number,
       CASE WHEN cn.status = 'void' THEN 'void' ELSE 'issued' END AS status,
       cn.reason,
       cn.memo,
       cn.subtotal::integer                          AS subtotal_minor,
       COALESCE(cn.total,0)::integer - COALESCE(cn.subtotal,0)::integer AS tax_minor,
       cn.total::integer                             AS total_minor,
       kc.destination,
       kc.refund_id,
       cn.pdf                                        AS pdf_url,
       to_timestamp(cn.created)                      AS created_at,
       kc.effective_at,
       CASE WHEN cn.status = 'void' THEN COALESCE(kc.voided_at, now()) END AS voided_at,
       'stripe'::text                                AS origin
  FROM stripe.credit_notes cn
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = cn.customer
  LEFT JOIN keystone.credit_note kc ON kc.stripe_credit_note_id = cn.id
  LEFT JOIN keystone.invoice ie ON ie.stripe_invoice_id = cn.invoice
 WHERE NOT EXISTS (SELECT 1 FROM keystone.stripe_hidden h WHERE h.tenant_id = scp.tenant_id AND h.stripe_id = cn.id)
UNION ALL
SELECT kc.id, kc.tenant_id, kc.invoice_id, kc.stripe_credit_note_id, kc.number_ours, kc.status,
       kc.reason, kc.memo, kc.subtotal_minor, kc.tax_minor, kc.total_minor, kc.destination,
       kc.refund_id, kc.pdf_url, kc.created_at, kc.effective_at, kc.voided_at, 'workbench'::text
  FROM keystone.credit_note kc
 WHERE NOT EXISTS (SELECT 1 FROM stripe.credit_notes c2 WHERE c2.id = kc.stripe_credit_note_id);
GRANT SELECT ON keystone.credit_note_effective TO app_rw;

CREATE OR REPLACE VIEW keystone.subscription_effective
WITH (security_invoker = true) AS
SELECT COALESCE(ks.id, md5('subscription:' || s.id)::uuid)                 AS id,
       scp.tenant_id,
       scp.person_id                                                       AS app_user_id,
       ks.plan_id,
       CASE WHEN s.status::text IN ('canceled','incomplete_expired') THEN 'cancelled'
            WHEN s.status::text IN ('past_due','unpaid','incomplete') THEN 'past_due'
            WHEN s.status::text = 'paused' OR s.pause_collection IS NOT NULL THEN 'paused'
            ELSE 'active' END                                              AS state,
       s.status::text                                                      AS stripe_status,
       to_timestamp(s.start_date)::date                                    AS started_on,
       CASE WHEN s.status::text IN ('canceled','incomplete_expired')
            THEN to_timestamp(COALESCE(s.ended_at, s.canceled_at, s.created))::date END AS cancelled_on,
       to_timestamp(COALESCE(s.current_period_start,
                    NULLIF(s.items->'data'->0->>'current_period_start','')::bigint)) AS current_period_start,
       to_timestamp(COALESCE(s.current_period_end,
                    NULLIF(s.items->'data'->0->>'current_period_end','')::bigint))   AS current_period_end,
       s.cancel_at_period_end,
       COALESCE((s.items->'data'->0->'price'->>'unit_amount')::integer * COALESCE((s.items->'data'->0->>'quantity')::integer, 1),
                (pj.plan->>'amount')::integer, ks.snapshot_amount_minor)    AS snapshot_amount_minor,
       upper(COALESCE(s.items->'data'->0->'price'->>'currency', pj.plan->>'currency', 'usd')) AS currency,
       s.id                                                                AS stripe_subscription_id,
       COALESCE(s.items->'data'->0->'price'->>'id', pj.plan->>'id', ks.stripe_price_id) AS stripe_price_id,
       s.latest_invoice                                                    AS latest_stripe_invoice_id,
       ks.payment_method_id,
       ks.contract_id,
       ks.paused_at,
       ks.resume_on,
       ks.failed_attempts,
       ks.next_retry_at,
       ks.archived_at,
       to_timestamp(s.created)                                             AS created_at,
       COALESCE(s.updated_at, to_timestamp(s.created))                     AS updated_at,
       'stripe'::text                                                      AS origin
  FROM stripe.subscriptions s
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = s.customer
  CROSS JOIN LATERAL (SELECT CASE WHEN s.plan LIKE '{%' THEN s.plan::jsonb END AS plan) pj
  LEFT JOIN keystone.subscription ks ON ks.stripe_subscription_id = s.id
 WHERE NOT EXISTS (SELECT 1 FROM keystone.stripe_hidden h WHERE h.tenant_id = scp.tenant_id AND h.stripe_id = s.id)
UNION ALL
SELECT ks.id, ks.tenant_id, ks.app_user_id, ks.plan_id, ks.state, NULL::text, ks.started_on,
       ks.cancelled_on, ks.current_period_start, ks.current_period_end, ks.cancel_at_period_end,
       COALESCE(ks.price_minor_override, ks.snapshot_amount_minor), 'USD', ks.stripe_subscription_id,
       ks.stripe_price_id, ks.failing_stripe_invoice_id, ks.payment_method_id, ks.contract_id,
       ks.paused_at, ks.resume_on, ks.failed_attempts, ks.next_retry_at, ks.archived_at,
       ks.created_at, ks.updated_at, 'workbench'::text
  FROM keystone.subscription ks
 WHERE ks.stripe_subscription_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM stripe.subscriptions s2 WHERE s2.id = ks.stripe_subscription_id);
GRANT SELECT ON keystone.subscription_effective TO app_rw;

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
 WHERE NOT EXISTS (SELECT 1 FROM keystone.stripe_hidden h WHERE h.tenant_id = scp.tenant_id AND h.stripe_id = sc.id)
UNION ALL
SELECT p.id, p.tenant_id, p.invoice_id, p.payer_user_id, p.amount_minor, p.currency, p.status,
       p.provider_payment_id, p.created_at, p.updated_at, p.provider, p.method, p.received_at,
       p.recorded_by, p.note, p.application_fee_minor, p.stripe_fee_minor, p.net_minor,
       p.card_brand, p.card_last_four, p.stripe_charge_id, p.available_on, p.payout_id,
       COALESCE(p.refunded_minor, 0), 'workbench'::text
  FROM keystone.payment p
 WHERE NOT (p.provider = 'stripe' AND EXISTS (
        SELECT 1 FROM stripe.charges sc2
          JOIN keystone.stripe_customer_person scp2 ON scp2.customer_id = sc2.customer
         WHERE p.stripe_charge_id = sc2.id OR p.provider_payment_id IN (sc2.id, sc2.payment_intent)));
GRANT SELECT ON keystone.payment_effective TO app_rw;

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
 WHERE NOT EXISTS (SELECT 1 FROM keystone.stripe_hidden h WHERE h.tenant_id = sa.tenant_id AND h.stripe_id = sp.id)
UNION ALL
SELECT kp.id, kp.tenant_id, kp.stripe_id, kp.amount_minor, kp.state, NULL::text, kp.created_at,
       kp.updated_at, kp.arrival_date, kp.statement_descriptor, kp.failure_message, kp.method,
       kp.bank_name, kp.bank_last4, kp.fee_minor, kp.itemised_at, 'workbench'::text
  FROM keystone.payout kp
 WHERE NOT EXISTS (SELECT 1 FROM stripe.payouts sp2 WHERE sp2.id = kp.stripe_id);
GRANT SELECT ON keystone.payout_effective TO app_rw;
