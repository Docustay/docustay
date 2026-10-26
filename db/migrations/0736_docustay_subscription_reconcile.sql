-- 0736 · Billing audit (13 Oct 2026): the daily reconcile of Docustay plans against Stripe. The worker's global tick asks this function which workspaces have a Stripe subscription that is not already ended,
-- then re-reads each from Stripe and mirrors it through the same path a webhook takes (a changed plan, status or cancel date is announced once; an unchanged one is silent). Ids only, never an address. Additive, idempotent.
GRANT SELECT (tenant_id, plan_key, status, stripe_subscription_id) ON keystone.mainstay_subscription TO auth_owner;
DROP POLICY IF EXISTS docustay_reconcile_read ON keystone.mainstay_subscription;
CREATE POLICY docustay_reconcile_read ON keystone.mainstay_subscription FOR SELECT TO auth_owner USING (true);

SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone_auth.list_docustay_subscriptions(p_limit integer DEFAULT 200)
RETURNS TABLE (tenant_id uuid, stripe_subscription_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT s.tenant_id, s.stripe_subscription_id FROM keystone.mainstay_subscription s
   WHERE s.plan_key LIKE 'docustay\_%' AND s.stripe_subscription_id IS NOT NULL AND s.status <> 'canceled'
   ORDER BY s.tenant_id LIMIT greatest(1, least(p_limit, 1000));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_docustay_subscriptions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_subscriptions(integer) TO app_worker;

SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0736 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
