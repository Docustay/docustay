-- 0490 — AN INVOICE LIVES IN STRIPE (Stage 20 Task 20.60)
--
-- ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES.
-- When sendInvoice() succeeds, we create a Stripe Invoice on the connected account:
--   - metadata carries our invoice_id, practice_id, person_id, account_id via metadataFor()
--   - lines are sent with price data snapshots so Stripe has what was priced
--   - our invoice_number is NOT sent as Stripe's number (ours renders via custom_fields/description)
--   - collection_method defaults to send_invoice per 20.63's default
--   - auto_advance is false (we control the state, not Stripe)
--   - finalization error → stored verbatim, surfaced to editor
--
-- Void our invoice also voids Stripe's when stripe_invoice_id present.
-- The PDF is mirrored; our route returns 302 to the mirrored URL.
-- Currency change on a draft with lines → 409 unless confirm:true, which deletes the draft's lines atomically.
-- movesMoney: false on create and finalize (no charge happens here; 20.65 adds collection machinery).
--
-- DATA: keystone.invoice rows exist only for the maintainer's build tenants; their new columns read NULL
--       until a successful sendInvoice() push lands. No UPDATE needed.

ALTER TABLE keystone.invoice NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.invoice
  ADD COLUMN stripe_invoice_id text NULL,
  ADD COLUMN invoice_pdf_url text NULL,
  ADD COLUMN collection_method text NULL CHECK (collection_method IN ('charge_automatically','send_invoice')),
  ADD COLUMN effective_at timestamptz NULL,
  ADD COLUMN amount_remaining_minor integer NULL,
  ADD COLUMN amount_overpaid_minor integer NULL,
  ADD COLUMN statement_descriptor text NULL,
  ADD COLUMN rendering jsonb NULL,
  ADD COLUMN payment_method_types jsonb NULL,
  ADD CONSTRAINT stripe_invoice_id_per_tenant
    UNIQUE NULLS NOT DISTINCT (tenant_id, stripe_invoice_id);

-- ── Self-check, run while NO FORCE is still in effect ──────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'invoice'
     AND column_name IN ('stripe_invoice_id', 'invoice_pdf_url', 'collection_method', 'effective_at',
                         'amount_remaining_minor', 'amount_overpaid_minor', 'statement_descriptor',
                         'rendering', 'payment_method_types');
  IF n_cols <> 9 THEN
    RAISE EXCEPTION '0490 self-check: expected 9 new columns, found %', n_cols;
  END IF;

  -- ★ Positive control: the UNIQUE constraint must exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'keystone' AND table_name = 'invoice'
       AND constraint_name = 'stripe_invoice_id_per_tenant'
  ) THEN
    RAISE EXCEPTION '0490 self-check: stripe_invoice_id_per_tenant unique constraint not found';
  END IF;

  -- ★ Positive control: CHECK constraint on collection_method
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_schema = 'keystone' AND constraint_name
       LIKE '%collection_method%'
  ) THEN
    RAISE EXCEPTION '0490 self-check: collection_method CHECK constraint not found';
  END IF;
END
$check$;

ALTER TABLE keystone.invoice FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTERs ──────────────────────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'invoice';
  IF NOT forced THEN
    RAISE EXCEPTION '0490 self-check: RLS is no longer FORCED on invoice';
  END IF;
END
$rls$;
