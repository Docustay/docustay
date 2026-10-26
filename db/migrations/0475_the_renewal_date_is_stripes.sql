-- 0475 — THE RENEWAL DATE IS STRIPE'S, NOT OURS (R4 — Ty, 25 Sep 2026).
--
-- ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES. Task 17.6 shipped a
--     "renews" date computed as `mainstay_subscription.updated_at` plus one month, and
--     `src/billing/usageProviders.mjs` derived period ends the same way. A computed date drifts
--     on a trial, a proration, a failed payment or a plan change — and the screen then tells a
--     practice a date they will not actually be charged on. This migration carries Stripe's own
--     `current_period_start` / `current_period_end` on the mirror so readers read, never derive.
--
-- ★ WRITER: `src/billing/webhook.mjs` (`handleSubscriptionWebhook`), on every verified
--   `customer.subscription.created|updated|deleted` event — the same single-writer discipline
--   CT-110 already binds this table to. READERS: `getSubscription` (src/billing/mainstay.mjs),
--   `GET /api/settings` renews (src/routes/settings.mjs), `periodWindow` (src/billing/usage.mjs).
-- ★ NULLABLE ON PURPOSE: a trialing practice with no Stripe subscription yet has NO renewal date,
--   and the honest display for that is absence — never a guess.
--
-- DATA: `keystone.mainstay_subscription` rows exist only for Ty's build tenants (Mainstay is not
-- live); their new columns read NULL until the next subscription webhook lands. No UPDATE needed.

ALTER TABLE keystone.mainstay_subscription NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.mainstay_subscription
  ADD COLUMN current_period_start timestamptz NULL,
  ADD COLUMN current_period_end   timestamptz NULL,
  ADD CONSTRAINT mainstay_subscription_period_order_check
    CHECK (current_period_start IS NULL OR current_period_end IS NULL
           OR current_period_end > current_period_start);

-- ── Self-check, run while NO FORCE is still in effect (the migration role owns the table, so the
--    probe reaches the new CHECK instead of being stopped by a forced RLS policy first). ─────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'mainstay_subscription'
     AND column_name IN ('current_period_start', 'current_period_end');
  IF n_cols <> 2 THEN
    RAISE EXCEPTION '0475 self-check: expected both period columns, found %', n_cols;
  END IF;

  -- ★ Positive control for the CHECK: a backwards period must be refused. Postgres evaluates
  --   CHECK constraints before FK triggers, so the deliberately-nonexistent tenant id never
  --   reaches the FK on the refusal path.
  BEGIN
    INSERT INTO keystone.mainstay_subscription
      (tenant_id, plan_key, status, current_period_start, current_period_end)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'solo', 'trialing',
       '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z');
    RAISE EXCEPTION '0475 self-check: a backwards period was ACCEPTED';
  EXCEPTION
    WHEN check_violation THEN NULL;      -- the period-order CHECK refused it: correct
  END;
END
$check$;

ALTER TABLE keystone.mainstay_subscription FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTERs — the 0334 discipline outlives this migration. ──────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'mainstay_subscription';
  IF NOT forced THEN
    RAISE EXCEPTION '0475 self-check: RLS is no longer FORCED on mainstay_subscription';
  END IF;
END
$rls$;
