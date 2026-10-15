-- 0649 · D-032 (6 Oct 2026): the date a subscription is scheduled to end (set when a customer cancels at the end of the period in Stripe's portal). Mirrored from Stripe's `cancel_at`; NULL when no cancellation is scheduled. Additive and idempotent.
ALTER TABLE keystone.workbench_subscription ADD COLUMN IF NOT EXISTS cancel_at timestamptz;
