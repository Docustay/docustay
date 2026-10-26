-- 0587 · A STRIPE EVENT FOR A CUSTOMER MUST FIND ITS PRACTICE (found in the sandbox browser test, 2 Oct 2026).
-- `EXTERNAL_REF.stripe` routes an event by `data.object.customer`, resolved through `keystone_auth.webhook_source` — but ONLY Stripe ACCOUNT ids
-- (acct_…, migration 0424) were ever registered there, never customers. So a charge/refund/invoice event on the PLATFORM account (GLRS) resolved
-- no practice (the object's metadata is the only other source, and `charge.*` events carry none), threw NoTenantContext, and Mainstay's own side
-- — payment rows, refunds, voided credits — never ran; only the mirror saw it. This registers each customer when it is created/linked, and
-- backfills every existing one. Same function shape as ensure_stripe_account_source; idempotent; a customer mapped to ANOTHER practice is refused.
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.ensure_stripe_customer_source(p_customer text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := keystone.current_tenant_id();
  v_owner uuid;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'ensure_stripe_customer_source requires tenant context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_customer !~ '^cus_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'not a Stripe customer id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT tenant_id, id INTO v_owner, v_id FROM keystone_auth.webhook_source
   WHERE provider = 'stripe' AND external_id = p_customer AND retired_at IS NULL;
  IF v_id IS NOT NULL THEN
    IF v_owner <> v_tenant THEN
      RAISE EXCEPTION 'that Stripe customer is mapped to another practice' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO keystone_auth.webhook_source (tenant_id, provider, external_id) VALUES (v_tenant, 'stripe', p_customer) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION keystone.ensure_stripe_customer_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.ensure_stripe_customer_source(text) TO app_rw, app_worker;
GRANT EXECUTE ON FUNCTION keystone.ensure_stripe_customer_source(text) TO app_owner;     -- lent for the backfill below, handed back at the end (the 0424 idiom)

SET LOCAL ROLE app_owner;

DO $stripe_customer_source_backfill$
DECLARE
  v_tenant_ids uuid[]; v_tenant_count integer; v_tenant_id uuid; v_n integer; v_total integer := 0; i integer; r record;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*) INTO v_tenant_ids, v_tenant_count FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0587: enumerated % practice id(s) but keystone.tenant holds %', coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0587: the tenant context did not take effect for practice %', v_tenant_id;
    END IF;
    -- a customer id that is already another practice's is skipped (reported), never stolen
    v_n := 0;
    FOR r IN SELECT DISTINCT stripe_customer_id AS cid FROM keystone.app_user
              WHERE tenant_id = v_tenant_id AND stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
             UNION
             SELECT DISTINCT stripe_customer_id FROM keystone.account
              WHERE tenant_id = v_tenant_id AND stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    LOOP
      BEGIN
        PERFORM keystone.ensure_stripe_customer_source(r.cid);
        v_n := v_n + 1;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE '0587: customer % is mapped to another practice — skipped', r.cid;
      END;
    END LOOP;
    v_total := v_total + v_n;
  END LOOP;
  RAISE NOTICE '0587: % Stripe customer(s) registered across % practice(s)', v_total, v_tenant_count;
END
$stripe_customer_source_backfill$;

SET LOCAL ROLE auth_owner;
REVOKE EXECUTE ON FUNCTION keystone.ensure_stripe_customer_source(text) FROM app_owner;
RESET ROLE;
SET LOCAL ROLE app_owner;
