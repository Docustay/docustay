-- 0221_sandbox_platform_write
-- FINDINGS.md F621 — the write path task 9.11 wired up, and Postgres itself refuses.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE PROBLEM, MEASURED AT 9.11's BUILD AND RECORDED RATHER THAN WORKED AROUND (F621).
-- `createSandboxTenant` (`src/sandbox/writes.mjs:50`) INSERTs `keystone.tenant` with no explicit
-- `id`. `keystone.tenant`'s only write policy is
--     CREATE POLICY tenant_isolation ON keystone.tenant USING (id = keystone.current_tenant_id())
-- (0001:157-158) — with no explicit WITH CHECK, so Postgres uses the USING expression for INSERT
-- too. A freshly-generated `id` can never equal the caller's `current_tenant_id()`, so this INSERT
-- is refused for EVERY caller under EVERY tenant context, platform operator included.
-- `copyConfigurationIntoSandbox` (`:77`) has the same shape twice: its defensive read
-- (`SELECT sandbox_of FROM keystone.tenant WHERE id = $1` for the SANDBOX id) and its
-- `INSERT … SELECT` per COPY_ORDER table both need `current_tenant_id()` to equal the SANDBOX
-- tenant, while the request that reaches either function is running in the LIVE tenant's own
-- context — two different values, at once, which no GUC setting can produce.
--
-- ★★ WHAT THIS MIGRATION DOES NOT DO. `db/migrations/0008_seat_counts_context_switch.sql:19`
-- states the house rule in capitals: no BYPASSRLS role. This migration adds none, and it does not
-- touch `tenant_isolation` or FORCE ROW LEVEL SECURITY on any table — every existing caller keeps
-- exactly the isolation it has always had.
--
-- ★★★ WHAT IT DOES INSTEAD — THE CODEBASE'S OWN PATTERN, NAMED AND FOLLOWED, NOT INVENTED.
-- `0017_health_tenant_lister.sql` solved the identical shape (a definer that must see across the
-- tenant boundary) for a READ: a function owned by `auth_owner` — NOT the table's owner, so FORCE
-- does not even enter into it — admitted by an EXPLICIT, NAMED, narrow policy scoped `TO
-- auth_owner`. `0185_backup_history_is_the_platforms_not_the_practices.sql` extended the same idea
-- with the gate this migration also uses: `USING (keystone.caller_is_platform())`, so the
-- condition is supplied by the APPLICATION (a live, approved `operator_grant` row read through the
-- GUC `withTenant` already sets — `src/db/index.mjs:123` — never by the caller's role or by a
-- request parameter). `0160_…giving_up.sql` is the WRITE-side precedent: SECURITY DEFINER
-- functions, each opening with `IF NOT keystone.caller_is_platform() THEN RAISE EXCEPTION …
-- USING ERRCODE = '42501'`, owned by `auth_owner`, EXECUTE granted to `app_rw` only.
-- ★ This migration is that same shape, applied to the one write 9.11 needed and did not have:
--   1. TWO named, narrow policies on `keystone.tenant` and on each of the five `COPY_ORDER`
--      tables (`service`, `price`, `document_category`, `document_type`, `document_template`) —
--      SELECT and INSERT, both scoped `TO auth_owner`, both gated on `caller_is_platform()`, and
--      the INSERT side additionally narrowed so it can only ever write a row that belongs to a
--      SANDBOX tenant (mirroring 0025's own narrowing: "the grant cannot be used for anything
--      else"). `keystone.tenant` already grants `auth_owner` unconditional SELECT (0017:54) — this
--      migration adds INSERT only.
--   2. TWO SECURITY DEFINER functions, `keystone.create_sandbox_tenant` and
--      `keystone.copy_configuration_into_sandbox`, owned by `auth_owner`, gated on
--      `caller_is_platform()` a second time INSIDE the function body (defence in depth — the
--      policies above are the real backstop; the function's own check gives a readable error
--      instead of a bare RLS violation for the ordinary case). EXECUTE is granted to `app_rw`
--      (the role every request already connects as) and to `app_owner` (so this migration's own
--      behaviour probe, below, can call them).
-- ★★ NO NEW CONNECTION, NO NEW ROLE, NO NEW POOL. Unlike `0025`'s `app_signup` (which solves a
--    different problem — no tenant context exists yet at all, at signup), the sandbox route
--    already runs inside a live, tenant-branded `app_rw` connection with a real
--    `operator_grant_id` GUC set by `withTenant`. SECURITY DEFINER changes which role's
--    PRIVILEGES apply to the function body; it does not touch session GUCs, so
--    `keystone.caller_is_platform()` reads the SAME live grant from inside the function that
--    `callerIsPlatform(db)` already read on the ordinary connection one line above the call. A
--    follow-up task (see `STAGE-9-PLAN.md`, the section after task 9.11) wires
--    `src/sandbox/writes.mjs` to call these two functions instead of writing `keystone.tenant`
--    and the five config tables directly; `src/routes/settings.mjs` needs NO change — it already
--    passes the same `db` handle these functions are designed to be called on.
--
-- ★ Production effect (MEASURED 21 Sep 2026): `keystone.tenant` has 3 rows, none with `sandbox_of`
-- set, and `service`/`price`/`document_category`/`document_type`/`document_template` all hold 0
-- rows — this migration changes no existing row anywhere. Written during BUILD, NOT applied.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · keystone.tenant — INSERT ONLY, AND ONLY A SANDBOX ROW.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ SELECT is already granted (0017:54, `tenant_health_read`, USING (true)) — auth_owner can
--   already read every tenant row. This migration adds the one verb it did not have.
GRANT INSERT ON keystone.tenant TO auth_owner;

