-- R13-D539: a declined card leaves a visible trace. Stripe's payment_intent.payment_failed names the payment's party in the intent metadata;
-- the row for that party keeps the last failure (words from Stripe and when). A later success clears nothing: the row turns paid and the list shows paid first.
ALTER TABLE keystone.document_payment ADD COLUMN IF NOT EXISTS last_failure text;
ALTER TABLE keystone.document_payment ADD COLUMN IF NOT EXISTS last_failed_at timestamptz;
