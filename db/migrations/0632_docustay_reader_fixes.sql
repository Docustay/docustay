-- 0632 · PART 29 STEP 2 — fixes found by the sandbox proof of 0631 (0631 stays as applied).
--  · `auth_owner` could not read app_user.created_at (the owner lookup orders by it) — granted that one column.
--  · `auth_owner` cannot read document_instance: the table's PUBLIC policies call document_party, which it must not see. Rather than widen that, the platform list does not count documents (the column returns NULL; a later
--    step can add a per-workspace counter the island publishes). The grant and the policy added in 0631 are removed.
GRANT SELECT (created_at) ON keystone.app_user TO auth_owner;
DROP POLICY IF EXISTS docustay_platform_read ON keystone.document_instance;
REVOKE SELECT ON keystone.document_instance FROM auth_owner;

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.docustay_workspaces() RETURNS TABLE (
  tenant_id uuid, slug text, name text, created_at timestamptz, plan_key text, status text, billing_interval text, founders_price boolean,
  stripe_customer_id text, stripe_subscription_id text, current_period_end timestamptz, past_due_since timestamptz,
  owner_name text, owner_email text, people integer, documents_this_month integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, t.slug, t.name, t.created_at, ms.plan_key, ms.status, ms.billing_interval, ms.founders_price,
         ms.stripe_customer_id, ms.stripe_subscription_id, ms.current_period_end, ms.past_due_since,
         o.display_name, o.email,
         (SELECT count(*)::int FROM keystone.app_user p WHERE p.tenant_id = t.id AND p.role = 'staff' AND p.lifecycle_status <> 'former'),
         NULL::int
    FROM keystone.mainstay_subscription ms
    JOIN keystone.tenant t ON t.id = ms.tenant_id
    LEFT JOIN LATERAL (SELECT u.display_name, u.email FROM keystone.app_user u WHERE u.tenant_id = t.id AND u.role = 'staff' AND u.staff_role = 'owner' ORDER BY u.created_at LIMIT 1) o ON true
   WHERE ms.plan_key LIKE 'docustay\_%' AND keystone.docustay_may_view()
$$;
SET LOCAL ROLE app_owner;
