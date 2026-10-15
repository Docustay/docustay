-- 0588 · RULING (2 Oct 2026): a PROTECTED REAL CLIENT's Stripe customer is NOT routed to the platform's own event handlers by 0587.
-- 0587 registers every Stripe customer so events about them find their practice. For a real client (protected_real_client) that would start
-- running payment/receipt/void handlers on events Stripe is still retrying (a voided-invoice event 86 hours old was pending for Example Client when
-- this was written) — and could email a real person about an old invoice. His money is read from the Stripe mirror, which sees every event
-- regardless, so nothing is lost by leaving him unrouted. Revisit deliberately (the maintainer) when real clients go live.
-- Cost if wrong: a protected client's NEW payment does not trigger the platform's receipt/credit side-effects until he is mapped (the nightly catch-up still grants credits).
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.retire_stripe_customer_source(p_customer text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE keystone_auth.webhook_source SET retired_at = now()
   WHERE provider = 'stripe' AND external_id = p_customer AND tenant_id = keystone.current_tenant_id() AND retired_at IS NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION keystone.retire_stripe_customer_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.retire_stripe_customer_source(text) TO app_rw, app_owner;   -- app_owner lent for the loop below

SET LOCAL ROLE app_owner;

DO $m$
DECLARE v_tenant_ids uuid[]; v_tenant_id uuid; r record; n integer := 0; i integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    FOR r IN SELECT stripe_customer_id AS cid FROM keystone.app_user
              WHERE tenant_id = v_tenant_id AND protected_real_client AND stripe_customer_id ~ '^cus_[A-Za-z0-9]+$' LOOP
      PERFORM keystone.retire_stripe_customer_source(r.cid);
      n := n + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE '0588: % protected client customer(s) left unrouted', n;
END $m$;

SET LOCAL ROLE auth_owner;
REVOKE EXECUTE ON FUNCTION keystone.retire_stripe_customer_source(text) FROM app_owner;
RESET ROLE;
SET LOCAL ROLE app_owner;
