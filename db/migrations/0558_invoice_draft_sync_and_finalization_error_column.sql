-- 0558 — INVOICE REBUILD (Part 3, the maintainer's ruling: full rebuild), foundation columns.
--
-- ★★★ TWO COLUMNS, TWO SEPARATE REASONS:
--
-- 1. `stripe_draft_synced_at` — the live-Stripe-draft-sync loop's own "last successful sync"
--    timestamp. Used by (a) the UI's "Saved" indicator and (b) the abandoned-draft sweep's
--    "no edit for N days" test (src/automations/sweeps.mjs, new function, same pass).
--
-- 2. `last_finalization_error` — F855 (~/example-rebuild/FINDINGS-OPEN.md): `pushInvoiceToStripe`'s
--    finalization-error path (src/money/invoiceStripe.mjs:338-346) has been writing the Stripe
--    error message into `statement_descriptor` — the WRONG column (that one is a real card-
--    statement label, not an error-message scratchpad). A real, pre-existing, unrelated bug
--    found reading that file for this rebuild, fixed here at the schema level (the JS-side fix
--    — writing HERE instead of there — ships in the same pass, invoiceStripe.mjs).
--
-- DATA: both columns are NULL for every existing row (nothing has ever written either one under
--       its correct name) — no backfill needed, no data to migrate.

ALTER TABLE keystone.invoice
  ADD COLUMN stripe_draft_synced_at timestamptz NULL,
  ADD COLUMN last_finalization_error text NULL;

-- ── Self-check ──────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'invoice'
     AND column_name IN ('stripe_draft_synced_at', 'last_finalization_error');
  IF n_cols <> 2 THEN
    RAISE EXCEPTION '0558 self-check: expected 2 new columns, found %', n_cols;
  END IF;
  RAISE NOTICE '0558: stripe_draft_synced_at and last_finalization_error added to keystone.invoice';
END
$check$;
