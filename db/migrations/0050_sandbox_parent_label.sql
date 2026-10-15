-- 0050 — a sandbox can learn its PARENT'S NAME. Fixes a U30 defect found by P19.10's own gate.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT, MEASURED BY THE GATE THAT WAS MEANT TO PROVE THE FEATURE WORKED.
--     `sandboxInfo()` built its banner with `LEFT JOIN keystone.tenant l ON l.id = t.sandbox_of`, run
--     inside the SANDBOX's tenant context. `keystone.tenant` is FORCE RLS scoped to
--     `id = current_tenant_id()`, so the joined row was invisible and `l.slug` came back NULL.
--     **The banner rendered "Sandbox of null".**
--   ★ That is U30 exactly — a label that shows a machine value to a human — and it is the same family
--     as the i18n echo (`userType.pir` on screen) that CLAUDE.md spends a section on. RLS was working
--     perfectly; the query was asking it for something it must not give.
--
-- ★★ WHY A DEFINER FUNCTION RATHER THAN DENORMALISING THE NAME ONTO THE SANDBOX ROW:
--    a copied name drifts the moment the live practice renames itself, and then the banner lies
--    quietly forever. A function reads the current truth.
--  ★★★ AND WHY IT IS SAFE, STATED PRECISELY: it returns the name of **exactly one** tenant — the one
--      THIS tenant declares itself the sandbox of. It cannot be pointed anywhere else: there is no
--      parameter. A caller in a live tenant gets NULL, because a live tenant has no parent.
--    ★ It returns `text`, not a uuid, and that is FINE — the narrow-return rule in
--      catalog-conformance's check 10 is about CREDENTIAL RESOLVERS on the pre-tenant path. This runs
--      after withTenant() has opened and returns a practice's own display name.

SET LOCAL ROLE app_owner;

CREATE OR REPLACE FUNCTION keystone.sandbox_parent_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT parent.name
    FROM keystone.tenant me
    JOIN keystone.tenant parent ON parent.id = me.sandbox_of
   WHERE me.id = keystone.current_tenant_id()
$$;
-- ★★★ REVOKE FIRST, THEN GRANT. Postgres grants EXECUTE to PUBLIC on every new function by default.
REVOKE ALL ON FUNCTION keystone.sandbox_parent_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.sandbox_parent_name() TO app_rw;

COMMENT ON FUNCTION keystone.sandbox_parent_name() IS
  'The display name of the live tenant THIS tenant is the sandbox of, or NULL when this tenant is '
  'live. Takes no argument on purpose: it can only ever read the one parent the current tenant '
  'declares, so it cannot be aimed at another tenant. Exists because reading the parent row through a '
  'join inside the sandbox''s own context is correctly refused by FORCE RLS, which made the banner '
  'render "Sandbox of null".';

RESET ROLE;
