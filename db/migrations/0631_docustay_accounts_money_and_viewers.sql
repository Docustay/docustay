-- 0631 · PART 29 STEP 2 — Docustay customers and their money, inside GLRS, for Ty only. Additive and idempotent.
--  1 · account_type gains 'docustay_customer' (a hosted workspace) and 'docustay_selfhost' (a self-hosted install, read-only, step 3).
--  2 · THE PERMISSION: `platform.docustay_viewers` (a tenant setting on the platform organisation, a list of email addresses; Ty today, Grant later with one setting). `keystone.docustay_may_view()` is true only in the
--      PLATFORM organisation, only for a listed person (or the system itself — the worker sweep, which has no person). Nothing else in the product can see another workspace.
--  3 · THE ONE CROSS-ORGANISATION READER, in the pattern of 0017/0063: SELECT privileges plus a policy for `auth_owner` (cannot log in; reachable only through the definer function below), limited to rows of Docustay
--      workspaces. `keystone.docustay_workspaces()` answers only when docustay_may_view() is true — otherwise zero rows.
--  4 · THE MONEY: platform-only views of the Stripe mirror for those workspaces' customers (invoices, payments, subscriptions). They never touch app_user in GLRS: a Docustay customer is never a coaching client.
--  5 · The Docustay program and two plans (monthly, yearly) in the platform organisation's catalogue, so Money's program filter can separate them.
-- (1) account types
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'keystone.account'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%account_type%' LOOP
    EXECUTE format('ALTER TABLE keystone.account DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE keystone.account ADD CONSTRAINT account_account_type_check
    CHECK (account_type IS NULL OR account_type IN ('prospect','customer','partner','vendor','other','docustay_customer','docustay_selfhost'));
END $$;

-- (2) the permission
CREATE OR REPLACE FUNCTION keystone.docustay_may_view() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT t.is_platform FROM keystone.tenant t WHERE t.id = keystone.current_tenant_id()), false)
     AND (   keystone.current_user_id() IS NULL
          OR EXISTS (SELECT 1 FROM keystone.app_user u
                       JOIN keystone.tenant_setting s ON s.tenant_id = u.tenant_id AND s.key = 'platform.docustay_viewers'
                      WHERE u.id = keystone.current_user_id()
                        AND lower(u.email) IN (SELECT lower(x) FROM jsonb_array_elements_text(s.value) x)))
$$;
REVOKE ALL ON FUNCTION keystone.docustay_may_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_may_view() TO app_rw, app_worker, auth_owner;

-- (3) the reader
GRANT SELECT ON keystone.mainstay_subscription TO auth_owner;
DROP POLICY IF EXISTS docustay_platform_read ON keystone.mainstay_subscription;
CREATE POLICY docustay_platform_read ON keystone.mainstay_subscription FOR SELECT TO auth_owner USING (plan_key LIKE 'docustay\_%');
GRANT SELECT (id, tenant_id, email, display_name, role, staff_role, lifecycle_status, archived_at) ON keystone.app_user TO auth_owner;
DROP POLICY IF EXISTS docustay_platform_read ON keystone.app_user;
CREATE POLICY docustay_platform_read ON keystone.app_user FOR SELECT TO auth_owner
  USING (tenant_id IN (SELECT ms.tenant_id FROM keystone.mainstay_subscription ms WHERE ms.plan_key LIKE 'docustay\_%'));
GRANT SELECT (tenant_id, state, sent_at) ON keystone.document_instance TO auth_owner;
DROP POLICY IF EXISTS docustay_platform_read ON keystone.document_instance;
CREATE POLICY docustay_platform_read ON keystone.document_instance FOR SELECT TO auth_owner
  USING (tenant_id IN (SELECT ms.tenant_id FROM keystone.mainstay_subscription ms WHERE ms.plan_key LIKE 'docustay\_%'));

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
         (SELECT count(*)::int FROM keystone.document_instance d WHERE d.tenant_id = t.id AND d.sent_at >= date_trunc('month', now()))
    FROM keystone.mainstay_subscription ms
    JOIN keystone.tenant t ON t.id = ms.tenant_id
    LEFT JOIN LATERAL (SELECT u.display_name, u.email FROM keystone.app_user u WHERE u.tenant_id = t.id AND u.role = 'staff' AND u.staff_role = 'owner' ORDER BY u.created_at LIMIT 1) o ON true
   WHERE ms.plan_key LIKE 'docustay\_%' AND keystone.docustay_may_view()
