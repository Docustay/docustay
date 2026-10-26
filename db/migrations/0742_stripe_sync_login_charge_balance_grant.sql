-- FOUND 14 Oct 2026 (production worker log): the nightly Stripe reconciliation reports "could not back-fill: balance_transactions
-- (permission denied for table stripe_charge_balance)" on every run. src/money/payoutLinks.mjs writes keystone_meta.stripe_charge_balance through
-- sync.postgresClient, which is the sync engine's own login `app_stripe_sync` (since db/migrate.mjs#splitStripeSyncLogin); migration 0579 granted the
-- table to app_rw/app_worker only, so the login holds no privilege on it (has_table_privilege = false for SELECT/INSERT/UPDATE, MEASURED 14 Oct).
-- Same class as 0656 (stripe_mirror_health). Additive and idempotent; skipped where the login does not exist (a fresh self-hosted install without the split).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_stripe_sync') THEN
    GRANT USAGE ON SCHEMA keystone_meta TO app_stripe_sync;
    GRANT SELECT, INSERT, UPDATE ON keystone_meta.stripe_charge_balance TO app_stripe_sync;
  END IF;
END $$;
