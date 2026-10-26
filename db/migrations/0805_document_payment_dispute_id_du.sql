-- R13 (25 Oct 2026): Stripe's dispute ids start with du_ (the older dp_ is still seen). The check on document_payment.dispute_id only allowed dp_, so the first real dispute on a payment
-- taken in signing made the webhook fail with a 500 and the dispute was never shown on the Payments page. Allow both prefixes.
ALTER TABLE keystone.document_payment DROP CONSTRAINT IF EXISTS document_payment_dispute_id_check;
ALTER TABLE keystone.document_payment ADD CONSTRAINT document_payment_dispute_id_check CHECK (dispute_id IS NULL OR dispute_id ~ '^(dp|du)_[A-Za-z0-9]+$');
