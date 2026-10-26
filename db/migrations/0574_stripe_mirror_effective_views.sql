-- 0574_stripe_mirror_effective_views
--
-- specs/STRIPE-MIRROR.md §4 stage (e) — "EVERY MONEY FACT SHOWN ANYWHERE READS FROM THE MIRROR."
-- One set of views, so no screen/route/email/report writes its own SQL against Mainstay's own
-- duplicated copy of a Stripe fact again. Every reader joins/queries these instead of
-- keystone.invoice.status / keystone.payment.* / keystone.subscription.state / etc.
--
-- ★ WHY VIEWS: [MEASURED 2 Oct 2026, production] the duplication was not only stale, it was
--   INCOMPLETE — Stripe holds 4 charges, Mainstay's keystone.payment held 1; Stripe holds 10
--   subscriptions, keystone.subscription held 0; Michael Young's two paid invoices were never
--   recorded. A per-column COALESCE overlay on Mainstay's tables cannot show a row Mainstay never
--   wrote. So payments, refunds, disputes, credit notes and subscriptions are MIRROR-DRIVEN
--   (Stripe's rows, mapped to a practice/person through `app_user.stripe_customer_id`), with
--   Mainstay-only rows (manual/cash/credit, anything with no Stripe counterpart) unioned in.
--   Invoices stay Mainstay-keyed (Mainstay owns the invoice NUMBER, title, message, reminders)
--   with Stripe's status/amounts/paid-at overriding, plus Stripe-only finalized invoices of a known
--   person unioned in.
-- ★ `security_invoker = true` on every view: the CALLER's RLS on keystone.* still applies exactly as
--   it did when the readers queried the base tables (tenant isolation, per-coach `user_may` scope).
--   The mirror rows carry no tenant of their own, so tenant + viewer scope is re-stated explicitly
--   on every mirror-driven branch (`stripe_customer_person` below) — copied from the invoice/payment
--   `tenant_isolation` policies (0196), including the no-viewer worker carve-out.
-- ★ Mainstay's own columns stay (EXPAND, not CONTRACT — CLAUDE.md migration discipline) as a cache
--   the webhook handlers still write; no reader is allowed to trust them over these views.

-- ── 0 · customer → person mapping, the ONE place tenant + viewer scope is decided for mirror rows ──
CREATE OR REPLACE VIEW keystone.stripe_customer_person
WITH (security_invoker = true) AS
SELECT DISTINCT ON (u.stripe_customer_id)
       u.stripe_customer_id AS customer_id,
       u.id                 AS person_id,
       u.tenant_id,
       u.owner_user_id,
       u.display_name
  FROM keystone.app_user u
 WHERE u.stripe_customer_id IS NOT NULL
   AND u.tenant_id = keystone.current_tenant_id()
   AND (   keystone.current_user_id() IS NULL
        OR u.id = keystone.current_user_id()
        OR keystone.user_may(keystone.current_user_id(), 'invoice', 'view', u.owner_user_id))
 ORDER BY u.stripe_customer_id, (u.archived_at IS NULL) DESC, u.created_at;

COMMENT ON VIEW keystone.stripe_customer_person IS
  'Which person (and so which practice) a Stripe customer id belongs to, scoped to the current tenant and viewer. Every mirror-driven *_effective view joins through this — the stripe schema itself has no tenant.';

-- ── 1 · INVOICES — Mainstay-keyed, Stripe wins on status/amounts/paid-at ──────────────────────────
CREATE OR REPLACE VIEW keystone.invoice_effective
WITH (security_invoker = true) AS
SELECT i.id,
       i.tenant_id,
       i.payer_user_id,
       i.invoice_number,
       CASE WHEN si.id IS NULL THEN i.status
            WHEN si.status::text = 'deleted' THEN 'void'
            ELSE si.status::text END                                   AS status,
       COALESCE(si.total, i.amount_minor)::integer                      AS amount_minor,
       COALESCE(si.amount_paid, i.paid_minor, 0)::integer               AS paid_minor,
       COALESCE(si.amount_remaining::integer, i.amount_remaining_minor,
                GREATEST(i.amount_minor - COALESCE(i.paid_minor, 0), 0)) AS amount_remaining_minor,
       i.currency,
       CASE WHEN si.id IS NULL THEN i.paid_at
            ELSE to_timestamp(NULLIF(si.status_transitions->>'paid_at','')::bigint) END    AS paid_at,
       CASE WHEN si.id IS NULL THEN i.voided_at
            ELSE to_timestamp(NULLIF(si.status_transitions->>'voided_at','')::bigint) END  AS voided_at,
       COALESCE(si.hosted_invoice_url, i.hosted_invoice_url)            AS hosted_invoice_url,
       COALESCE(si.invoice_pdf, i.invoice_pdf_url)                      AS invoice_pdf_url,
       si.number                                                        AS stripe_number,
       i.stripe_invoice_id,
       (si.id IS NOT NULL)                                              AS mirror_linked,
       si.last_synced_at                                                AS mirror_synced_at,
       'mainstay'::text                                                 AS origin
  FROM keystone.invoice i
  LEFT JOIN stripe.invoices si ON si.id = i.stripe_invoice_id
UNION ALL
-- Stripe-only invoices of a KNOWN person (created outside Mainstay, or never recorded by it).
-- Drafts are excluded: a Stripe draft is staging, not an invoice anyone owes or was sent.
SELECT md5('invoice:' || si.id)::uuid,
       scp.tenant_id,
       scp.person_id,
       si.number,
       CASE WHEN si.status::text = 'deleted' THEN 'void' ELSE si.status::text END,
       si.total::integer,
       COALESCE(si.amount_paid, 0)::integer,
       COALESCE(si.amount_remaining, 0)::integer,
       upper(si.currency),
       to_timestamp(NULLIF(si.status_transitions->>'paid_at','')::bigint),
       to_timestamp(NULLIF(si.status_transitions->>'voided_at','')::bigint),
       si.hosted_invoice_url,
       si.invoice_pdf,
       si.number,
       si.id,
       true,
       si.last_synced_at,
       'stripe'::text
  FROM stripe.invoices si
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = si.customer
 WHERE si.status::text <> 'draft'
   AND NOT EXISTS (SELECT 1 FROM keystone.invoice i2 WHERE i2.stripe_invoice_id = si.id);

COMMENT ON VIEW keystone.invoice_effective IS
  'Invoice status/amounts/paid-at as STRIPE says them (mirror), keyed by Mainstay''s own invoice id; Stripe-only finalized invoices of a known person unioned in (origin=stripe).';

-- ── 2 · OWES — the ONE balance computation (replaces four hand-written copies) ─────────────────────
CREATE OR REPLACE VIEW keystone.person_owes
WITH (security_invoker = true) AS
SELECT ie.tenant_id,
       ie.payer_user_id AS person_id,
       COALESCE(SUM(ie.amount_remaining_minor), 0)::integer AS owes_minor,
       MIN(ie.currency)                                     AS currency,
       COUNT(*)::integer                                    AS open_count
  FROM keystone.invoice_effective ie
 WHERE ie.status = 'open'
 GROUP BY ie.tenant_id, ie.payer_user_id;

COMMENT ON VIEW keystone.person_owes IS
  'What a person owes = sum of Stripe''s amount_remaining over invoices Stripe says are OPEN. Void/draft/paid/uncollectible never count. The only owes computation in the product.';

-- ── 3 · PAYMENTS — mirror-driven (stripe.charges), Mainstay-only rows unioned ─────────────────────
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
       p.stripe_fee_minor,
       p.net_minor,
       COALESCE(sc.payment_method_details->'card'->>'brand', p.card_brand) AS card_brand,
       COALESCE(sc.payment_method_details->'card'->>'last4', p.card_last_four) AS card_last_four,
       sc.id                                                               AS stripe_charge_id,
       p.available_on,
       p.payout_id,
       COALESCE(sc.amount_refunded, 0)::integer                            AS refunded_minor,
       'stripe'::text                                                      AS origin
  FROM stripe.charges sc
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = sc.customer
  LEFT JOIN LATERAL (
        SELECT p0.* FROM keystone.payment p0
         WHERE p0.provider = 'stripe'
           AND (p0.stripe_charge_id = sc.id OR p0.provider_payment_id IN (sc.id, sc.payment_intent))
         LIMIT 1) p ON true
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

COMMENT ON VIEW keystone.payment_effective IS
  'Payments as STRIPE says them (stripe.charges of a known person, linked to Mainstay''s payment row/invoice where one exists) plus Mainstay-only payments (manual, credit). origin says which.';

-- ── 4 · REFUNDS ────────────────────────────────────────────────────────────────────────────────────
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
UNION ALL
SELECT rr.id, rr.tenant_id, rr.stripe_id, rr.amount_minor, rr.state, rr.created_at, rr.updated_at,
       rr.stripe_charge_id, rr.payment_id, rr.reason, 'mainstay'::text
  FROM keystone.refund rr
 WHERE NOT EXISTS (SELECT 1 FROM stripe.refunds r2 WHERE r2.id = rr.stripe_id);

-- ── 5 · DISPUTES ───────────────────────────────────────────────────────────────────────────────────
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
UNION ALL
SELECT kd.id, kd.tenant_id, kd.stripe_id, kd.amount_minor, kd.state, NULL::text, kd.created_at,
       kd.updated_at, kd.stripe_charge_id, kd.reason, kd.evidence_due_by, kd.evidence_submitted_at,
       kd.payment_id, kd.fee_minor, 'mainstay'::text
  FROM keystone.dispute kd
 WHERE NOT EXISTS (SELECT 1 FROM stripe.disputes d2 WHERE d2.id = kd.stripe_id);

-- ── 6 · CREDIT NOTES ───────────────────────────────────────────────────────────────────────────────
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
UNION ALL
SELECT kc.id, kc.tenant_id, kc.invoice_id, kc.stripe_credit_note_id, kc.number_ours, kc.status,
       kc.reason, kc.memo, kc.subtotal_minor, kc.tax_minor, kc.total_minor, kc.destination,
       kc.refund_id, kc.pdf_url, kc.created_at, kc.effective_at, kc.voided_at, 'mainstay'::text
  FROM keystone.credit_note kc
 WHERE NOT EXISTS (SELECT 1 FROM stripe.credit_notes c2 WHERE c2.id = kc.stripe_credit_note_id);

-- ── 7 · SUBSCRIPTIONS — mirror-driven ──────────────────────────────────────────────────────────────
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
UNION ALL
SELECT ks.id, ks.tenant_id, ks.app_user_id, ks.plan_id, ks.state, NULL::text, ks.started_on,
       ks.cancelled_on, ks.current_period_start, ks.current_period_end, ks.cancel_at_period_end,
       COALESCE(ks.price_minor_override, ks.snapshot_amount_minor), 'USD', ks.stripe_subscription_id,
       ks.stripe_price_id, ks.failing_stripe_invoice_id, ks.payment_method_id, ks.contract_id,
       ks.paused_at, ks.resume_on, ks.failed_attempts, ks.next_retry_at, ks.archived_at,
       ks.created_at, ks.updated_at, 'mainstay'::text
  FROM keystone.subscription ks
 WHERE ks.stripe_subscription_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM stripe.subscriptions s2 WHERE s2.id = ks.stripe_subscription_id);

