-- 0737 · Billing audit (13 Oct 2026): two more facts the billing record keeps. `renewal_reminder_sent` (California's automatic-renewal law asks for a reminder 15 to 45 days before a yearly plan renews, with the price and how to cancel;
-- the date it went out is the proof) and `refund_noted` (a refund Stripe reported). Additive: only the allowed kinds widen.
ALTER TABLE keystone.docustay_billing_record DROP CONSTRAINT IF EXISTS docustay_billing_record_kind_check;
ALTER TABLE keystone.docustay_billing_record ADD CONSTRAINT docustay_billing_record_kind_check
  CHECK (kind IN ('renewal_terms_accepted', 'cancel_intent', 'cancel_confirmed', 'resumed', 'renewal_reminder_sent', 'refund_noted'));

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0737 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
