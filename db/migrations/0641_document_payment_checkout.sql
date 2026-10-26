-- Part 30 item 11 — paying while signing moves to Stripe's hosted Checkout, on the workspace's own connected account, with Docustay's platform fee decided and stored at the moment of payment.
-- Additive and idempotent. A payment row now starts from a Checkout Session (payment_intent_id arrives only when Stripe has one), and carries what the fee was and why.
ALTER TABLE keystone.document_payment ALTER COLUMN payment_intent_id DROP NOT NULL;
ALTER TABLE keystone.document_payment
  ADD COLUMN IF NOT EXISTS checkout_session_id text,
  ADD COLUMN IF NOT EXISTS receipt_url        text,
  ADD COLUMN IF NOT EXISTS amount_kind        text,
  ADD COLUMN IF NOT EXISTS fee_bps            integer NOT NULL DEFAULT 0 CHECK (fee_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS fee_minor          integer NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS fee_refunded_minor integer NOT NULL DEFAULT 0 CHECK (fee_refunded_minor >= 0),
  ADD COLUMN IF NOT EXISTS plan_key           text,
  ADD COLUMN IF NOT EXISTS stripe_account_id  text,
  ADD COLUMN IF NOT EXISTS is_test            boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_payment_amount_kind') THEN
    ALTER TABLE keystone.document_payment ADD CONSTRAINT document_payment_amount_kind CHECK (amount_kind IS NULL OR amount_kind IN ('fixed','custom','formula','price','link'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_payment_has_a_stripe_reference') THEN
    ALTER TABLE keystone.document_payment ADD CONSTRAINT document_payment_has_a_stripe_reference CHECK (payment_intent_id IS NOT NULL OR checkout_session_id IS NOT NULL);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS document_payment_session_key ON keystone.document_payment (tenant_id, checkout_session_id) WHERE checkout_session_id IS NOT NULL;
-- a status 'expired' for a Checkout Session the signer never finished (the session ran out); a new attempt reuses the same row
DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'keystone.document_payment'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%partially_refunded%' LIMIT 1;
  IF c IS NOT NULL AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = c) NOT LIKE '%expired%' THEN
    EXECUTE format('ALTER TABLE keystone.document_payment DROP CONSTRAINT %I', c);
    ALTER TABLE keystone.document_payment ADD CONSTRAINT document_payment_status_check CHECK (status IN ('pending','paid','partially_refunded','refunded','expired'));
  END IF;
END $$;
-- a disconnect (from Docustay or from the person's own Stripe dashboard) is shown plainly as "Disconnected"
ALTER TABLE keystone.connect_account ADD COLUMN IF NOT EXISTS disconnected_at timestamptz;
ALTER TABLE keystone.connect_account ADD COLUMN IF NOT EXISTS connect_via text CHECK (connect_via IS NULL OR connect_via IN ('oauth','account_link'));
