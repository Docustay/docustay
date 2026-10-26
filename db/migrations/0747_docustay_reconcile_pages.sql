-- 0747 · Billing audit follow-up (15 Oct 2026, Run 10 email proof): the daily Docustay plan reconcile read "the first 200 subscriptions by tenant id" and stopped, so once there are more than 200
-- paid Docustay workspaces the later ones are never re-read from Stripe and never get their renewal reminder. This adds a keyset page (after a tenant id) so the worker can walk all of them. Additive: 0736's function stays.
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone_auth.list_docustay_subscriptions_after(p_after uuid, p_limit integer DEFAULT 200)
RETURNS TABLE (tenant_id uuid, stripe_subscription_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT s.tenant_id, s.stripe_subscription_id FROM keystone.mainstay_subscription s
   WHERE s.plan_key LIKE 'docustay\_%' AND s.stripe_subscription_id IS NOT NULL AND s.status <> 'canceled'
     AND (p_after IS NULL OR s.tenant_id > p_after)
   ORDER BY s.tenant_id LIMIT greatest(1, least(p_limit, 1000));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_docustay_subscriptions_after(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_subscriptions_after(uuid, integer) TO app_worker;

SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0747 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
