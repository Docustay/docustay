-- 0063 — THE PLATFORM CONSOLE'S PROVISIONING SCREEN HAS NEVER BEEN ABLE TO RETURN A ROW.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT, MEASURED 2026-09-14 AT P21D.1.
--     `GET /api/platform/provisioning`, called with a correct PLATFORM principal against a real
--     platform tenant, answers **403 "insufficient privilege"** — SQLSTATE 42501 raised by Postgres,
--     not by any middleware. NAV row 71 (/platform/provisioning) is marked ✅ read+write in Part B and
--     is, in fact, unreachable for every identity that is allowed to ask for it.
--
--     `keystone.platform_list_provisioning_runs()` is SECURITY DEFINER owned by `auth_owner` with an
--     empty search_path, and it reads `keystone.provisioning_run` and `keystone.provisioning_step`:
--
--       SELECT has_table_privilege('auth_owner','keystone.provisioning_run','SELECT');   -- f
--       SELECT has_table_privilege('auth_owner','keystone.provisioning_step','SELECT');  -- f
--
--     and neither table carries an `auth_owner` policy. So BOTH halves of the two-mechanism rule that
--     migration 0017 spells out are missing, and the function fails at the first one.
--
-- ★★ THE SIBLING FUNCTION WORKS, WHICH IS WHY THIS SURVIVED. `platform_list_tenants()` returns rows
--    because `keystone.tenant` was given exactly this pair at 0017:54-57 — GRANT SELECT TO auth_owner,
--    plus `tenant_health_read FOR SELECT TO auth_owner USING (true)`. Two adjacent routes, one wired
--    and one not, and only a call with the right principal can tell them apart. P21C.2 called this
--    route but classified `/api/platform/*` as a different principal shape and never made a real
--    platform call, so the 403 read as "expected for this shape".
--
-- ★★★ THE SAME TWO MECHANISMS, FOR THE SAME REASON, QUOTED FROM 0017 SO IT IS NOT RE-LEARNED:
--     "A POLICY IS NOT A PRIVILEGE. RLS narrows what a role may see among the rows it is ALREADY
--      entitled to read. It cannot grant entitlement." — and the reverse mistake (GRANT with no
--      policy) fails as ZERO ROWS, silently, which would read as "there are no provisioning runs".
--     Both are therefore written here, together, for both tables.
--
-- ★ WHY A `USING (true)` POLICY IS SAFE HERE, ON THE RULE P21A.2 DERIVED:
--     a policy with no tenant predicate may be granted only to a role that CANNOT LOG IN and that no
--     login role can SET ROLE to. [MEASURED 2026-09-14]
--       auth_owner: rolcanlogin = f, rolbypassrls = f
--       members of auth_owner: keystone_admin, app_owner — and app_owner is rolcanlogin = f
--     No LOGIN role can reach it. The only way in is through a SECURITY DEFINER function owned by it,
--     and that function's own body carries the gate: `WHERE keystone.caller_is_platform()`.
--
-- ★ FOR SELECT AND NOTHING ELSE. auth_owner must never be able to INSERT, UPDATE or DELETE a
--   provisioning run or step. A read-only escape for a read-only question — the same shape as
--   tenant_health_read, deliberately, so there is one pattern to review rather than two.

GRANT SELECT ON keystone.provisioning_run  TO auth_owner;
GRANT SELECT ON keystone.provisioning_step TO auth_owner;

CREATE POLICY provisioning_run_platform_read ON keystone.provisioning_run
  FOR SELECT TO auth_owner USING (true);

CREATE POLICY provisioning_step_platform_read ON keystone.provisioning_step
  FOR SELECT TO auth_owner USING (true);

COMMENT ON POLICY provisioning_run_platform_read ON keystone.provisioning_run IS
  'P21D.1 (2026-09-14) — admits ONLY auth_owner, ONLY for SELECT, so keystone.platform_list_provisioning_runs() can see every tenant''s runs. The platform console has no single tenant context by construction, and FORCE RLS means even the table owner sees nothing. The gate is inside the function (WHERE keystone.caller_is_platform()), not here. Before this migration the function raised 42501 and GET /api/platform/provisioning was 403 for every caller. Never widen this to another role or another verb.';

COMMENT ON POLICY provisioning_step_platform_read ON keystone.provisioning_step IS
  'P21D.1 (2026-09-14) — the step half of provisioning_run_platform_read. The lister counts steps per run (total / succeeded / failed), so without this the function reads zero steps and every run would report 0/0/0 — which looks like a run that did nothing rather than a permission it does not have.';

-- ★ COMMENT ON FUNCTION requires OWNERSHIP, and this function is owned by auth_owner, not by the
--   migration role. [EXECUTED: without the SET ROLE this migration failed with "must be owner of
--   function keystone.platform_list_provisioning_runs" and rolled back — correctly.] The migration
--   role is a MEMBER of auth_owner, so it may assume it; `SET LOCAL` keeps the change inside this
--   migration's transaction, so nothing after it runs as the wrong identity even if it throws.
--   ★★ It is done AFTER the grants and policies, which need the TABLE owner's rights and which
--      auth_owner does not have. Doing it first would fail in the opposite direction.
SET LOCAL ROLE auth_owner;

COMMENT ON FUNCTION keystone.platform_list_provisioning_runs() IS
  'The platform console''s provisioning list. SECURITY DEFINER as auth_owner, gated on keystone.caller_is_platform(). ★ It needs BOTH a GRANT and an RLS policy on provisioning_run and provisioning_step; it had NEITHER from the day it was written until migration 0063 (2026-09-14), and therefore never returned a row — GET /api/platform/provisioning answered 403 "insufficient privilege". Its sibling platform_list_tenants() worked only because keystone.tenant got that pair at migration 0017. If a new platform lister is added, give it the same two mechanisms on every table it touches and CALL IT with a real platform principal before believing it works.';

RESET ROLE;
