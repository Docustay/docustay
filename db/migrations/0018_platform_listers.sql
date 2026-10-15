-- 0018_platform_listers
-- P12.12 — the two ✅ PLATFORM rows: /platform/tenants and /platform/provisioning
--
-- ★★★ THE PROBLEM P12.12 DOES NOT MENTION, AND IT MAKES TWO OF ITS FOUR ROWS UNBUILDABLE AS
-- WRITTEN. Part B marks `/platform/tenants` and `/platform/provisioning` ✅ — "table exists AND a
-- read path exists in src/". Both are true. But a PLATFORM view of them is inherently
-- CROSS-TENANT, and `keystone.tenant` and `keystone.provisioning_run` are FORCE RLS under
-- `tenant_id = current_tenant_id()`. So the platform screen, running in any tenant context
-- whatsoever — including the platform tenant's own — sees exactly ONE tenant and its OWN runs.
-- ★★ It would not error. It would render a one-row list, and look like a working platform
-- console for a platform with one customer. That is this project's signature failure shape.
--
-- ★ BUILD-UI.md sees the same wall from the worker's side at P18.6(e) — "claim_events filters on
--   current_tenant_id() and keystone.tenant is itself FORCE RLS, so app_rw with no context sees
--   ZERO tenants … A SECURITY DEFINER tenant-lister in keystone_auth, gated." It schedules that
--   for PHASE 18 and ADDENDUM 4 never specifies it. P12.12 needs it now.
--
-- ★★★ AND "GATED" IS THE WHOLE DESIGN, SO HERE IS WHAT GATES IT.
-- The obvious version — a definer function that returns every tenant, EXECUTE granted to app_rw —
-- makes "list every tenant on the platform" reachable from any SQL-injection anywhere in the
-- application. The HTTP layer refuses non-platform callers (P12.16), but §K3's own rule is that
-- a check in front of the data is not the boundary; the database has to decide.
--
-- ★★ SO THE GATE IS IN THE SQL, AND IT IS CHECKABLE BY THE DATABASE ALONE:
--        current_tenant_id() must be the tenant whose is_platform is true.
-- A platform principal runs inside the PLATFORM tenant's context, so it passes. Any other
-- tenant's context returns ZERO ROWS — not an error, and not a partial list.
-- ★ `tenant_single_platform_idx` (0010:22) makes "the platform tenant" singular, so the
--   subquery below cannot match two rows. The uniqueness is what makes this gate well-defined.

SET LOCAL ROLE auth_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★ Is the CURRENT context the platform tenant? One place, so the two listers cannot drift.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.caller_is_platform()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone.tenant t
     WHERE t.is_platform AND t.id = keystone.current_tenant_id()
  )
$$;

