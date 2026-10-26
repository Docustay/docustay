-- 0480 — GIFT CARD REDEMPTION CREDITS CUSTOMER BALANCE ON STRIPE (Stage 20 Task 20.14)
--
-- Redemption writes a Customer Balance credit transaction on the connected account
-- (`customers/{id}/balance_transactions`, negative amount = credit) and stamps
-- `gift_card_entry.stripe_balance_txn_id`. The LEDGER STAYS OURS — the row is the record of why;
-- Stripe holds the money position. Invoice creation params gain `footer`/`default memo`/
-- `rendering_options` from an `invoices.templates` tenant_setting.

ALTER TABLE keystone.gift_card_entry NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.gift_card_entry
  ADD COLUMN stripe_balance_txn_id text NULL;

-- ── Self-check, run while NO FORCE is still in effect ───────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'gift_card_entry'
     AND column_name = 'stripe_balance_txn_id';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0480 self-check: expected stripe_balance_txn_id column, found %', n_cols;
  END IF;

  -- ★ Positive control: the column is nullable, allowing Stripe failures to still write ledger
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'gift_card_entry'
       AND column_name = 'stripe_balance_txn_id' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '0480 self-check: stripe_balance_txn_id must be nullable (ledger written on Stripe failure)';
  END IF;
END
$check$;

ALTER TABLE keystone.gift_card_entry FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTER ─────────────────────────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'gift_card_entry';
  IF NOT forced THEN
    RAISE EXCEPTION '0480 self-check: RLS is no longer FORCED on gift_card_entry';
  END IF;
END
$rls$;
