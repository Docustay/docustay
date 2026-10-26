-- 0014_fix_super_admin_1_trigger_blind_spot
--
-- ★★★ A REAL LATENT BUG IN 0010, FOUND WHILE VERIFYING AN UNRELATED CLAIM.
--
-- [MEASURED 2026-09-12] inserting a Super Admin 1 into the PLATFORM tenant ITSELF was refused
-- with "Super Admin 1 may exist only in the platform tenant" — for a tenant whose `is_platform`
-- is `true`.
--
-- ══ THE MECHANISM: THE FOURTH SIGHTING OF THE SAME ONE ═════════════════════
-- `enforce_super_admin_1()` is SECURITY DEFINER, so it runs as **app_owner**. `keystone.tenant`
-- is **FORCE ROW LEVEL SECURITY** with the policy `id = keystone.current_tenant_id()`. FORCE
-- applies to the owner. So the trigger's
--     SELECT t.is_platform FROM keystone.tenant t WHERE t.id = NEW.tenant_id
-- returns **NO ROW** unless the caller's GUC already happens to equal `NEW.tenant_id`, and
-- `coalesce(NULL, false)` then refuses.
--
-- [EXECUTED] proof, as app_owner:
--     no GUC set                     → tenant_rows_visible = 0
--     GUC = that tenant              → tenant_rows_visible = 1
--
-- ★★ FORCE has now defeated, in order: a SECURITY DEFINER aggregate (0008), a privileged
-- migration's backfill (0010), a non-invoker view (a mutation that stayed green), and now a
-- SECURITY DEFINER **trigger**. It is the single most load-bearing decision in this schema, and
-- the recurring lesson is the same: **definer rights do not buy visibility against FORCE.**
--
-- ══ ★★★ AND THE PART THAT MATTERS MOST: WHY THE P5.4 GATE DID NOT CATCH IT ══
-- The gate set `keystone.tenant_id` to the tenant it was inserting into, every time — which is
-- exactly the one configuration in which the broken lookup works. **9/9 green, proving the
-- trigger works in the single arrangement it was tested in.** ★ A guard is only as general as
-- the states it is exercised in; "it passed" and "it is correct" are different claims, and the
-- gap between them is invisible until something outside the gate tries a different arrangement.
-- The new assertions below exercise the arrangement the gate never did.
--
-- ★ NOTE THE DIRECTION OF THE FAILURE: it refused a legitimate insert rather than admitting an
-- illegitimate one. It failed CLOSED. That is the right direction to be wrong in — but a
-- boundary that refuses the people it is meant to admit is the one that gets loosened by whoever
-- hits it next, which is how holes are made.

CREATE OR REPLACE FUNCTION keystone.enforce_super_admin_1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_platform   boolean;
  v_caller_tenant text;
BEGIN
  IF NEW.staff_role IS DISTINCT FROM 'super_admin_1' THEN
    RETURN NEW;
  END IF;

  v_caller_tenant := current_setting('keystone.tenant_id', true);

  BEGIN
    -- ★★ Adopt the ROW'S OWN tenant context for exactly one read. The same narrow, restored
    -- switch as keystone.account_seat_counts() (0008) — it uses the RLS mechanism rather than
    -- escaping it, and no BYPASSRLS role exists or is needed.
    -- ★ This is a read of ONE BOOLEAN about the tenant the row already claims to belong to. It
    -- discloses nothing: the caller supplied `NEW.tenant_id` themselves.
    PERFORM set_config('keystone.tenant_id', NEW.tenant_id::text, true);

    SELECT t.is_platform INTO v_is_platform
      FROM keystone.tenant t WHERE t.id = NEW.tenant_id;

    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
  EXCEPTION WHEN OTHERS THEN
    -- ★★ Restore on the error path too: a caller left holding another tenant's context would
    -- have cross-tenant read of every table for the rest of its transaction.
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
    RAISE;
  END;

  -- ★ A tenant that does not exist, or is not the platform, is refused identically. Still fails
  -- closed — NULL is not "probably fine".
  IF NOT coalesce(v_is_platform, false) THEN
    RAISE EXCEPTION 'Super Admin 1 may exist only in the platform tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION keystone.enforce_super_admin_1() IS
  'P5.4 / §K3 — the SERVER boundary for Super Admin 1. Reads tenant.is_platform under the ROW''s own tenant context, restored on every path: FORCE RLS means SECURITY DEFINER alone cannot see the tenant row (fixed 0014).';