-- ★★ RETURNS boolean AND NOTHING ELSE. It answers exactly one yes/no question about the caller's
--    OWN context, so there is no shape in which another tenant's row travels back through it —
--    the 0007/0008 "return type too narrow to carry a leak" argument at its narrowest.
--    ★ In particular it does NOT return the platform tenant's id: that would let any caller
--      learn it, and it is the one value this whole gate turns on.
REVOKE ALL ON FUNCTION keystone.caller_is_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.caller_is_platform() TO app_rw, app_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- /platform/tenants
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.platform_list_tenants()
RETURNS TABLE (id uuid, slug text, name text, timezone text, status text, is_platform boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id, t.slug, t.name, t.timezone, t.status, t.is_platform
    FROM keystone.tenant t
   -- ★★★ THE GATE. Not an `if` in a route — a predicate the database evaluates on every call.
   --     A non-platform context yields zero rows here, silently and correctly.
   WHERE keystone.caller_is_platform()
   ORDER BY t.is_platform DESC, t.slug
$$;
REVOKE ALL ON FUNCTION keystone.platform_list_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_tenants() TO app_rw, app_owner;

-- ★ NO BUSINESS DATA IN THE RETURN TYPE. Operational identity only — what a platform console
--   must show to route an operator to the right place. Nothing about the tenant's people, money
--   or documents can travel through this signature.
COMMENT ON FUNCTION keystone.platform_list_tenants() IS
  'P12.12 — the cross-tenant tenant list for /platform/tenants. Gated on caller_is_platform(): any other tenant context returns zero rows. Operational columns only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- /platform/provisioning
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.platform_list_provisioning_runs()
RETURNS TABLE (
  id uuid, tenant_id uuid, tenant_slug text, requested_slug text, state text,
  created_at timestamptz, step_count integer, succeeded integer, failed integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  -- ★ `requested_slug`, not `slug`. [MEAS] provisioning_run is
  --   (id, tenant_id, requested_slug, requested_name, state, created_at, updated_at, completed_at)
  --   — there is no `slug` column, and the first draft of this function assumed one. The route
  --   layer must not guess at a shape; dump the columns.
  SELECT r.id, r.tenant_id, t.slug, r.requested_slug, r.state, r.created_at,
         count(s.id)::int,
         count(s.id) FILTER (WHERE s.state = 'succeeded')::int,
         count(s.id) FILTER (WHERE s.state = 'failed')::int
    FROM keystone.provisioning_run r
    LEFT JOIN keystone.tenant t ON t.id = r.tenant_id
    LEFT JOIN keystone.provisioning_step s ON s.run_id = r.id
   WHERE keystone.caller_is_platform()
   GROUP BY r.id, r.tenant_id, t.slug, r.requested_slug, r.state, r.created_at
   ORDER BY r.created_at DESC
$$;
REVOKE ALL ON FUNCTION keystone.platform_list_provisioning_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_provisioning_runs() TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.platform_list_provisioning_runs() IS
  'P12.12 — cross-tenant provisioning runs for /platform/provisioning. Same caller_is_platform() gate. Counts only; no step payloads and no last_error, which can carry a vendor response.';

SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE THE GATE, BOTH DIRECTIONS, IN THE MIGRATION.
-- A gate nobody has seen refuse is not installed.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ THE PROBE NEEDS A PLATFORM TENANT AND app_owner CANNOT INSERT ONE.
-- keystone.tenant is FORCE RLS with `tenant_insert WITH CHECK (tenant_id = require_tenant_id())`,
-- and a migration sets no GUC — so the owner is refused with "new row violates row-level security
-- policy" [EXECUTED: it was]. 0010:52-75 met this exact wall and established the house pattern:
-- suspend FORCE for the bootstrap, restore it in the SAME transaction, and ASSERT it came back.
-- ★ FORCE is never off outside this transaction, and the assertion below proves it.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE v_platform uuid; v_other uuid; n integer; created boolean := false;
BEGIN
  SELECT id INTO v_platform FROM keystone.tenant WHERE is_platform;
  IF v_platform IS NULL THEN
    -- ★ No platform tenant exists yet on this database. Create a temporary one so the proof can
    --   run, and remove it again — a migration that skips its own proof because the fixture is
    --   missing has proven nothing, which is 0010's lesson.
    INSERT INTO keystone.tenant (slug, name, timezone, status, is_platform)
    VALUES ('m0018-platform-probe', 'Migration 0018 probe', 'UTC', 'active', true)
    RETURNING id INTO v_platform;
    created := true;
  END IF;
  SELECT id INTO v_other FROM keystone.tenant WHERE NOT is_platform LIMIT 1;

  -- POSITIVE: inside the platform tenant's context the lister returns rows.
  PERFORM set_config('keystone.tenant_id', v_platform::text, true);
  SELECT count(*) INTO n FROM keystone.platform_list_tenants();
  IF n = 0 THEN
    RAISE EXCEPTION 'platform_list_tenants() returned ZERO rows from the PLATFORM context — the lister does not work, and a zero here would have read as "no tenants".';
  END IF;
  RAISE NOTICE 'platform lister: platform context sees % tenant(s)', n;

  -- NEGATIVE: from any other tenant's context it must return NOTHING.
  IF v_other IS NOT NULL THEN
    PERFORM set_config('keystone.tenant_id', v_other::text, true);
    SELECT count(*) INTO n FROM keystone.platform_list_tenants();
    IF n <> 0 THEN
      RAISE EXCEPTION 'platform_list_tenants() returned % row(s) from a NON-platform tenant context — the gate does not gate.', n;
    END IF;
    RAISE NOTICE 'platform lister: non-platform context sees 0 tenants (correct)';
  ELSE
    RAISE EXCEPTION 'no non-platform tenant exists, so the NEGATIVE leg could not run — a gate proven in one direction only is not proven.';
  END IF;

  -- ★ AND WITH NO CONTEXT AT ALL — the worker/no-session case.
  PERFORM set_config('keystone.tenant_id', '', true);
  SELECT count(*) INTO n FROM keystone.platform_list_tenants();
  IF n <> 0 THEN
    RAISE EXCEPTION 'platform_list_tenants() returned % row(s) with NO tenant context.', n;
  END IF;

  IF created THEN
    DELETE FROM keystone.tenant WHERE id = v_platform;
  END IF;
END $$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON. Leaving it off would silently disable tenant isolation on the root
--    table of the whole schema, and every subsequent migration and every gate would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
