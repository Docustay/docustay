-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0133 — THE REFERENCE GUARD MUST SEE THE ROWS IT GUARDS, ON EVERY TABLE IT GUARDS (F492).
--
-- ★★★ 0100'S LESSON, ONE LAYER DOWN — THE FIFTH TIME IN THIS PROJECT. `keystone.refuse_touch_reference_rows`
--     is SECURITY DEFINER, owned by app_owner. Its TRUNCATE branch asks "does this table hold any row of the
--     reference practice?" by reading `keystone.<table> x JOIN keystone.tenant t`. 0100 gave app_owner a
--     policy on keystone.tenant (reference rows only) — but NOT on the 65 child tables that carry the guard,
--     all FORCE row-level security. So the child read returned zero rows and the guard agreed with every
--     TRUNCATE put to it.
--     [EXECUTED 17 Sep 2026, local, inside a rolled-back transaction] `TRUNCATE keystone.app_user CASCADE`
--     succeeded while the table held 5 reference-practice rows.
--   ★ The DELETE branch was never blind: it reads the `deleted_rows` transition table, which no policy filters.
--
-- ★★ THE FIX IS 0100'S FIX, AND AS NARROW. On each guarded table: a SELECT policy for app_owner admitting ONLY
--    rows whose tenant is the reference practice. Not USING (true): an ordinary practice's rows stay invisible
--    to app_owner, and the only question the guard can ask — "is any of this the reference practice?" — is the
--    only one this policy lets it answer. (The subquery on keystone.tenant is itself filtered to reference rows
--    by 0100's reference_guard_read, so it cannot widen anything.)
--
-- ★ This file runs as app_owner (db/migrate.mjs per-file SET ROLE), which owns all 65 tables [MEASURED on
--   production and locally], so it may create policies on them. The table set is DISCOVERED from the triggers,
--   not listed by hand, so a table given the guard later is covered by re-applying this pattern — and the
--   count is asserted, so a table the loop silently skipped cannot pass.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $reference_guard_read$
DECLARE
  r          record;
  v_expected integer;
  v_created  integer := 0;
  v_present  integer;
BEGIN
  SELECT count(DISTINCT tg.tgrelid) INTO v_expected
    FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal;

  FOR r IN
    SELECT DISTINCT c.oid, n.nspname, c.relname
      FROM pg_trigger tg
      JOIN pg_proc p      ON p.oid = tg.tgfoid
      JOIN pg_class c     ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal
     ORDER BY n.nspname, c.relname
  LOOP
    -- ★ Every guarded table must have a tenant_id — the guard joins on it. A table without one is a table this
    --   policy cannot be written for, and it is refused loudly rather than skipped.
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = r.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN
      RAISE EXCEPTION '0133: guarded table %.% has no tenant_id column', r.nspname, r.relname;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = r.oid AND polname = 'reference_guard_read') THEN
      EXECUTE format(
        'CREATE POLICY reference_guard_read ON %I.%I FOR SELECT TO app_owner '
        'USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE is_reference))',
        r.nspname, r.relname);
      EXECUTE format(
        'COMMENT ON POLICY reference_guard_read ON %I.%I IS %L',
        r.nspname, r.relname,
        'F492 / 0133. Lets the app_owner-owned reference guard (refuse_touch_reference_rows) SEE this table''s '
        'reference-practice rows on TRUNCATE — and nothing else: SELECT only, reference rows only. Without it the '
        'guard read zero rows (FORCE RLS applies to the owner) and allowed every TRUNCATE.');
      v_created := v_created + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_present
    FROM pg_policy pol
   WHERE pol.polname = 'reference_guard_read'
     AND pol.polrelid IN (SELECT tg.tgrelid FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                           WHERE p.proname = 'refuse_touch_reference_rows' AND NOT tg.tgisinternal);
  IF v_present <> v_expected THEN
    RAISE EXCEPTION '0133: % guarded table(s), but % carry reference_guard_read afterwards', v_expected, v_present;
  END IF;

  RAISE NOTICE '0133: % guarded table(s); created % policy(ies); every guarded table now carries reference_guard_read', v_expected, v_created;
END
$reference_guard_read$;
