-- 0761 · Docustay v1 item 17: two more plan keys, Pay as you go and Lifetime (SIGNWITH 5.1). Widens the one CHECK; additive, safe to re-run.
ALTER TABLE keystone.mainstay_subscription DROP CONSTRAINT IF EXISTS mainstay_subscription_plan_key_check;
ALTER TABLE keystone.mainstay_subscription ADD CONSTRAINT mainstay_subscription_plan_key_check
  CHECK (plan_key IN ('solo','practice','group','enterprise','founder','docustay_free','docustay_pro','docustay_payg','docustay_lifetime'));
