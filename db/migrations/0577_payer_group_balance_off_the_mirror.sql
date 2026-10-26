-- 0577_payer_group_balance_off_the_mirror
--
-- specs/STRIPE-MIRROR.md §4 stage (e) — "EVERY MONEY FACT SHOWN ANYWHERE READS FROM THE MIRROR."
-- keystone.payer_group_balance (0360) summed Mainstay's own keystone.invoice.amount_minor over invoices
-- Mainstay's own copy said were 'open'. It now sums Stripe's amount_remaining over the invoices STRIPE
-- says are open, through keystone.invoice_effective (0574) — the same source keystone.person_owes uses,
-- so a group's balance can never disagree with the sum of its members' "Owes".
--
-- ★ SAME OUTPUT COLUMNS AND TYPES (payer_group_id, tenant_id, currency, outstanding_minor bigint,
--   open_invoices bigint) so CREATE OR REPLACE VIEW is legal and every reader (src/money/payerGroups.mjs
--   listPayerGroups / readPayerGroup / getGroupBalance) keeps working unchanged. security_invoker = true
--   exactly as 0360 defined it: the caller's RLS still applies (and invoice_effective re-states
--   tenant + viewer scope on its Stripe-only branch). Existing GRANT SELECT ... TO app_rw is preserved
--   by CREATE OR REPLACE. Additive and idempotent.
-- ★ A Stripe-only open invoice of a group member (created outside Mainstay) is now included — that was
--   the point: the old view could not see it.

CREATE OR REPLACE VIEW keystone.payer_group_balance
WITH (security_invoker = true) AS
SELECT pg.payer_group_id, pg.tenant_id, pg.currency,
       sum(pg.outstanding_minor)::bigint AS outstanding_minor,
       count(DISTINCT pg.invoice_id) AS open_invoices
  FROM (
    SELECT pgm.payer_group_id, ie.tenant_id, ie.currency, ie.id AS invoice_id,
           ie.amount_remaining_minor AS outstanding_minor
      FROM keystone.payer_group_member pgm
      JOIN keystone.invoice_effective ie ON (
        ie.tenant_id = pgm.tenant_id
        AND ie.payer_user_id = pgm.person_id
        AND ie.status = 'open'
      )
     WHERE pgm.person_id IS NOT NULL
  ) pg
 GROUP BY pg.payer_group_id, pg.tenant_id, pg.currency;

GRANT SELECT ON keystone.payer_group_balance TO app_rw;

-- ── Self-check: the view exists, is security_invoker, and now reads from the effective view ─────────
DO $check$
DECLARE d text; inv boolean;
BEGIN
  SELECT pg_get_viewdef('keystone.payer_group_balance'::regclass) INTO d;
  IF d NOT LIKE '%invoice_effective%' THEN
    RAISE EXCEPTION '0577 self-check: payer_group_balance does not read keystone.invoice_effective';
  END IF;
  SELECT coalesce((SELECT 'security_invoker=true' = ANY(c.reloptions)
                     FROM pg_class c WHERE c.oid = 'keystone.payer_group_balance'::regclass), false) INTO inv;
  IF NOT inv THEN
    RAISE EXCEPTION '0577 self-check: payer_group_balance lost security_invoker';
  END IF;
  RAISE NOTICE '0577: payer_group_balance now sums keystone.invoice_effective';
END
$check$;
