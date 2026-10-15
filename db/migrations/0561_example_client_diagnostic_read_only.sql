-- 0561_example_client_diagnostic_read_only
--
-- Section D (the maintainer's reorder, 1 Oct 2026 pasted brief): "Example Client's two paid Stripe invoices
-- (AHHJTSBE-0001/0003) were never recorded in the platform (F828-era bug) — resync read-only from
-- Stripe so he shows paid/$0 owed and the right lifecycle status; then check EVERY person for the
-- same stale-payment gap."
--
-- ★ READ-ONLY — this migration changes NOTHING. It exists only to surface, via the deploy log
--   (RAISE NOTICE), exactly what Example Client's current keystone.app_user/payment/invoice rows
--   look like, since there is no safe, non-superuser path to query production directly from an
--   investigating session tonight (no working admin UI session — F865 — and no app_rw-reaching
--   tunnel available from outside Railway's private network). The real fix migration is written
--   from what this reveals, not guessed at blind.
--
-- Confirmed from Stripe directly (the platform Stripe account, live mode), 2 Oct 2026:
--   Customer cus_EXAMPLE_CLIENT, email client@example.com, name "Example Client".
--   AHHJTSBE-0001 (stripe_id_EXAMPLE): status=paid, amount_paid=$1000.00, paid_at
--     2026-08-08T... (unix 1786411888), metadata EMPTY (created by the pre-Keystone "nexus"
--     contract-billing system, not by the platform's own invoice-creation flow — no
--     keystone_invoice_id to tie it to).
--   AHHJTSBE-0002 (stripe_id_EXAMPLE): status=VOID, amount_paid=$0 — not part of this.
--   AHHJTSBE-0003 (stripe_id_EXAMPLE): status=paid, amount_paid=$900.00, paid_at
--     2026-09-26T... (unix 1790536860), metadata EMPTY, same pre-Keystone origin.
--   A newer DRAFT revision of 0003 (stripe_id_EXAMPLE, amount_due=$900, unpaid) also
--     exists — not yet finalized or sent, flagged for awareness only, not acted on here.

DO $diag$
DECLARE
  v_tenant_id uuid;
  v_user record;
  v_pay record;
  v_inv record;
  v_count int;
BEGIN
  SELECT id INTO v_tenant_id FROM keystone.tenant
    WHERE slug = 'foundry' OR name ILIKE '%example practice%' LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '0561 DIAGNOSTIC: no FOUNDRY tenant found (checked slug=foundry, name ILIKE %%example practice%%)';
    RETURN;
  END IF;
  RAISE NOTICE '0561 DIAGNOSTIC: FOUNDRY tenant_id = %', v_tenant_id;

  SELECT count(*) INTO v_count FROM keystone.app_user
    WHERE tenant_id = v_tenant_id
      AND (email = 'client@example.com' OR stripe_customer_id = 'cus_EXAMPLE_CLIENT'
           OR display_name ILIKE '%michael young%');
  RAISE NOTICE '0561 DIAGNOSTIC: % matching app_user row(s) for Example Client', v_count;

  FOR v_user IN
    SELECT id, display_name, email, stripe_customer_id, lifecycle_status, role, archived_at, created_at
    FROM keystone.app_user
    WHERE tenant_id = v_tenant_id
      AND (email = 'client@example.com' OR stripe_customer_id = 'cus_EXAMPLE_CLIENT'
           OR display_name ILIKE '%michael young%')
  LOOP
    RAISE NOTICE '0561 APP_USER: id=% display_name=% email=% stripe_customer_id=% lifecycle_status=% role=% archived_at=% created_at=%',
      v_user.id, v_user.display_name, v_user.email, v_user.stripe_customer_id, v_user.lifecycle_status,
      v_user.role, v_user.archived_at, v_user.created_at;

    FOR v_pay IN
      SELECT id, invoice_id, provider, provider_payment_id, amount_minor, currency, status, created_at
      FROM keystone.payment WHERE tenant_id = v_tenant_id AND payer_user_id = v_user.id
      ORDER BY created_at
    LOOP
      RAISE NOTICE '0561 PAYMENT: id=% invoice_id=% provider=% provider_payment_id=% amount_minor=% currency=% status=% created_at=%',
        v_pay.id, v_pay.invoice_id, v_pay.provider, v_pay.provider_payment_id, v_pay.amount_minor,
        v_pay.currency, v_pay.status, v_pay.created_at;
    END LOOP;

    FOR v_inv IN
      SELECT id, status, amount_minor, paid_minor, currency, created_at
      FROM keystone.invoice WHERE tenant_id = v_tenant_id AND payer_user_id = v_user.id
      ORDER BY created_at
    LOOP
      RAISE NOTICE '0561 INVOICE: id=% status=% amount_minor=% paid_minor=% currency=% created_at=%',
        v_inv.id, v_inv.status, v_inv.amount_minor, v_inv.paid_minor, v_inv.currency, v_inv.created_at;
    END LOOP;
  END LOOP;

  RAISE NOTICE '0561 DIAGNOSTIC: complete, no rows changed';
END
$diag$;
