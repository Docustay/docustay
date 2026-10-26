-- 0144_the_reference_guard_sees_through_a_role_of_its_own
-- FINDINGS F501 · controller ruling R54 · corrects the SIDE EFFECT of 0100 and 0133 (F492) without undoing their fix.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT WENT WRONG. The reference-practice guards `keystone.refuse_touch_reference_rows()` and
--     `keystone.refuse_truncate_tenant()` are SECURITY DEFINER, owned by app_owner. To let them SEE reference rows
--     through FORCE row-level security, 0100 (keystone.tenant) and 0133 (the 65 guarded tables) added
--         reference_guard_read … FOR SELECT TO app_owner USING (<the reference practice's rows>)
--     — PERMISSIVE. Postgres OR-combines permissive policies, so the visibility was not the guards': it was
--     app_owner's, and therefore EVERY app_owner-owned SECURITY DEFINER function's (15 locally, 12 on production).
--     [MEASURED, F501] keystone.account_seat_counts() — which correctly scopes the tenant GUC to the customer —
--     reported a fresh practice's 3 people as 8: 3 + the reference practice's 5. Production has no reference
--     practice today, so nothing leaked there yet; any database with one leaks.
--
-- ★★ THE FIX (R54): THE VISIBILITY BELONGS TO A ROLE THAT OWNS NOTHING ELSE.
--   · `reference_guard` — NOLOGIN NOINHERIT, created OUTSIDE the migration stream (app_owner is NOCREATEROLE):
--       fresh database  → scripts/bootstrap-roles.mjs
--       existing one    → KEYSTONE_REPAIR_PG_URL=<superuser url> node scripts/repair-role-and-owner-drift.mjs --apply
--     app_owner is its member WITH INHERIT FALSE (app_owner must NOT borrow the visibility — inheriting would be
--     F501 again, through membership) and SET TRUE (§d needs it).
--   · §b  SELECT on keystone.tenant and every guarded table, and USAGE on the schema — a policy admits rows only
--         to a role that already holds the table privilege.
--   · §c  every `reference_guard_read` is re-created `TO reference_guard` with the SAME USING, and the app_owner
--         ones are dropped. The USING text is compared before/after, so "same" is asserted, not claimed.
--   · §d  the two guards are transferred to reference_guard. They stay SECURITY DEFINER with search_path ''.
--   · §e  the promised end state is asserted from the catalogue, and a runtime probe shows app_owner now sees
--         no reference row while reference_guard does.
--
-- ★★ TWO MEASUREMENTS THIS FILE DEPENDS ON [EXECUTED, PostgreSQL 17.11, throwaway roles, scratch database]:
--   1. `ALTER FUNCTION … OWNER TO g` as a member of g WITHOUT the SET option → "must be able to SET ROLE "g"";
--      INHERIT FALSE does not matter either way. → the membership is granted SET TRUE.
--   2. With SET, it then fails "permission denied for schema s" until g holds CREATE on the function's schema.
--      Ownership SURVIVES a later REVOKE CREATE. → §d grants CREATE for the transfer and revokes it at once;
--      reference_guard ends holding USAGE only.
--
-- ★ Runs as app_owner (db/migrate.mjs per-file SET ROLE), which owns the schema, the tables and — before this
--   file — the two functions. The one SET LOCAL ROLE below (§e's probe) returns to app_owner explicitly.
--   NO `RESET ROLE` anywhere (F482).
-- ★ The table set is DISCOVERED FROM THE TRIGGERS, exactly as 0133 did, and the relation set carrying the policy
--   afterwards is asserted EQUAL to it — a table the loop skipped cannot pass.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITION: the role exists, exactly as required, and only app_owner can reach it ────────
DO $precondition$
DECLARE
  r       pg_roles%ROWTYPE;
  v_fix   CONSTANT text :=
    'Run, as a SUPERUSER, BEFORE this migration: '
    'KEYSTONE_REPAIR_PG_URL=<superuser url> node scripts/repair-role-and-owner-drift.mjs --check, then --apply '
    '(a fresh database: scripts/bootstrap-roles.mjs creates it). Then re-run db/migrate.mjs up.';
  v_login text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0144: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  SELECT * INTO r FROM pg_roles WHERE rolname = 'reference_guard';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0144: role reference_guard does not exist — a migration cannot create it (app_owner is NOCREATEROLE). %', v_fix;
  END IF;
  IF r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication THEN
    RAISE EXCEPTION '0144: role reference_guard must be NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION '
      '(login=% inherit=% super=% bypassrls=% createrole=% createdb=% replication=%). %',
      r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, v_fix;
  END IF;
  IF NOT pg_has_role('app_owner', 'reference_guard', 'MEMBER') THEN
    RAISE EXCEPTION '0144: app_owner is not a member of reference_guard, so §d''s ALTER FUNCTION … OWNER cannot run. %', v_fix;
  END IF;
  IF pg_has_role('app_owner', 'reference_guard', 'USAGE') THEN
    RAISE EXCEPTION '0144: app_owner INHERITS reference_guard — every app_owner SECURITY DEFINER function would see the '
      'reference practice again (F501, through membership). GRANT reference_guard TO app_owner WITH INHERIT FALSE, SET TRUE. %', v_fix;
  END IF;
  IF current_setting('server_version_num')::int >= 160000
     AND NOT pg_has_role('app_owner', 'reference_guard', 'SET') THEN
    RAISE EXCEPTION '0144: app_owner cannot SET ROLE reference_guard — PG16+ refuses ALTER … OWNER without it (MEASURED). %', v_fix;
  END IF;

  SELECT string_agg(m.rolname, ', ') INTO v_login
    FROM pg_roles m
   WHERE m.rolcanlogin AND NOT m.rolsuper AND pg_has_role(m.oid, r.oid, 'MEMBER');
  IF v_login IS NOT NULL THEN
    RAISE EXCEPTION '0144: login role(s) [%] can reach reference_guard — its visibility would be reachable with a connection string', v_login;
  END IF;

  RAISE NOTICE '0144 §a: reference_guard exists NOLOGIN NOINHERIT; app_owner is a member (SET, no INHERIT); no login role reaches it';
END
$precondition$;

-- ── §b · the privileges a policy needs underneath it ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA keystone TO reference_guard;
GRANT SELECT ON keystone.tenant TO reference_guard;

DO $grants$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT n.nspname, c.relname, c.oid
      FROM pg_trigger tg
      JOIN pg_proc p      ON p.oid = tg.tgfoid
      JOIN pg_class c     ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal
     ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO reference_guard', r.nspname, r.relname);
    -- ★ A GRANT by a role lacking grant option only WARNS ("no privileges were granted"). Read the effect back.
    IF NOT has_table_privilege('reference_guard', r.oid, 'SELECT') THEN
      RAISE EXCEPTION '0144 §b: GRANT SELECT ON %.% TO reference_guard did not take effect', r.nspname, r.relname;
    END IF;
    n := n + 1;
  END LOOP;
  IF NOT has_table_privilege('reference_guard', 'keystone.tenant', 'SELECT')
     OR NOT has_schema_privilege('reference_guard', 'keystone', 'USAGE') THEN
    RAISE EXCEPTION '0144 §b: reference_guard lacks SELECT on keystone.tenant or USAGE on schema keystone';
  END IF;
  RAISE NOTICE '0144 §b: reference_guard holds SELECT on keystone.tenant + % guarded table(s), and USAGE on keystone', n;
END
$grants$;

-- ★★★ AND EXECUTE ON EVERY FUNCTION A POLICY IT IS SUBJECT TO CALLS. Postgres evaluates EVERY permissive policy
--     that applies to the querying role — the PUBLIC `tenant_isolation` ones included — and checks EXECUTE on each
--     function they call, as that role. [EXECUTED, first draft of this file] document_instance's SELECT policy calls
--     keystone.document_is_visible(document_instance), whose EXECUTE is app_owner's and app_rw's only (0021), and
--     reference_guard's read of document_instance failed "permission denied for function document_is_visible" —
--     so a TRUNCATE of document_instance would have been refused for the WRONG reason, reference rows or not.
--     app_owner never hit this because it OWNS that function. DISCOVERED from pg_depend, not listed by hand.
DO $policy_functions$
DECLARE
  f record;
  n integer := 0;
BEGIN
  FOR f IN
    SELECT DISTINCT pr.oid, pr.oid::regprocedure::text AS sig
      FROM pg_policy pol
      JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid AND d.refclassid = 'pg_proc'::regclass
      JOIN pg_proc pr ON pr.oid = d.refobjid
     WHERE (pol.polroles @> ARRAY[0::oid] OR pol.polroles @> ARRAY['reference_guard'::regrole::oid])
       AND pol.polcmd IN ('r', '*')
       AND pol.polrelid IN (SELECT tg.tgrelid FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                             WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal
                            UNION SELECT 'keystone.tenant'::regclass::oid)
       AND NOT has_function_privilege('reference_guard', pr.oid, 'EXECUTE')
     ORDER BY 2
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reference_guard', f.sig);
    IF NOT has_function_privilege('reference_guard', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0144 §b: GRANT EXECUTE ON FUNCTION % TO reference_guard did not take effect', f.sig;
    END IF;
    RAISE NOTICE '0144 §b: GRANT EXECUTE ON FUNCTION % TO reference_guard (a policy on a guarded table calls it)', f.sig;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '0144 §b: % policy function(s) needed an EXECUTE grant', n;
END
$policy_functions$;

-- ── §c · move every reference_guard_read from app_owner to reference_guard, same USING ────────────
DO $policies$
DECLARE
  r          record;
  v_old      text;
  v_new      text;
  v_moved    integer := 0;
  v_expected integer;
BEGIN
  SELECT count(DISTINCT tg.tgrelid) INTO v_expected
    FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal;
  IF v_expected = 0 THEN
    RAISE EXCEPTION '0144 §c: no table carries refuse_touch_reference_rows — the discovery is wrong';
  END IF;

  -- keystone.tenant first: the child policies' subquery reads it, so reference_guard must see it too.
  FOR r IN
    SELECT 'keystone'::name AS nspname, 'tenant'::name AS relname, 'keystone.tenant'::regclass::oid AS oid,
           'is_reference' AS using_sql,
           'F501 / 0144 (was 0100, TO app_owner). Lets the reference guards (refuse_touch_reference_rows, '
           'refuse_truncate_tenant), owned by reference_guard, SEE the reference practice — SELECT only, reference '
           'rows only. ★★★ NOT app_owner: permissive policies OR-combine, so a policy TO app_owner gave EVERY '
           'app_owner SECURITY DEFINER function the reference practice (account_seat_counts counted 3 people as 8).' AS note
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT n.nspname, c.relname, c.oid,
             'tenant_id IN (SELECT id FROM keystone.tenant WHERE is_reference)',
             'F501 / 0144 (was 0133, TO app_owner). Lets refuse_touch_reference_rows, owned by reference_guard, SEE '
             'this table''s reference-practice rows on TRUNCATE — SELECT only, reference rows only. ★★★ NOT app_owner: '
             'permissive policies OR-combine, so a policy TO app_owner gave EVERY app_owner SECURITY DEFINER function '
             'the reference practice (account_seat_counts counted 3 people as 8).'
        FROM pg_trigger tg
        JOIN pg_proc p      ON p.oid = tg.tgfoid
        JOIN pg_class c     ON c.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal
       ORDER BY n.nspname, c.relname) guarded
  LOOP
    -- ★ Every guarded table has tenant_id (0133 refused otherwise); re-checked so a later table cannot slip past.
    IF r.relname <> 'tenant' AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = r.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN
      RAISE EXCEPTION '0144 §c: guarded table %.% has no tenant_id column', r.nspname, r.relname;
    END IF;

    SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_old
      FROM pg_policy pol
     WHERE pol.polrelid = r.oid AND pol.polname = 'reference_guard_read'
       AND pol.polroles = ARRAY['app_owner'::regrole::oid] AND pol.polcmd = 'r' AND pol.polpermissive;
    IF v_old IS NULL THEN
      RAISE EXCEPTION '0144 §c: %.% has no reference_guard_read FOR SELECT TO app_owner to move (0100/0133 not applied, '
        'or already changed by hand) — refusing to guess its shape', r.nspname, r.relname;
    END IF;

    EXECUTE format('DROP POLICY reference_guard_read ON %I.%I', r.nspname, r.relname);
    EXECUTE format('CREATE POLICY reference_guard_read ON %I.%I FOR SELECT TO reference_guard USING (%s)',
                   r.nspname, r.relname, r.using_sql);
    EXECUTE format('COMMENT ON POLICY reference_guard_read ON %I.%I IS %L', r.nspname, r.relname, r.note);

    SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_new
      FROM pg_policy pol WHERE pol.polrelid = r.oid AND pol.polname = 'reference_guard_read';
    IF v_new IS DISTINCT FROM v_old THEN
      RAISE EXCEPTION '0144 §c: %.% reference_guard_read USING changed: was (%) now (%)', r.nspname, r.relname, v_old, v_new;
    END IF;
    v_moved := v_moved + 1;
  END LOOP;

  IF v_moved <> v_expected + 1 THEN
    RAISE EXCEPTION '0144 §c: moved % policy(ies), expected % (keystone.tenant + % guarded table(s))', v_moved, v_expected + 1, v_expected;
  END IF;
  RAISE NOTICE '0144 §c: moved % reference_guard_read policy(ies) from app_owner to reference_guard (keystone.tenant + % guarded table(s)), USING unchanged', v_moved, v_expected;
END
$policies$;

-- ── §d · the two guards change hands ─────────────────────────────────────────────────────────────
-- ★ The comment is written FIRST, while app_owner still owns the function. [EXECUTED, first draft] written after the
--   transfer it failed "must be owner of function keystone.refuse_truncate_tenant": app_owner is NOINHERIT toward
--   reference_guard, so from here on a later migration that changes these two functions must `SET LOCAL ROLE
--   reference_guard` (app_owner holds SET) — it cannot alter them as app_owner. That is the intended shape.
COMMENT ON FUNCTION keystone.refuse_truncate_tenant() IS
  'P3 CLOSE / F1; owner reference_guard since 0144 (F501). Refuses TRUNCATE keystone.tenant while a reference '
  'practice exists. SECURITY DEFINER, search_path ''''. ★★ Owned by reference_guard — a NOLOGIN NOINHERIT role that '
  'owns nothing else — because the policy that lets it see the reference practice would, TO app_owner, have let '
  'every app_owner SECURITY DEFINER function see it too.';

-- ★ CREATE on the schema is needed AT TRANSFER TIME only (measurement 2 in the header), and taken away at once.
GRANT CREATE ON SCHEMA keystone TO reference_guard;
ALTER FUNCTION keystone.refuse_touch_reference_rows() OWNER TO reference_guard;
ALTER FUNCTION keystone.refuse_truncate_tenant()      OWNER TO reference_guard;
REVOKE CREATE ON SCHEMA keystone FROM reference_guard;

-- ── §e · the promised end state, from the catalogue ──────────────────────────────────────────────
DO $assert$
DECLARE
  v_bad      text;
  v_expected integer;
  v_present  integer;
  v_fn       record;
BEGIN
  -- 1. no reference_guard_read anywhere still targets app_owner
  SELECT string_agg(polrelid::regclass::text, ', ') INTO v_bad
    FROM pg_policy WHERE polname = 'reference_guard_read' AND 'app_owner'::regrole::oid = ANY(polroles);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0144 §e: reference_guard_read still targets app_owner on: %', v_bad;
  END IF;

  -- 2. every guarded table and keystone.tenant carries it TO reference_guard ONLY, SELECT, PERMISSIVE — and nothing else does
  SELECT count(DISTINCT tg.tgrelid) INTO v_expected
    FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal;
  WITH want AS (
    SELECT DISTINCT tg.tgrelid AS rel FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal
    UNION SELECT 'keystone.tenant'::regclass::oid
  ), have AS (
    SELECT polrelid AS rel FROM pg_policy
     WHERE polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid] AND polcmd = 'r' AND polpermissive
  )
  SELECT string_agg(x, '; ') INTO v_bad FROM (
    SELECT 'missing on ' || rel::regclass::text AS x FROM want WHERE rel NOT IN (SELECT rel FROM have)
    UNION ALL
    SELECT 'unexpected on ' || rel::regclass::text FROM have WHERE rel NOT IN (SELECT rel FROM want)
  ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0144 §e: reference_guard_read (TO reference_guard, SELECT, permissive) does not match the guarded set: %', v_bad;
  END IF;
  SELECT count(*) INTO v_present FROM pg_policy WHERE polname = 'reference_guard_read';
  IF v_present <> v_expected + 1 THEN
    RAISE EXCEPTION '0144 §e: % reference_guard_read policies exist, expected exactly % (tenant + % guarded)', v_present, v_expected + 1, v_expected;
  END IF;

  -- 3. both guards owned by reference_guard, still SECURITY DEFINER, search_path still ''
  FOR v_fn IN
    SELECT p.oid::regprocedure::text AS sig, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
      FROM pg_proc p
     WHERE p.oid IN ('keystone.refuse_touch_reference_rows()'::regprocedure, 'keystone.refuse_truncate_tenant()'::regprocedure)
  LOOP
    IF v_fn.owner <> 'reference_guard' OR NOT v_fn.prosecdef OR v_fn.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '0144 §e: % owner=% secdef=% config=% — expected reference_guard / true / {search_path=""}',
        v_fn.sig, v_fn.owner, v_fn.prosecdef, v_fn.proconfig;
    END IF;
  END LOOP;

  -- 4. reference_guard owns exactly those two functions and no relation, and kept no CREATE on the schema
  IF (SELECT count(*) FROM pg_proc WHERE proowner = 'reference_guard'::regrole) <> 2
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = 'reference_guard'::regrole) THEN
    RAISE EXCEPTION '0144 §e: reference_guard owns something other than the two guards';
  END IF;
  IF has_schema_privilege('reference_guard', 'keystone', 'CREATE') THEN
    RAISE EXCEPTION '0144 §e: reference_guard still holds CREATE on schema keystone';
  END IF;

  -- 5. every function any SELECT-applicable policy it is subject to calls is executable by it (§b's lesson)
  SELECT string_agg(DISTINCT pr.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_policy pol
    JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid AND d.refclassid = 'pg_proc'::regclass
    JOIN pg_proc pr ON pr.oid = d.refobjid
   WHERE (pol.polroles @> ARRAY[0::oid] OR pol.polroles @> ARRAY['reference_guard'::regrole::oid])
     AND pol.polcmd IN ('r', '*')
     AND pol.polrelid IN (SELECT polrelid FROM pg_policy WHERE polname = 'reference_guard_read')
     AND NOT has_function_privilege('reference_guard', pr.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0144 §e: reference_guard cannot EXECUTE function(s) its policies call: %', v_bad;
  END IF;

  RAISE NOTICE '0144 §e: 0 reference_guard_read policies target app_owner; % target reference_guard only; both guards owned by reference_guard', v_present;
END
$assert$;

-- ── §e (runtime) · who can SEE the reference practice now ────────────────────────────────────────
-- ★ The reference guard's own identity first (positive control), then app_owner with NO tenant context (the
--   state 0100/0133 exposed). On a database with no reference practice both counts are 0 and only the negative
--   half means anything; the NOTICE says which.
SELECT set_config('keystone.tenant_id', '', true);
SET LOCAL ROLE reference_guard;
-- ★ As the guard's own role, run the guard's own TRUNCATE-branch query against EVERY guarded table. An error here
--   (a missing grant, a policy function it cannot execute) aborts the migration instead of surfacing later as a
--   TRUNCATE refused for the wrong reason.
DO $guard_probe$
DECLARE
  r      record;
  v_rows bigint := 0;
  v_n    bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT n.nspname, c.relname
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I x JOIN keystone.tenant t ON t.id = x.tenant_id WHERE t.is_reference',
                   r.nspname, r.relname) INTO v_n;
    v_rows := v_rows + v_n;
  END LOOP;
  PERFORM set_config('keystone_0144.ref_seen_by_guard',
                     (SELECT count(*) FROM keystone.tenant WHERE is_reference)::text, true);
  PERFORM set_config('keystone_0144.ref_rows_seen_by_guard', v_rows::text, true);
END
$guard_probe$;
SET LOCAL ROLE app_owner;

DO $probe$
DECLARE
  v_guard integer := current_setting('keystone_0144.ref_seen_by_guard')::int;
  v_owner integer;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0144 probe: expected to be back as app_owner, am %', current_user;
  END IF;
  SELECT count(*) INTO v_owner FROM keystone.tenant WHERE is_reference;
  IF v_owner <> 0 THEN
    RAISE EXCEPTION '0144 probe: app_owner still sees % reference practice row(s) with no tenant context — F501 is not closed', v_owner;
  END IF;
  RAISE NOTICE '0144 probe: reference_guard sees % reference practice(s) and % reference row(s) across the guarded tables; app_owner sees 0%',
    v_guard, current_setting('keystone_0144.ref_rows_seen_by_guard'),
    CASE WHEN v_guard = 0 THEN ' (this database has no reference practice — the positive half is vacuous here)' ELSE '' END;
END
$probe$;
