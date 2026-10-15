-- 0007_seat_counts_security_definer
--
-- ★★★ WRITTEN BECAUSE 0006's COUNTS VIEW WAS SAFE AND USELESS. [EXECUTED] its assertions:
--     ✓ no customer name in the row
--     ✓ the raw table returns ZERO rows to the platform tenant
--     ✗ total_seats is 3 ............ got 0
--
-- The view is `security_invoker = true` (§P1's rule), so its LEFT JOIN to `app_user` runs AS THE
-- CALLER — the platform tenant — and RLS correctly hides every row belonging to the customer's
-- tenant. The boundary held exactly as designed. ★ What it also did was make seat billing
-- impossible: you cannot count what you may not see.
--
-- ══ THE WRONG FIX, AND WHY ═════════════════════════════════════════════════
-- Setting `security_invoker = false` would make the view run as app_owner and the counts would
-- work immediately. It would also turn the view into "a hole straight through RLS" — §P1's exact
-- phrase — because a view is a query, and the next person to add a column to it adds that column
-- to the hole. The privilege would sit on a surface whose shape can change.
--
-- ══ THE RIGHT FIX: NARROW THE PRIVILEGED SURFACE UNTIL IT CANNOT LEAK ══════
-- ★★★ A `SECURITY DEFINER` function whose RETURN TYPE IS A ROW OF INTEGERS. It is privileged, but
-- it is structurally incapable of returning a name, an email or a person id — not by policy, by
-- type. Adding a name to its output would require editing this function and changing its
-- signature, which is visible in review and caught by a catalog check.
--
-- ★ And it still refuses to cross a boundary it has no business crossing: the caller must own the
-- ACCOUNT, which is checked with the caller's own tenant context BEFORE any privileged read.

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
-- ★ An empty search_path: a SECURITY DEFINER function that resolves unqualified names through a
-- caller-controlled search_path is the classic privilege-escalation footgun. Every name below is
-- schema-qualified.
SET search_path = ''
STABLE
AS $$
DECLARE
  v_customer_tenant uuid;
BEGIN
  -- ★★ THE AUTHORISATION CHECK, MADE WITH THE CALLER'S OWN CONTEXT, BEFORE ANY PRIVILEGED READ.
  -- This SELECT is subject to RLS on `account` (the function is definer-rights, but the policy
  -- predicate still evaluates keystone.current_tenant_id(), which is the CALLER's GUC). So a
  -- caller can only resolve accounts its own tenant owns.
  SELECT a.customer_tenant_id INTO v_customer_tenant
    FROM keystone.account a
   WHERE a.id = p_account_id
     AND a.tenant_id = keystone.current_tenant_id();

  IF NOT FOUND THEN
    -- ★ Identical outcome for "no such account" and "not yours": returning a distinguishable
    -- error would let a caller enumerate account ids belonging to other tenants.
    RETURN;
  END IF;

  IF v_customer_tenant IS NULL THEN
    -- An account with no Keystone tenant behind it has no seats. Zeroes, not NULLs — a NULL here
    -- reads as "unknown" and invoices badly.
    RETURN QUERY SELECT 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  -- ★ The privileged read. Its output columns are integers; there is no shape in which a name
  -- could travel back to the caller.
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE u.role = 'staff')::integer,
    count(*) FILTER (WHERE u.role = 'adult_client')::integer,
    count(*) FILTER (WHERE u.role = 'adolescent_client')::integer,
    count(*) FILTER (WHERE u.role = 'parent')::integer,
    count(u.id)::integer
  FROM keystone.app_user u
  WHERE u.tenant_id = v_customer_tenant;
END $$;

COMMENT ON FUNCTION keystone.account_seat_counts(uuid) IS
  'P5.5 / §A3 — COUNTS, NEVER NAMES. SECURITY DEFINER, but the return type is five integers: structurally incapable of returning a name. Authorises against the CALLER''s tenant before reading.';

-- ★ Only app_rw may call it. PUBLIC must not — a SECURITY DEFINER function granted to PUBLIC is
-- callable by any role that ever gains a connection.
REVOKE ALL ON FUNCTION keystone.account_seat_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.account_seat_counts(uuid) TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rebuild the view on top of the function, so there is ONE implementation of the rule.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS keystone.account_people_counts;

CREATE VIEW keystone.account_people_counts
WITH (security_invoker = true) AS
SELECT
  a.id        AS account_id,
  a.tenant_id AS tenant_id,
  a.name      AS account_name,
  c.staff_seats,
  c.adult_client_seats,
  c.adolescent_client_seats,
  c.parent_seats,
  c.total_seats
FROM keystone.account a
CROSS JOIN LATERAL keystone.account_seat_counts(a.id) c;

COMMENT ON VIEW keystone.account_people_counts IS
  'P5.5 — a convenience wrapper over account_seat_counts(). security_invoker so the ACCOUNT rows are still RLS-filtered; the counts come from the narrow definer function.';

GRANT SELECT ON keystone.account_people_counts TO app_rw;
