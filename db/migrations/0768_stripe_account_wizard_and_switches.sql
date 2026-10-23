-- 0768: the Stripe payments wizard and "Your Stripe account" screen (21 Oct 2026, STRIPE-PAYMENTS-SPEC.md). Additive only; every column has a default, so nothing changes for a workspace until it uses them.
--   wizard            the non-sensitive details typed in the setup wizard and the step reached (business type, name, website, email, what for). Never an SSN, EIN, ID, date of birth, address or bank number.
--   paused_at         "Take payments" switched off by an Admin or Owner (payment boxes say payments are paused; signing still works; nothing is refunded).
--   send_own_receipt  "Also send a receipt from Docustay". NULL = not chosen: a workspace connected before today keeps the receipts it already gets; a workspace set up through the wizard starts with it off (Stripe already emails one).
ALTER TABLE keystone.connect_account ADD COLUMN IF NOT EXISTS wizard jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE keystone.connect_account ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE keystone.connect_account ADD COLUMN IF NOT EXISTS send_own_receipt boolean;
-- The worker's daily check (a Stripe deadline close, owner emails at 7, 3 and 1 days) needs the workspaces that have a connected account: ids only. Each email goes once (keystone.docustay_event_once).
GRANT SELECT (tenant_id, state, stripe_account_id) ON keystone.connect_account TO auth_owner;
DROP POLICY IF EXISTS connect_account_notice_read ON keystone.connect_account;
CREATE POLICY connect_account_notice_read ON keystone.connect_account FOR SELECT TO auth_owner USING (true);
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone_auth.list_connect_tenants(p_limit integer DEFAULT 500)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT c.tenant_id FROM keystone.connect_account c WHERE c.stripe_account_id IS NOT NULL AND c.state IN ('pending', 'restricted', 'live') ORDER BY c.tenant_id LIMIT greatest(1, least(p_limit, 2000));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_connect_tenants(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_connect_tenants(integer) TO app_worker;
SET LOCAL ROLE app_owner;
DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0768 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
