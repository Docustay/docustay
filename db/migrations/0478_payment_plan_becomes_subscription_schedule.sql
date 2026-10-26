-- 0478 · PAYMENT_PLAN BECOMES SUBSCRIPTION_SCHEDULE (Task 20.7 — F16 §3, 25 Sep 2026)
--
-- ★★★ THE TERMINOLOGY RULING: `payment_plan` is Mainstay-side terminology for scheduling
--     part payments on an invoice. The Stripe equivalent is a `subscription_schedule` object.
--     This migration renames the tables to align with Stripe vocabulary internally, and adds
--     the column that will hold the Stripe subscription_schedule id once synced.

-- Step 1: Disable RLS on both tables
ALTER TABLE keystone.payment_plan NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.payment_plan_row NO FORCE ROW LEVEL SECURITY;

-- Step 2: Add stripe_subscription_schedule_id column to payment_plan
ALTER TABLE keystone.payment_plan
  ADD COLUMN stripe_subscription_schedule_id text NULL;

-- Step 3: Rename payment_plan_row to subscription_schedule_row first
--         (FK constraint references must be renamed in order)
ALTER TABLE keystone.payment_plan_row RENAME TO subscription_schedule_row;

-- Step 4: Rename FK and index on the child table to match new parent name
ALTER TABLE keystone.subscription_schedule_row RENAME CONSTRAINT payment_plan_row_tenant_id_fkey
  TO subscription_schedule_row_tenant_id_fkey;
-- ★ REHEARSAL FIX (25 Sep 2026): the composite FK 0430 created is named
--   payment_plan_row_tenant_id_payment_plan_id_fkey (MEASURED, pg_constraint), not the name the
--   first draft assumed.
ALTER TABLE keystone.subscription_schedule_row RENAME CONSTRAINT payment_plan_row_tenant_id_payment_plan_id_fkey
  TO subscription_schedule_row_subscription_schedule_id_fkey;

-- Step 5: Rename the column on the child table
ALTER TABLE keystone.subscription_schedule_row RENAME COLUMN payment_plan_id TO subscription_schedule_id;

-- Step 6: Rename indexes on the child table
DROP INDEX IF EXISTS keystone.payment_plan_row_tenant_payment_plan_idx;
DROP INDEX IF EXISTS keystone.payment_plan_row_tenant_subscription_schedule_idx;

CREATE INDEX subscription_schedule_row_tenant_subscription_schedule_idx
  ON keystone.subscription_schedule_row (tenant_id, subscription_schedule_id);

-- Step 7: Rename payment_plan to subscription_schedule
ALTER TABLE keystone.payment_plan RENAME TO subscription_schedule;

-- Step 8: Re-enable RLS on both tables
ALTER TABLE keystone.subscription_schedule FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.subscription_schedule_row FORCE ROW LEVEL SECURITY;

-- Step 9: Self-check — both tables exist with correct shapes
DO $check$
DECLARE
  n_cols integer;
  forced_schedule boolean;
  forced_row boolean;
BEGIN
  -- Check subscription_schedule has the new column
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'subscription_schedule'
     AND column_name = 'stripe_subscription_schedule_id';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0478 self-check: subscription_schedule.stripe_subscription_schedule_id not added';
  END IF;

  -- Check subscription_schedule_row has renamed column
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'subscription_schedule_row'
     AND column_name = 'subscription_schedule_id';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0478 self-check: subscription_schedule_row.subscription_schedule_id not found';
  END IF;

  -- Check RLS is FORCED on both tables
  SELECT relforcerowsecurity INTO forced_schedule
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'subscription_schedule';
  IF NOT forced_schedule THEN
    RAISE EXCEPTION '0478 self-check: RLS is no longer FORCED on subscription_schedule';
  END IF;

  SELECT relforcerowsecurity INTO forced_row
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'subscription_schedule_row';
  IF NOT forced_row THEN
    RAISE EXCEPTION '0478 self-check: RLS is no longer FORCED on subscription_schedule_row';
  END IF;
END
$check$;

COMMENT ON TABLE keystone.subscription_schedule IS
  'F16 §3: A subscription schedule mirrors a Stripe subscription_schedule object for part-payment plans.';
COMMENT ON COLUMN keystone.subscription_schedule.stripe_subscription_schedule_id IS
  'The Stripe subscription_schedule id once synced.';