-- ★★★ `sandbox_of IS NOT NULL` IN THE WITH CHECK IS THE NARROWING THAT MATTERS, the same shape as
--     0025's `WITH CHECK (status = 'provisioning')`. Even if some future SECURITY DEFINER function
--     were mistakenly also owned by auth_owner and also happened to run while caller_is_platform()
--     is true, this policy could still only ever be used to insert a SANDBOX row — never an
--     ordinary new live tenant, and never a flip of an existing one (there is no UPDATE policy
--     here, deliberately, mirroring 0025's own choice).
CREATE POLICY platform_sandbox_tenant_write ON keystone.tenant
  FOR INSERT TO auth_owner
  WITH CHECK (keystone.caller_is_platform() AND sandbox_of IS NOT NULL);

COMMENT ON POLICY platform_sandbox_tenant_write ON keystone.tenant IS
  'F621 — admits ONLY auth_owner, ONLY INSERT, and ONLY a row with sandbox_of set: a platform operator (caller_is_platform()) may create a sandbox tenant through keystone.create_sandbox_tenant(), and this policy cannot be used for anything else — no UPDATE, no DELETE, no ordinary live tenant.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · THE FIVE COPY_ORDER TABLES — SELECT (any tenant, platform only) and INSERT (sandbox rows
--      only), mirroring §1 and 0009/0011/0015's own per-table RLS-setup loops.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ SELECT is scoped to `keystone.caller_is_platform()` rather than `USING (true)` — unlike
--   `keystone.tenant`, these tables carry real configuration, and there is no existing precedent
--   for handing auth_owner an unconditional read of them. The gate is the same one 0185 uses for
--   `backup_run`'s platform_reads policy.
-- ★★ THE INSERT SIDE'S EXTRA CLAUSE — `EXISTS (… t.sandbox_of IS NOT NULL)` — is the same
--    narrowing as §1, restated per table: this policy can only ever be used to write a row whose
--    tenant_id points at a SANDBOX tenant, never a live one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service','price','document_category','document_type','document_template']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON keystone.%I TO auth_owner', t);

    EXECUTE format(
      $f$CREATE POLICY platform_sandbox_config_read ON keystone.%1$I
           FOR SELECT TO auth_owner
           USING (keystone.caller_is_platform())$f$, t);

    -- ★ `tenant_id` bare, not table-qualified — the same convention 0009/0011/0015/0025's own
    --   per-table policy loops use (`WITH CHECK (tenant_id = keystone.require_tenant_id())`): inside
    --   a policy's WITH CHECK, an unqualified column name is the row being written, unambiguous
    --   against the EXISTS subquery's own `tt` alias.
    EXECUTE format(
      $f$CREATE POLICY platform_sandbox_config_write ON keystone.%1$I
           FOR INSERT TO auth_owner
           WITH CHECK (
             keystone.caller_is_platform()
             AND EXISTS (
               SELECT 1 FROM keystone.tenant tt
                WHERE tt.id = tenant_id AND tt.sandbox_of IS NOT NULL
             )
           )$f$, t);

    EXECUTE format(
      $f$COMMENT ON POLICY platform_sandbox_config_read ON keystone.%1$I IS
        'F621 — auth_owner may read keystone.%1$I across every tenant only while caller_is_platform() is true, so keystone.copy_configuration_into_sandbox() can read the LIVE tenant''s rows to copy them.'$f$, t);
    EXECUTE format(
      $f$COMMENT ON POLICY platform_sandbox_config_write ON keystone.%1$I IS
        'F621 — auth_owner may INSERT into keystone.%1$I only while caller_is_platform() is true AND only when the target tenant_id is itself a sandbox (sandbox_of IS NOT NULL) — this policy can never write a live tenant''s configuration.'$f$, t);

    -- ★★ FIX [MEASURED 22 Sep 2026, same class as F658/0196/0197]: 0009/0015's own `tenant_insert`
    --    policy on this table carries no `TO` clause (PUBLIC), so it co-applies to auth_owner too,
    --    and PERMISSIVE policies are evaluated together — Postgres does not short-circuit past one
    --    that RAISES. `tenant_insert`'s WITH CHECK is `tenant_id = keystone.require_tenant_id()`,
    --    and `require_tenant_id()` RAISES (not returns false) when `keystone.tenant_id` is unset —
    --    which it always is on the auth_owner/SECURITY DEFINER sandbox-copy path (two tenants are in
    --    play at once; no single GUC value is correct). Repro: EXECUTE'd directly against
    --    keystone.service inside this migration's own §5 probe, unfixed, raised exactly
    --    "no tenant context: keystone.tenant_id is not set" — even though
    --    platform_sandbox_config_write, above, would itself have permitted the very same row.
    --    Narrowing `tenant_insert`'s role list to `app_rw` (the only role that has ever used it —
    --    every migration seed goes through the 0018 NO FORCE/FORCE bracket instead, never this
    --    policy) removes auth_owner from its evaluation entirely, the same fix shape 0196/0197 used
    --    for a defeated narrow policy: scope the broad one down rather than touch the narrow one.
    EXECUTE format('ALTER POLICY tenant_insert ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · THE TWO FUNCTIONS. Created AS auth_owner (0017's ordering lesson: SET ROLE first, never
--      CREATE-then-ALTER OWNER — a GRANT EXECUTE made before the ALTER is silently folded into the
--      owner's own ACL entry and disappears when the owner changes).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET ROLE auth_owner;

-- ★ Mirrors `createSandboxTenant`'s own INSERT (`src/sandbox/writes.mjs:62-65`) exactly — same
--   columns, same literal 'active' status, same RETURNING shape (CT-069: id, slug, sandbox_of and
--   nothing else). The live-tenant-exists / not-itself-a-sandbox checks stay in JS, unchanged —
--   they run on the ordinary connection under the LIVE tenant's own context, where the existing
--   tenant_isolation SELECT policy already admits them (id = current_tenant_id()). Only the actual
--   cross-tenant INSERT needed a privileged path.
CREATE FUNCTION keystone.create_sandbox_tenant(
  p_live_tenant_id uuid, p_slug text, p_name text, p_timezone text
) RETURNS TABLE (id uuid, slug text, sandbox_of uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION 'create_sandbox_tenant: only a platform operator may create a sandbox tenant'
      USING ERRCODE = '42501';
  END IF;
  IF p_live_tenant_id IS NULL THEN
    RAISE EXCEPTION 'create_sandbox_tenant: a sandbox needs the live tenant it belongs to'
      USING ERRCODE = '22004';
  END IF;
  -- ★ `AS tn` and RETURNING tn.id/tn.slug/tn.sandbox_of, not bare column names — this function's
  --   OUT parameters are ALSO named id/slug/sandbox_of (the RETURNS TABLE list above), and
  --   plpgsql's default `variable_conflict = error` raises "column reference is ambiguous" for a
  --   bare name that matches both a declared variable and a query column. The alias removes the
  --   ambiguity outright rather than relying on a session-level setting.
  RETURN QUERY
    INSERT INTO keystone.tenant AS tn (slug, name, timezone, status, sandbox_of)
    VALUES (p_slug, p_name, p_timezone, 'active', p_live_tenant_id)
    RETURNING tn.id, tn.slug, tn.sandbox_of;
END;
$$;

REVOKE ALL ON FUNCTION keystone.create_sandbox_tenant(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.create_sandbox_tenant(uuid,text,text,text) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.create_sandbox_tenant(uuid,text,text,text) IS
  'F621 — the privileged half of createSandboxTenant (src/sandbox/writes.mjs). Gated on caller_is_platform() (readable error) AND on platform_sandbox_tenant_write''s WITH CHECK (the real backstop). Owned by auth_owner. EXECUTE to app_rw only (app_owner too, for this migration''s own behaviour probe below).';

-- ★ Mirrors `copyConfigurationIntoSandbox` (`src/sandbox/writes.mjs:77-104`) exactly: the same
--   defensive "target is not this tenant's sandbox" check, the same COPY_ORDER table list in the
--   same order, the same information_schema-derived column list excluding id/tenant_id, the same
--   per-table row counts returned. COPY_ORDER is frozen and enumerated in JS on purpose ("adding
--   one is a decision, not a convenience") — this hardcodes the identical five names rather than
--   reading them from anywhere dynamic, for the same reason.
CREATE FUNCTION keystone.copy_configuration_into_sandbox(
  p_live_tenant_id uuid, p_sandbox_tenant_id uuid
) RETURNS TABLE (table_name text, row_count integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sandbox_of uuid;
  v_table text;
  v_cols text;
  v_count integer;
BEGIN
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION 'copy_configuration_into_sandbox: only a platform operator may copy configuration into a sandbox'
      USING ERRCODE = '42501';
  END IF;
  IF p_live_tenant_id IS NULL OR p_sandbox_tenant_id IS NULL THEN
    RAISE EXCEPTION 'copy_configuration_into_sandbox: both tenant ids are required'
      USING ERRCODE = '22004';
  END IF;

  -- ★★ REFUSE TO WRITE INTO ANYTHING THAT IS NOT THIS TENANT'S SANDBOX — the same check
  --    src/sandbox/writes.mjs:81-86 makes, moved here because reading the SANDBOX tenant's own row
  --    from the LIVE tenant's context is itself a cross-tenant read (id <> current_tenant_id()).
  SELECT t.sandbox_of INTO v_sandbox_of FROM keystone.tenant t WHERE t.id = p_sandbox_tenant_id;
  IF v_sandbox_of IS DISTINCT FROM p_live_tenant_id THEN
    RAISE EXCEPTION 'copy_configuration_into_sandbox: the target is not the sandbox of that live tenant — refusing to copy across tenants'
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['service','price','document_category','document_type','document_template']
  LOOP
    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'keystone' AND c.table_name = v_table
       AND c.column_name NOT IN ('id','tenant_id');

    IF v_cols IS NULL THEN
      v_count := 0;
    ELSE
      EXECUTE pg_catalog.format(
        'INSERT INTO keystone.%1$I (tenant_id, %2$s) SELECT $2, %2$s FROM keystone.%1$I WHERE tenant_id = $1',
        v_table, v_cols
      ) USING p_live_tenant_id, p_sandbox_tenant_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    table_name := v_table;
    row_count  := v_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION keystone.copy_configuration_into_sandbox(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.copy_configuration_into_sandbox(uuid,uuid) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.copy_configuration_into_sandbox(uuid,uuid) IS
  'F621 — the privileged half of copyConfigurationIntoSandbox (src/sandbox/writes.mjs). Returns one row per COPY_ORDER table (table_name, row_count), same order, same all-zero-on-empty-source behaviour. Gated on caller_is_platform() and on the platform_sandbox_config_* policies (the real backstop). Owned by auth_owner. EXECUTE to app_rw only (app_owner too, for the probe below).';

SET ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · SELF-CHECK — owner, SECURITY DEFINER, empty search_path, and the ACL, on both functions.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_owner text; v_prosecdef boolean; v_proconfig text[];
  f text; bad text[] := '{}';
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0221 is running as %, expected app_owner', current_user;
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'keystone.create_sandbox_tenant(uuid,text,text,text)',
    'keystone.copy_configuration_into_sandbox(uuid,uuid)'
  ] LOOP
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
      INTO v_owner, v_prosecdef, v_proconfig
      FROM pg_proc p WHERE p.oid = f::regprocedure;
    IF v_owner IS DISTINCT FROM 'auth_owner' THEN bad := bad || (f || ': owned by ' || v_owner || ', expected auth_owner'); END IF;
    IF NOT v_prosecdef THEN bad := bad || (f || ': is not SECURITY DEFINER'); END IF;
    IF v_proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      bad := bad || (f || ': proconfig is ' || coalesce(v_proconfig::text,'NULL') || ', expected search_path=""');
    END IF;
    IF NOT has_function_privilege('app_rw', f, 'EXECUTE') THEN bad := bad || (f || ': app_rw cannot execute it'); END IF;
    IF has_function_privilege('public', f, 'EXECUTE') THEN bad := bad || (f || ': PUBLIC can execute it'); END IF;
  END LOOP;

  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'0221 self-check failed:\n  %', array_to_string(bad, E'\n  ');
  END IF;
  RAISE NOTICE '0221: both functions owned by auth_owner, SECURITY DEFINER, search_path pinned, EXECUTE to app_rw only';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §5 · BEHAVIOUR PROBE — a real non-platform refusal, a real platform success, a real cross-tenant
--      refusal, run against real fixtures, all undone by the sentinel exception (0160's pattern).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_live uuid; v_sandbox uuid; v_stranger uuid; v_grant uuid;
  v_service_count int;
BEGIN
  -- ★ The fixture needs to plant tenants and a service row, and every one of those tables carries
  --   FORCE (or, for the five config tables, ordinary) row-level security that filters app_owner
  --   with no tenant context. RESET ROLE for the plant, same as 0160:69 — undone automatically by
  --   the sentinel below, because this whole block is one subtransaction.
  RESET ROLE;

  INSERT INTO keystone.tenant (slug, name, timezone, status)
    VALUES ('0221-probe-live-' || substr(md5(random()::text),1,8), '0221 probe live', 'UTC', 'active')
    RETURNING id INTO v_live;
  INSERT INTO keystone.tenant (slug, name, timezone, status)
    VALUES ('0221-probe-stranger-' || substr(md5(random()::text),1,8), '0221 probe stranger', 'UTC', 'active')
    RETURNING id INTO v_stranger;
  INSERT INTO keystone.service (tenant_id, name, duration_minutes, price_minor)
    VALUES (v_live, '0221 probe service', 30, 5000);

  SET ROLE app_owner;

  -- ★ 1 · WITHOUT a live operator grant, the create is refused — by the function's own readable
  --   check first, backstopped by the policy either way.
  PERFORM set_config('keystone.operator_grant_id', '', false);
  BEGIN
    PERFORM keystone.create_sandbox_tenant(v_live, '0221-should-not-exist', 'should not exist', 'UTC');
    RAISE EXCEPTION '0221 probe: create_sandbox_tenant succeeded with NO operator grant set';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ★ 2 · THE POSITIVE CONTROL — a live, approved operator grant, and the same call succeeds.
  RESET ROLE;
  v_grant := keystone.grant_operator('migration:0221-probe', 'migration:0221', '0221 migration probe', now() + interval '10 minutes');
  SET ROLE app_owner;
  PERFORM set_config('keystone.operator_grant_id', v_grant::text, false);

  SELECT id INTO v_sandbox FROM keystone.create_sandbox_tenant(v_live, '0221-probe-sandbox', '0221 probe live (sandbox)', 'UTC');
  IF v_sandbox IS NULL THEN
    RAISE EXCEPTION '0221 probe: create_sandbox_tenant returned no row in the PLATFORM context';
  END IF;

  -- ★ 3 · THE COPY SUCCEEDS AND CARRIES THE ONE SEEDED SERVICE.
  SELECT row_count INTO v_service_count
    FROM keystone.copy_configuration_into_sandbox(v_live, v_sandbox) WHERE table_name = 'service';
  IF v_service_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '0221 probe: expected 1 service copied, got %', v_service_count;
  END IF;

  -- ★ 4 · AND THE CROSS-TENANT REFUSAL — copying into a tenant that is NOT this tenant's sandbox.
  BEGIN
    PERFORM keystone.copy_configuration_into_sandbox(v_live, v_stranger);
    RAISE EXCEPTION '0221 probe: copy_configuration_into_sandbox wrote into an unrelated tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ★★ THE SENTINEL: every fixture and grant planted above is undone by this exception, which the
  --    handler below swallows by name — nothing from this probe reaches the real database.
  RAISE EXCEPTION 'keystone_0221_probe_passed';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'keystone_0221_probe_passed' THEN RAISE; END IF;
  RAISE NOTICE '0221: a non-platform caller is refused, a platform caller creates a sandbox and copies its configuration, and a cross-tenant copy is refused';
END $$;
