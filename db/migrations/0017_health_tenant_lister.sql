-- 0017_health_tenant_lister
-- P12.6 — the fourth readiness probe · groundwork for P13.0b (ADDENDUM 4 A4.1)
--
-- ★★★ THE PROBLEM, AND IT IS THE D2.1 FINDING ARRIVING EARLY.
-- `readyz`'s fourth check must assert that EVERY tenant carries a resolvable IANA timezone —
-- a wrong one silently shifts every booking that tenant ever makes. To assert "every", it has
-- to SEE every. But `keystone.tenant` is ENABLE + FORCE ROW LEVEL SECURITY under
--     CREATE POLICY tenant_isolation ON keystone.tenant USING (id = keystone.current_tenant_id())
-- (0001:149-158), and the health probe has NO tenant context — it is a process-level check, not
-- a request. So as `app_rw` it sees ZERO ROWS.
--
-- ★★ AND ZERO ROWS IS THE DANGEROUS ANSWER, NOT AN ERROR. Zero rows means zero INVALID rows,
-- so the check would have reported `timezone ok — 0 tenant(s)` forever. That is F2's exact
-- shape: a number that looks like a measurement and is the absence of one. It is also 0010's
-- backfill lesson ("its zero means nothing") in a third place.
--
-- ★★★ AND `SECURITY DEFINER` ALONE DOES NOT FIX IT — THIS IS THE PART THAT IS EASY TO GET WRONG.
-- 0008:8-16 MEASURED it: FORCE applies the policy TO THE TABLE OWNER TOO, so a definer function
-- owned by `app_owner` — the owner of `keystone.tenant` — is STILL FILTERED and still returns
-- nothing. "Make it SECURITY DEFINER" is the obvious fix and it is inert here.
--
-- ★★★ WHAT ACTUALLY WORKS, AND WHY IT IS NOT A HOLE:
--   · the function is owned by `auth_owner`, which is NOT the owner of keystone.tenant, so the
--     policies are what decide — and
--   · an EXPLICIT, NAMED, SELECT-ONLY policy admits exactly that one role.
-- Two independent things had to be written down for this to read anything, and both are visible
-- in the catalog. There is no implicit bypass anywhere in it.
--
-- ★★ WHY THIS IS SAFE:
--   · `auth_owner` is NOLOGIN, NOBYPASSRLS, not superuser, and `app_rw` is NOT a member of it —
--     so app_rw cannot SET ROLE to it and read the table directly.
--   · the function's RETURN TYPE carries id, slug and timezone AND NOTHING ELSE. This is the
--     0007/0008 `account_seat_counts` argument — "a return type too narrow to carry a leak" —
--     made with three operational columns instead of five integers. There is no shape in which
--     a tenant's name, status, or any business row travels back through it.
--   · it is STABLE and takes NO arguments, so it cannot be steered at a particular tenant.
--
-- ★ NUMBERING NOTE: BUILD-UI.md calls P13.0's migration "0017a" and P13.0b's "0017b". This file
-- takes 0017 because P12.6 needs it first and migrations are applied in lexicographic order
-- (db/migrate.mjs:52-55). P13's two become 0018a and 0018b. Recorded in HANDOFF §DECISIONS.

-- ─────────────────────────────────────────────────────────────────────────────
-- The policy. SELECT ONLY, one named role, and it does not touch tenant_isolation.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ `FOR SELECT` and nothing else: auth_owner must never be able to INSERT, UPDATE or DELETE a
--   tenant. A read-only escape for a read-only question.
-- ★★★ TWO SEPARATE MECHANISMS, AND BOTH ARE REQUIRED. A POLICY IS NOT A PRIVILEGE.
-- RLS narrows what a role may see among the rows it is ALREADY entitled to read. It cannot
-- grant entitlement. With the policy alone the definer function fails with
--   `permission denied for table tenant`   [EXECUTED: it did]
-- ★ Which is the reassuring direction to fail in — but worth naming, because the reverse
--   mistake (GRANT without a policy) fails as ZERO ROWS, silently, and would have been read
--   as "there are no tenants".
GRANT SELECT ON keystone.tenant TO auth_owner;

CREATE POLICY tenant_health_read ON keystone.tenant
  FOR SELECT TO auth_owner USING (true);

COMMENT ON POLICY tenant_health_read ON keystone.tenant IS
  'P12.6 — admits ONLY auth_owner, ONLY for SELECT, so keystone.tenant_timezones_for_health() can see every tenant. The readiness probe has no tenant context by construction, and FORCE RLS means even the table owner sees nothing (0008:8-16). Never widen this to another role or another verb.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The resolver. SECURITY DEFINER, owned by auth_owner, empty search_path.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ CREATED *AS* auth_owner, NOT CREATED-THEN-TRANSFERRED. THIS ORDER IS LOAD-BEARING AND THE
