-- 0765 · Switching a live subscription between Pay as you go and Pro (18 Oct 2026) is recorded like a cancel or a resume: `plan_switched` (from, to). Additive: only the allowed kinds widen.
ALTER TABLE keystone.docustay_billing_record DROP CONSTRAINT IF EXISTS docustay_billing_record_kind_check;
ALTER TABLE keystone.docustay_billing_record ADD CONSTRAINT docustay_billing_record_kind_check
  CHECK (kind IN ('renewal_terms_accepted', 'cancel_intent', 'cancel_confirmed', 'resumed', 'renewal_reminder_sent', 'refund_noted', 'plan_switched'));

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0765 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
