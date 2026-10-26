-- 0505 — platform_tenant_id
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY. The n8n WORKFLOW-ERROR callback (the reserved-key branch of
--     src/routes/automationsCallback.mjs) has no tenant to run under — it is an internal platform
--     alert, not an act inside any practice — so it used a hardcoded placeholder
--     `const tenantId = "keystone-system";`, which is not a uuid and cannot be passed to
--     `withTenant()`. This function gives that call site (and any other pre-tenant caller that
--     needs the ONE platform tenant's real id) a safe, narrow way to ask for it.
--
-- ★★ MODELLED ON `keystone.resolve_tenant_by_slug` (0020_keystone_auth.sql:197-212) for the SAME
--    reason: this runs BEFORE any tenant context exists, so it cannot depend on
--    `keystone.current_tenant_id()` the way `keystone.caller_is_platform()` (0018) does — there is
--    no caller tenant yet, only a caller who needs to find the platform one. RETURNS uuid and
--    nothing else: the return type is the whole safety argument, same as `resolve_tenant_by_slug`.
--
-- ★ `tenant_single_platform_idx` (0010_staff_roles_and_super_admin_1.sql:22 —
--   `CREATE UNIQUE INDEX tenant_single_platform_idx ON keystone.tenant (is_platform) WHERE
--   is_platform`) guarantees at most one row can ever have `is_platform = true`, so `LIMIT 1` never
--   hides a second candidate — it is a belt on a suspender the index already holds. NULL when no
--   tenant is marked platform yet (a fresh environment before provisioning), never an error: the
--   caller decides what "no platform tenant configured" means for its own request.
--
-- ★★★ SECURITY DEFINER + `SET search_path = ''`, schema-qualified body, same pattern as every
--     neighbouring definer (0503's `seed_living_segments`, 0020's `resolve_tenant_by_slug`) —
--     `db/gates/p21a_definer_search_path.mjs` requires the EMPTY search_path specifically (a path
--     of `keystone, pg_temp` is a caller-influenceable value the gate refuses, not a safe pin).
--
-- ★ REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO `app_rw` (the real caller — a pre-tenant
--   `withCredentialLookup` connection) AND `app_owner`, same as every neighbouring platform definer
--   (0018_platform_listers.sql:52,69,103 grants each of `caller_is_platform`,
--   `platform_list_tenants`, `platform_list_provisioning_runs` to BOTH roles) — a migration's own
--   self-check below runs as `app_owner` (db/migrate.mjs:179) and needs to call this function to
--   prove it works, exactly the reason those three are granted to app_owner too. Never `app_signup`.
--
-- ★★★ MEASURED, running this migration locally: `keystone.tenant` is FORCE ROW LEVEL SECURITY
--     (0001:149-150) with only ONE unconditional-read policy, `tenant_health_read USING (true)`,
--     and it is granted to `auth_owner` alone (`polroles = {auth_owner}` — checked with
--     `SELECT polroles::regrole[] FROM pg_policy WHERE polrelid='keystone.tenant'::regclass`).
--     A function created while running as `app_owner` (db/migrate.mjs's own role, :179) is owned
--     by `app_owner`, which holds NO such policy — `tenant_isolation` alone applies to it, and that
--     is false with no GUC set. So a first version of this function, left under `app_owner`,
--     returned NULL for every row even with a real platform tenant present: SECURITY DEFINER alone
--     does not cross FORCE RLS (0014's own header names exactly this). `resolve_tenant_by_slug`
--     (0020_keystone_auth.sql:53-68, 197-212) reads `keystone.tenant` the same pre-tenant way and
--     works — because 0020 explicitly `SET LOCAL ROLE auth_owner`S first, so ITS function is owned
--     by the one role `tenant_health_read` names. This migration does the same, for the same reason.
-- ★ Do NOT apply this migration here — migrations are applied separately, at step 3 of the build
--   process, through the runner (`node db/migrate.mjs`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.platform_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id FROM keystone.tenant t WHERE t.is_platform LIMIT 1
$$;

REVOKE ALL ON FUNCTION keystone.platform_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_tenant_id() TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.platform_tenant_id() IS
  '0505 — the ONE platform tenant''s id, for a caller with no tenant context yet (the n8n workflow-error callback). RETURNS uuid and nothing else; NULL if no tenant is marked is_platform. Owned by auth_owner so tenant_health_read (USING true) lets it see the row past FORCE RLS on keystone.tenant — see this migration''s own header.';

SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — modelled on 0503's own self-check for `keystone.seed_living_segments`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $platform_tenant_id_self_check$
BEGIN
  IF to_regprocedure('keystone.platform_tenant_id()') IS NULL THEN
    RAISE EXCEPTION '0505: keystone.platform_tenant_id() does not exist';
  END IF;

  -- ★★★ THE EXACT DEFECT MEASURED ABOVE: wrong owner reads back NULL for every row, silently.
  --     `resolve_tenant_by_slug` (0020) is the only other pre-tenant reader of keystone.tenant and
  --     it is owned by auth_owner for this same reason — checked here so a future edit that drops
  --     the `SET LOCAL ROLE auth_owner` above fails LOUDLY at migration time, not silently at runtime.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.oid = 'keystone.platform_tenant_id()'::regprocedure AND r.rolname = 'auth_owner'
  ) THEN
    RAISE EXCEPTION '0505: keystone.platform_tenant_id must be owned by auth_owner — tenant_health_read '
      'is the only unconditional-read policy on keystone.tenant and it names only that role; any other '
      'owner reads back NULL for every row, past FORCE RLS, with no error at all';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'keystone.platform_tenant_id()'::regprocedure) THEN
    RAISE EXCEPTION '0505: keystone.platform_tenant_id is not SECURITY DEFINER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc, unnest(coalesce(proconfig, ARRAY[]::text[])) AS cfg
     WHERE oid = 'keystone.platform_tenant_id()'::regprocedure
       AND cfg = 'search_path=""'
  ) THEN
    RAISE EXCEPTION '0505: keystone.platform_tenant_id does not have search_path pinned to '''' ';
  END IF;

  IF NOT has_function_privilege('app_rw', 'keystone.platform_tenant_id()', 'EXECUTE') THEN
    RAISE EXCEPTION '0505: app_rw is missing EXECUTE on keystone.platform_tenant_id — the n8n error callback would still fail';
  END IF;

  -- ★ Positive control: PUBLIC holds no privilege at all — the grant is the only path in.
  IF has_function_privilege('public', 'keystone.platform_tenant_id()', 'EXECUTE') THEN
    RAISE EXCEPTION '0505: PUBLIC must NOT hold EXECUTE on keystone.platform_tenant_id';
  END IF;
END
$platform_tenant_id_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ FUNCTIONAL CHECK — CALL IT, DO NOT ONLY INSPECT STRUCTURE (same discipline as P21A.6's own
--     U11 leg). `tenant_single_platform_idx` (0010) guarantees at most one is_platform row exists
--     in the whole database, so this proves the REAL case in whichever environment it runs.
--   ★ THE PROBE ITSELF NEEDS TO SEE/INSERT ACROSS `keystone.tenant`'S OWN RLS, and this migration
--     runs as `app_owner` (the table owner), which has NO unconditional read or write policy of its
--     own — `tenant_isolation` alone applies to it. 0018_platform_listers.sql met this exact wall
--     and established the house pattern this migration copies verbatim, DDL statements OUTSIDE the
--     PL/pgSQL block exactly as 0018 does it: suspend FORCE for the bootstrap, restore it in the
--     SAME transaction, and ASSERT it came back — never leave it off outside this transaction.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $platform_tenant_id_functional_check$
DECLARE
  v_existing uuid;
  v_temp     uuid;
BEGIN
  SELECT id INTO v_existing FROM keystone.tenant WHERE is_platform LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF keystone.platform_tenant_id() IS DISTINCT FROM v_existing THEN
      RAISE EXCEPTION '0505: keystone.platform_tenant_id() returned % but the actual platform tenant is % — FORCE RLS is still hiding the row',
        keystone.platform_tenant_id(), v_existing;
    END IF;
  ELSE
    -- No platform tenant exists in this environment yet — prove the function finds one the moment
    -- it does, then remove the probe row so this migration leaves no state behind.
    INSERT INTO keystone.tenant (slug, name, timezone, status, is_platform)
      VALUES ('zz-0505-selfcheck', 'zz-0505-selfcheck', 'UTC', 'active', true)
      RETURNING id INTO v_temp;
    IF keystone.platform_tenant_id() IS DISTINCT FROM v_temp THEN
      DELETE FROM keystone.tenant WHERE id = v_temp;
      RAISE EXCEPTION '0505: keystone.platform_tenant_id() did not find the platform tenant just created — this is the exact defect the migration exists to fix';
    END IF;
    DELETE FROM keystone.tenant WHERE id = v_temp;
  END IF;
END
$platform_tenant_id_functional_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON, same as 0018's own restore-assertion — leaving it off would silently
--    disable tenant isolation on the root table of the whole schema.
DO $platform_tenant_id_force_restored$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.tenant'::regclass) THEN
    RAISE EXCEPTION '0505: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END
$platform_tenant_id_force_restored$;