$$;
REVOKE ALL ON FUNCTION keystone.docustay_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_workspaces() TO app_rw, app_worker, app_owner;
SET LOCAL ROLE app_owner;

-- (4) the money, platform-only
CREATE OR REPLACE VIEW keystone.docustay_subscription_effective WITH (security_invoker = false) AS
SELECT s.id AS stripe_subscription_id, w.tenant_id AS workspace_id, w.name AS workspace_name, s.status::text AS status, s.customer,
       to_timestamp(s.current_period_end) AS current_period_end, s.cancel_at_period_end, s.items, w.billing_interval, w.founders_price, 'docustay'::text AS origin
  FROM stripe.subscriptions s JOIN keystone.docustay_workspaces() w ON w.stripe_customer_id = s.customer;
CREATE OR REPLACE VIEW keystone.docustay_invoice_effective WITH (security_invoker = false) AS
SELECT si.id AS stripe_invoice_id, w.tenant_id AS workspace_id, w.name AS workspace_name, si.number, si.status::text AS status, si.total::integer AS amount_minor,
       COALESCE(si.amount_paid, 0)::integer AS paid_minor, COALESCE(si.amount_remaining, 0)::integer AS amount_remaining_minor, upper(si.currency) AS currency,
       to_timestamp(si.created) AS created_at, si.hosted_invoice_url, 'docustay'::text AS origin
  FROM stripe.invoices si JOIN keystone.docustay_workspaces() w ON w.stripe_customer_id = si.customer WHERE si.status::text <> 'draft';
CREATE OR REPLACE VIEW keystone.docustay_payment_effective WITH (security_invoker = false) AS
SELECT ch.id AS stripe_charge_id, w.tenant_id AS workspace_id, w.name AS workspace_name, ch.amount::integer AS amount_minor, COALESCE(ch.amount_refunded, 0)::integer AS refunded_minor,
       upper(ch.currency) AS currency, ch.status, to_timestamp(ch.created) AS created_at, ch.payment_method_details->'card'->>'brand' AS card_brand,
       ch.payment_method_details->'card'->>'last4' AS card_last_four, 'docustay'::text AS origin
  FROM stripe.charges ch JOIN keystone.docustay_workspaces() w ON w.stripe_customer_id = ch.customer;
GRANT SELECT ON keystone.docustay_subscription_effective, keystone.docustay_invoice_effective, keystone.docustay_payment_effective TO app_rw, app_worker;

-- (5) program and plans in the platform organisation's catalogue
DO $$
DECLARE v_tenant uuid; v_prog uuid;
BEGIN
  SELECT t.id INTO v_tenant FROM keystone.platform_tenant_id() t(id) LIMIT 1;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  SELECT id INTO v_prog FROM keystone.program WHERE tenant_id = v_tenant AND name = 'Docustay' LIMIT 1;
  IF v_prog IS NULL THEN
    INSERT INTO keystone.program (tenant_id, name, position, visibility) VALUES (v_tenant, 'Docustay', COALESCE((SELECT max(position) + 1 FROM keystone.program WHERE tenant_id = v_tenant), 0), 'shown') RETURNING id INTO v_prog;
  END IF;
  INSERT INTO keystone.plan (tenant_id, name, price_minor, currency, interval, active, program_id, description)
  SELECT v_tenant, x.name, x.price, 'USD', x.iv, true, v_prog, x.descr
    FROM (VALUES ('Docustay Pro (monthly)', 1600, 'month', 'Docustay Pro, billed monthly — unlimited documents, automated reminders, bulk send, team roles, no Docustay footer, signing links on your own domain.'),
                 ('Docustay Pro (yearly)', 16000, 'year', 'Docustay Pro, billed yearly.')) AS x(name, price, iv, descr)
   WHERE NOT EXISTS (SELECT 1 FROM keystone.plan p WHERE p.tenant_id = v_tenant AND p.name = x.name);
END $$;
