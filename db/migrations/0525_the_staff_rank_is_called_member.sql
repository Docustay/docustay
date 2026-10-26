-- 0525 — L13.3 (RECONCILE de-code, 27 Sep 2026): the staff rank spelled 'coach' becomes 'member'.
-- ★ party/document-assignment 'coach' is UNCHANGED — a separate vocabulary (this file's own respec,
--   specs/de-code/build/respec/L13.md, "party stays unchanged" ruling). Only app_user.staff_role and
--   keystone.role (the RBAC row + its permission grants, which key on id, never on the string) move.

-- ★★★ EVERY TABLE THIS FILE TOUCHES HAS FORCE RLS, AND THIS MIGRATION RUNS AS `app_owner` WITH NO
--     TENANT CONTEXT SET (db/migrate.mjs). MEASURED, 27 Sep, at END CHECKS: a naive
--     `FOR t IN SELECT id FROM keystone.tenant LOOP` sees ZERO tenants — not a bug in this file, but
--     the exact, deliberately-audited behavior 0017_health_tenant_lister.sql proves and locks in
--     (its own DO block asserts "a direct read with no tenant context returned 0 row(s)" as the
--     CORRECT outcome). `keystone.tenant` has no owner-bypass and no platform-wide read policy for
--     app_owner — the only sanctioned way to enumerate every tenant from a context-free connection is
--     `keystone.tenant_timezones_for_health()`, the SECURITY DEFINER resolver 0017 built for exactly
--     this "a process-level check has no tenant context" problem. Using it here rather than
--     re-deriving a second bypass.
-- ★ Two earlier draft attempts at this migration are why this file looks the way it does: the first
--   added the CHECK constraint before updating any data (rejected by the OLD constraint, since it
--   didn't yet admit 'coach'); the second updated data before dropping the OLD constraint (rejected
--   by the OLD constraint refusing to let the UPDATE write 'member' in the first place); the third
--   (immediately prior to this one) looped tenants via a plain `SELECT id FROM keystone.tenant`,
--   which silently iterated zero times for the RLS reason above and reported "0 rows renamed" with
--   no error — caught only because §d's own per-tenant verify also came back "0 leftover" and a
--   second, independent read (as a superuser, outside any migration) showed the row still existed.

-- §a1 — DROP the old constraints FIRST. A CHECK constraint's own validation is NOT RLS-filtered (it
--   sees every row on the table, tenant loop or not) — but the OLD constraint would reject the
--   in-flight UPDATE below from ever writing 'member' in the first place, so it has to be gone before
--   §b runs, and the new one only goes back on in §a2 once every row already satisfies it.
ALTER TABLE keystone.app_user DROP CONSTRAINT app_user_staff_role_check;
ALTER TABLE keystone.role DROP CONSTRAINT role_builtin_key_is_current;

-- §b — THE DATA, PER TENANT, ENUMERATED VIA THE HEALTH RESOLVER (see header). keystone.role.id is
--   what user_role/role_permission reference; renaming key IN PLACE keeps every existing grant
--   intact (no row moves, no FK touched).
DO $rename_staff_rank$
DECLARE
  t          record;
  v_user_upd integer := 0;
  v_role_upd integer := 0;
  v_rows     integer;
BEGIN
  FOR t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);

    UPDATE keystone.app_user SET staff_role = 'member' WHERE staff_role = 'coach';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_user_upd := v_user_upd + v_rows;

    UPDATE keystone.role SET key = 'member' WHERE key = 'coach' AND is_builtin;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_role_upd := v_role_upd + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0525: % app_user row(s), % builtin role row(s) renamed coach -> member', v_user_upd, v_role_upd;
END
$rename_staff_rank$;

-- §a2 — re-ADD the constraints, now that every row already satisfies them.
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_staff_role_check
  CHECK (staff_role IN ('owner','admin','member'));
ALTER TABLE keystone.role ADD CONSTRAINT role_builtin_key_is_current CHECK (
  NOT is_builtin OR key IN ('owner','admin','member'));

-- §c — STORED TERMINOLOGY OVERRIDES, PER TENANT. `tenant_setting` where key = 'terminology.overrides'
--   holds a JSON object; a stored 'userType.coach' key (L13.1's OLD key) becomes 'userType.member',
--   value unchanged (the PRACTICE'S OWN WORD survives — only the key it is filed under moves).
DO $rename_terminology_override$
DECLARE
  t      record;
  v_rows integer;
  v_upd  integer := 0;
BEGIN
  FOR t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);

    UPDATE keystone.tenant_setting
       SET value = (value::jsonb - 'userType.coach') ||
                   jsonb_build_object('userType.member', value::jsonb -> 'userType.coach')
     WHERE key = 'terminology.overrides'
       AND value::jsonb ? 'userType.coach';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_upd := v_upd + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0525: % tenant_setting row(s) had their userType.coach override key renamed', v_upd;
END
$rename_terminology_override$;

-- §d — THE SELF-CHECK, PER TENANT — a bare, un-looped SELECT here would run under no tenant context,
--   see nothing via FORCE RLS, and report a "0 leftover" PASS that checked zero real rows. Looping
--   via the same health resolver is what makes this assertion mean anything.
DO $the_rename_is_complete$
DECLARE
  t           record;
  v_leftover  integer := 0;
  v_rows      integer;
BEGIN
  FOR t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);

    SELECT count(*) INTO v_rows FROM keystone.app_user WHERE staff_role = 'coach';
    v_leftover := v_leftover + v_rows;

    SELECT count(*) INTO v_rows FROM keystone.role WHERE key = 'coach' AND is_builtin;
    v_leftover := v_leftover + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_leftover > 0 THEN
    RAISE EXCEPTION '0525: % row(s) across app_user/role still say coach after the per-tenant rename', v_leftover;
  END IF;

  RAISE NOTICE '0525: staff rank renamed coach -> member, 0 leftover rows across every tenant';
END
$the_rename_is_complete$;