-- OBVIOUS ONE IS SILENTLY WRONG. Writing it as
--     CREATE FUNCTION … ; REVOKE … FROM PUBLIC; GRANT EXECUTE TO app_rw, app_owner;
--     ALTER FUNCTION … OWNER TO auth_owner;
-- LOOKS equivalent and is not. While app_owner is the owner, a `GRANT EXECUTE TO app_owner` is
-- indistinguishable from the owner's own implicit ACL entry, so Postgres folds the two together —
-- and `ALTER … OWNER TO` then REWRITES that entry to the NEW owner and the grant is GONE.
-- [EXECUTED, in a rolled-back probe transaction] immediately after the transfer:
--     current_user=app_owner  has_function_privilege(…,'EXECUTE') = FALSE
-- despite the GRANT having succeeded four statements earlier. ★ A privilege that disappears
-- during an ALTER, with no error at the GRANT and no error at the ALTER, is exactly the class of
-- silent failure this project keeps meeting. SET ROLE first; there is nothing to transfer.
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.tenant_timezones_for_health()
RETURNS TABLE (id uuid, slug text, timezone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- ★★ `SET search_path = ''` is not decoration. A SECURITY DEFINER function without it can be
--    hijacked by a caller who puts a shadowing object earlier on their own search_path, and it
--    then runs that object with the definer's privileges. Every identifier below is fully
--    qualified because of it.
SET search_path = ''
AS $$
  SELECT t.id, t.slug, t.timezone FROM keystone.tenant t ORDER BY t.slug
$$;

-- ★★ REVOKE FROM PUBLIC FIRST. Postgres grants EXECUTE to PUBLIC on a new function by DEFAULT —
--    so a definer function is world-callable the instant it is created unless this line runs.
--    That default is the single most common way a SECURITY DEFINER function becomes a hole.
REVOKE ALL ON FUNCTION keystone.tenant_timezones_for_health() FROM PUBLIC;
-- ★ app_rw is the caller that matters. app_owner is granted too ONLY so the positive control
--   at the foot of this migration can run at all — without it the DO block fails with
--   `permission denied for function` [EXECUTED: it did], and a migration that creates a
--   resolver it cannot call has shipped a hope. app_owner is NOLOGIN and reachable only from
--   the migrate connection, which is already superuser, so this grants no new reachable power.
GRANT EXECUTE ON FUNCTION keystone.tenant_timezones_for_health() TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.tenant_timezones_for_health() IS
  'P12.6 readiness probe 4. Returns id, slug and timezone for EVERY tenant and nothing else — the return type IS the safety argument (cf. account_seat_counts, 0007/0008). Owned by auth_owner so the tenant_health_read policy applies instead of app_owner''s forced tenant_isolation.';

-- ★★★ `SET LOCAL ROLE app_owner`, NEVER `RESET ROLE`. RESET ROLE returns to the SESSION role,
-- and db/migrate.mjs:93 establishes app_owner with a session-level `SET ROLE` from a connection
-- whose session_user is the SUPERUSER. So `RESET ROLE` here lands on the superuser, silently,
-- for the remainder of the migration. [EXECUTED] the negative control below caught it exactly:
-- "a direct read with no tenant context returned 5 row(s)" — a superuser bypassing RLS, which
-- would have been read as a broken tenant_isolation policy. ★ Name the role you want.
SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE IT, IN THE MIGRATION, IN BOTH DIRECTIONS.
-- A migration that creates a resolver and does not call it has shipped a hope.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n_direct integer; n_fn integer;
BEGIN
  -- NEGATIVE: the ordinary path still sees nothing without context. If this is ever non-zero,
  -- tenant_isolation has been broken and the policy above is not the reason this works.
  SELECT count(*) INTO n_direct FROM keystone.tenant;
  IF n_direct <> 0 THEN
    RAISE EXCEPTION
      'tenant_isolation is not filtering app_owner: a direct read with no tenant context returned % row(s). The health resolver would be masking a broken policy.', n_direct;
  END IF;

  -- POSITIVE CONTROL: the resolver must actually return rows, or its zero means nothing.
  SELECT count(*) INTO n_fn FROM keystone.tenant_timezones_for_health();
  IF n_fn = 0 THEN
    RAISE EXCEPTION
      'tenant_timezones_for_health() returned ZERO rows. Either there are no tenants, or the definer/policy pair does not work — and a probe that cannot see its subject can never clear it.';
  END IF;

  RAISE NOTICE 'health tenant lister: direct read sees % row(s) (correct), resolver sees % tenant(s)', n_direct, n_fn;
END $$;
