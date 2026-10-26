-- 0008_seat_counts_context_switch
--
-- ★★★ WHY 0007 ALSO RETURNED ZERO, AND WHAT IT TAUGHT.
--
-- [MEASURED] with the definer function in place the counts were STILL 0, while the same query as
-- the superuser found 2. The mechanism:
--
--   ★★ `app_user` has FORCE ROW LEVEL SECURITY. FORCE applies the policy TO THE TABLE OWNER TOO.
--   A `SECURITY DEFINER` function runs as its owner — app_owner — and app_owner is therefore
--   STILL filtered by `tenant_id = keystone.current_tenant_id()`, which at that moment is the
--   PLATFORM tenant. The customer's rows do not match, so the count is 0.
--
-- ★ SECURITY DEFINER BUYS NOTHING AGAINST A FORCED POLICY. That is not a bug — it is precisely
-- what §P1 asked FORCE to do ("ENABLE alone does not apply to the owner"). The isolation held
-- against a privileged function, which is the outcome we want. It just means cross-tenant
-- aggregation needs a different shape.
--
-- ══ THE SHAPE THAT IS CORRECT ══════════════════════════════════════════════
-- ★★★ DO NOT ADD A BYPASSRLS ROLE. A role that bypasses RLS is a role that bypasses EVERY policy
-- in the database, forever, for whatever else later uses it. P1.8's catalog gate exists partly to
-- assert no such role exists, and it would have to be weakened to allow one — hard limit 5.
--
-- Instead the function BRIEFLY ADOPTS THE CUSTOMER'S OWN TENANT CONTEXT, counts, and restores.
-- It uses the SAME RLS mechanism rather than escaping it:
--   · the switch is transaction-local (`set_config(..., true)`),
--   · it is restored in an EXCEPTION-safe block, so a failure cannot leave the caller holding
--     someone else's context — which would be the one way this could become a real leak,
--   · and the function's RETURN TYPE IS FIVE INTEGERS, so even while holding that context there
--     is no shape in which a name could travel back to the caller.

CREATE OR REPLACE FUNCTION keystone.account_seat_counts(p_account_id uuid)
RETURNS TABLE (
  staff_seats             integer,
  adult_client_seats      integer,
  adolescent_client_seats integer,
  parent_seats            integer,
  total_seats             integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_tenant uuid;
  v_caller_tenant   text;
  r_staff int := 0; r_adult int := 0; r_adol int := 0; r_parent int := 0; r_total int := 0;
BEGIN
  -- ★ Remember the CALLER's context before touching it. Restoring this is the whole safety
  -- argument, so it is captured first and restored on every path including the error path.
  v_caller_tenant := current_setting('keystone.tenant_id', true);

  -- ★★ AUTHORISE WITH THE CALLER'S OWN CONTEXT, BEFORE ANY SWITCH. RLS on `account` still
  -- applies here, so a caller can only resolve accounts its own tenant owns.
  SELECT a.customer_tenant_id INTO v_customer_tenant
    FROM keystone.account a
   WHERE a.id = p_account_id
     AND a.tenant_id = keystone.current_tenant_id();

  IF NOT FOUND THEN
    -- ★ Same outcome for "no such account" and "not yours" — a distinguishable error would let a
    -- caller enumerate other tenants' account ids.
    RETURN;
  END IF;

  IF v_customer_tenant IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0;   -- no Keystone tenant behind it: zero seats, not NULL
    RETURN;
  END IF;

  BEGIN
    -- ★★★ THE NARROW WINDOW. The context is the customer's for exactly one statement.
    PERFORM set_config('keystone.tenant_id', v_customer_tenant::text, true);

    SELECT
      count(*) FILTER (WHERE u.role = 'staff')::integer,
      count(*) FILTER (WHERE u.role = 'adult_client')::integer,
      count(*) FILTER (WHERE u.role = 'adolescent_client')::integer,
      count(*) FILTER (WHERE u.role = 'parent')::integer,
      count(u.id)::integer
      INTO r_staff, r_adult, r_adol, r_parent, r_total
    FROM keystone.app_user u;

    -- ★ RESTORE IMMEDIATELY. Everything after this line is back in the caller's context.
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
  EXCEPTION WHEN OTHERS THEN
    -- ★★ THE CRITICAL PATH. If anything above raises, the caller must NOT be left holding the
    -- customer's tenant context for the rest of its transaction — that would turn a counting
    -- function into a cross-tenant read of every table.
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
    RAISE;
  END;

  RETURN QUERY SELECT r_staff, r_adult, r_adol, r_parent, r_total;
END $$;

COMMENT ON FUNCTION keystone.account_seat_counts(uuid) IS
  'P5.5 / §A3 — COUNTS, NEVER NAMES. Authorises with the CALLER''s context, then briefly adopts the customer''s tenant context to COUNT, restoring it on every path including the error path. Returns five integers: structurally incapable of returning a name. No BYPASSRLS role exists or is needed.';

REVOKE ALL ON FUNCTION keystone.account_seat_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.account_seat_counts(uuid) TO app_rw;
