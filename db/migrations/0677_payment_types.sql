-- FINAL PUSH Stage 5 (7 Oct 2026): payment types. A payment row may now be a signer-chosen amount, a deposit (the charge is the deposit, `total_minor` remembers the whole), installments (a Stripe subscription capped after `plan_count`
-- payments) or a subscription (repeats until cancelled). Stripe owns the schedule: we keep the subscription id, and `payments_made` / `sub_status` are copied from Stripe's own state, never computed here. Additive.
ALTER TABLE keystone.document_payment
  ADD COLUMN IF NOT EXISTS total_minor     integer NULL CHECK (total_minor IS NULL OR total_minor > 0),
  ADD COLUMN IF NOT EXISTS plan_every      text    NULL CHECK (plan_every IS NULL OR plan_every IN ('week','month','year')),
  ADD COLUMN IF NOT EXISTS plan_count      integer NULL CHECK (plan_count IS NULL OR (plan_count BETWEEN 2 AND 60)),
  ADD COLUMN IF NOT EXISTS subscription_id text    NULL,
  ADD COLUMN IF NOT EXISTS payments_made   integer NOT NULL DEFAULT 0 CHECK (payments_made >= 0),
  ADD COLUMN IF NOT EXISTS sub_status      text    NULL CHECK (sub_status IS NULL OR char_length(sub_status) <= 30);
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'keystone.document_payment'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%amount_kind%' LOOP
    EXECUTE format('ALTER TABLE keystone.document_payment DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE keystone.document_payment ADD CONSTRAINT document_payment_amount_kind_check
  CHECK (amount_kind IS NULL OR amount_kind IN ('fixed','custom','formula','price','link','chosen','deposit','installments','subscription'));
CREATE INDEX IF NOT EXISTS document_payment_subscription_idx ON keystone.document_payment (tenant_id, subscription_id) WHERE subscription_id IS NOT NULL;