-- ── 8 · SAVED CARDS — one source for every screen that shows a card ────────────────────────────────
CREATE OR REPLACE VIEW keystone.person_card_effective
WITH (security_invoker = true) AS
SELECT md5('pm:' || pm.id)::uuid                                           AS id,
       scp.tenant_id,
       scp.person_id                                                       AS app_user_id,
       pm.id                                                               AS provider_payment_method_id,
       pm.type                                                             AS kind,
       pm.card->>'brand'                                                   AS brand,
       pm.card->>'last4'                                                   AS last_four,
       NULLIF(pm.card->>'exp_month','')::smallint                          AS exp_month,
       NULLIF(pm.card->>'exp_year','')::smallint                           AS exp_year,
       (pm.id = c.invoice_settings->>'default_payment_method')             AS is_default,
       to_timestamp(pm.created)                                            AS created_at,
       'stripe'::text                                                      AS origin
  FROM stripe.payment_methods pm
  JOIN stripe.customers c ON c.id = pm.customer
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = pm.customer
UNION ALL
-- Mainstay-only cards (a person with no Stripe customer, or none of whose cards are mirrored yet).
SELECT k.id, k.tenant_id, k.app_user_id, k.provider_payment_method_id, k.kind, k.brand, k.last_four,
       k.exp_month, k.exp_year, k.is_default, k.created_at, 'mainstay'::text
  FROM keystone.payment_method k
 WHERE k.detached_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM keystone.app_user u2
          JOIN stripe.payment_methods pm2 ON pm2.customer = u2.stripe_customer_id
         WHERE u2.id = k.app_user_id AND u2.stripe_customer_id IS NOT NULL);

-- ── Grants: readers are app_rw (request pool) and app_owner (definer functions/reports) ────────────
GRANT SELECT ON keystone.stripe_customer_person, keystone.invoice_effective, keystone.person_owes,
                keystone.payment_effective, keystone.refund_effective, keystone.dispute_effective,
                keystone.credit_note_effective, keystone.subscription_effective,
                keystone.person_card_effective TO app_rw;

-- ── Self-check ─────────────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pg_views WHERE schemaname = 'keystone'
   AND viewname IN ('stripe_customer_person','invoice_effective','person_owes','payment_effective',
                    'refund_effective','dispute_effective','credit_note_effective',
                    'subscription_effective','person_card_effective');
  IF v <> 9 THEN RAISE EXCEPTION '0574 self-check: expected 9 views, found %', v; END IF;
  RAISE NOTICE '0574: 9 effective views created';
END
$check$;
