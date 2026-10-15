-- 0623_docustay_product — Batch B. A Documents-only workspace is a tenant of shape 'documents' on a Docustay plan.
--   · tenant.shape gains 'documents' (nav shows only Documents; "upgrade in place" is the existing shape change to 'crm' / 'both', nothing migrates).
--   · workbench_subscription.plan_key gains 'docustay_free' / 'docustay_pro' (the ONE subscription table; Stripe webhooks and checkout already write it).
-- Widening two CHECK constraints: additive, safe to re-run.
ALTER TABLE keystone.tenant DROP CONSTRAINT IF EXISTS tenant_shape_check;
ALTER TABLE keystone.tenant ADD CONSTRAINT tenant_shape_check CHECK (shape IN ('crm', 'run', 'both', 'documents'));
ALTER TABLE keystone.workbench_subscription DROP CONSTRAINT IF EXISTS workbench_subscription_plan_key_check;
ALTER TABLE keystone.workbench_subscription ADD CONSTRAINT workbench_subscription_plan_key_check
  CHECK (plan_key IN ('solo','practice','group','enterprise','founder','docustay_free','docustay_pro'));
