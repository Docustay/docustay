-- 0357_stripe_customer_sync
-- Stripe customer sync: per-person and per-account Stripe Customer tracking.
--
-- ★★★ STRIPE IS THE MONEY RECORD. Every person and account gets a Customer on THAT PRACTICE'S
--     connected Stripe account (via the Stripe-Account header). The platform mirrors and never
--     computes them.
--
-- ★ IDEMPOTENT CUSTOMER CREATION. If `Connect` is not set up yet, the customer is queued
--   (stored as null). The sync happens later when the account connects.
--
-- ★ LIVEMODE STORAGE. A test customer id can never be used against live. Storing livemode
--   on the person/account row lets us refuse mismatches upfront.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- app_user — PERSON STRIPE CUSTOMER FIELDS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.app_user ADD COLUMN stripe_customer_id text;
ALTER TABLE keystone.app_user ADD COLUMN stripe_livemode boolean;
ALTER TABLE keystone.app_user ADD COLUMN stripe_synced_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- account — ACCOUNT STRIPE CUSTOMER FIELDS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.account ADD COLUMN stripe_customer_id text;
ALTER TABLE keystone.account ADD COLUMN stripe_livemode boolean;
ALTER TABLE keystone.account ADD COLUMN stripe_synced_at timestamptz;
