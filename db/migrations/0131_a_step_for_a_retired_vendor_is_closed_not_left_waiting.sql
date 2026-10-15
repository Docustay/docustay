-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0131 — A STEP FOR A RETIRED VENDOR IS CLOSED, NOT LEFT WAITING FOR A PERSON WHO WILL NEVER COME.
--
-- ★★ Spec 01 default 9 retires Documenso: new practices get four setup steps, not five (Stage 2).
--    A run created BEFORE the retirement still carries a `documenso_team` row in `awaiting_human`
--    [MEASURED on production 17 Sep 2026: exactly one, bound to a practice]. It asks a person to create
--    a team in a product the platform no longer uses, so that run can never finish.
--
-- ★★★ IT IS MARKED `skipped`, NOT DELETED. `skipped` is already a legal state (the CHECK lists it). A
--     deleted row erases the record that the step existed and why it stopped mattering; a skipped row
--     with its reason keeps both — the never-delete rule applied to setup history.
--
-- ★★★ HOW A MIGRATION CAN SEE THE ROW AT ALL (F490). This file runs as `app_owner` (db/migrate.mjs,
--     per-file SET ROLE). `keystone.provisioning_step` is FORCE row-level security; with no tenant context
--     app_owner sees NOTHING, and since 17 Sep 2026 it is NOINHERIT, so it no longer borrows auth_owner's
--     reads either. A plain UPDATE here would match zero rows and succeed — the silent-success shape.
--   ★ So the ids are READ as `auth_owner` (policy `provisioning_step_platform_read`, USING true; app_owner
--     is a MEMBER, so SET LOCAL ROLE is allowed) into PL/pgSQL ARRAYS — not a temp table, because a temp
--     table created as auth_owner is owned by auth_owner and a NOINHERIT app_owner could not read it back
--     (caught before this ever ran). Each row is then updated as app_owner under its own tenant GUC.
--
-- ★ UNBOUND ROWS ARE LEFT ALONE AND COUNTED. A step with NO tenant is a signup whose all-or-nothing prefix
--   never bound a practice: it belongs to nobody, is invisible to every practice, and its run can never
--   advance. [MEASURED: production has none; the local database has 304, left behind by signup gates.]
--   app_owner could not update them in any case — the only policy admitting a NULL-tenant step is
--   app_signup's.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $close_documenso$
DECLARE
  v_ids      uuid[];
  v_tenants  uuid[];
  v_unbound  integer;
  v_expected integer;
  v_closed   integer := 0;
  v_rows     integer;
  i          integer;
BEGIN
  -- 1 · WHAT SHOULD CHANGE — read as auth_owner, the one role with a platform-wide read on this table.
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), coalesce(array_agg(tenant_id ORDER BY id), '{}')
    INTO v_ids, v_tenants
    FROM keystone.provisioning_step
   WHERE name = 'documenso_team' AND state = 'awaiting_human' AND tenant_id IS NOT NULL;
  SELECT count(*) INTO v_unbound
    FROM keystone.provisioning_step
   WHERE name = 'documenso_team' AND state = 'awaiting_human' AND tenant_id IS NULL;
  SET LOCAL ROLE app_owner;
  v_expected := coalesce(array_length(v_ids, 1), 0);

  -- 2 · CLOSE EACH ONE under its own practice's context.
  FOR i IN 1 .. v_expected LOOP
    PERFORM set_config('keystone.tenant_id', v_tenants[i]::text, true);
    UPDATE keystone.provisioning_step
       SET state        = 'skipped',
           last_error   = 'Documenso was retired on 17 Sep 2026 (spec 01 default 9). Workbench signs documents itself, so this step has nothing left to do.',
           completed_at = now()
     WHERE id = v_ids[i] AND name = 'documenso_team' AND state = 'awaiting_human';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_closed := v_closed + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  -- 3 · EVERY ROW THAT SHOULD HAVE CHANGED, DID. Zero and zero is legitimate (a fresh database has no
  --     pre-retirement run); a mismatch means the update could not see a row it was meant to reach.
  IF v_closed <> v_expected THEN
    RAISE EXCEPTION '0131: expected to close % practice-bound documenso_team step(s), closed % — the update did not reach every row (RLS?)', v_expected, v_closed;
  END IF;

  -- 4 · NONE LEFT — re-read as auth_owner, so "none left" is a read that CAN see rows.
  SET LOCAL ROLE auth_owner;
  SELECT count(*) INTO v_rows FROM keystone.provisioning_step
   WHERE name = 'documenso_team' AND state = 'awaiting_human' AND tenant_id IS NOT NULL;
  SET LOCAL ROLE app_owner;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '0131: % practice-bound documenso_team step(s) still awaiting a human after the update', v_rows;
  END IF;

  RAISE NOTICE '0131: closed % practice-bound documenso_team step(s) as skipped; left % unbound (no practice) untouched', v_closed, v_unbound;
END
$close_documenso$;
