-- 0381_location
--
-- 12.2 / OQ-12.1 (RULED: Stage 12 owns the location model; every other stage consumes) / CT-F22.
-- `keystone.location` — the practice's places: name, address, timezone, opening hours (D7, no
-- writer this stage), and a Stripe Terminal location id (01 §0.2, Stage 15 writes it). Backfilled
-- below with exactly ONE location per practice, named after the practice, so a shift (12.3/12.4)
-- has somewhere to be on day one. The management SCREEN is Stage 17's (F12).
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, for keystone.location.

CREATE TABLE keystone.location (
  id            uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  address_line1 text, address_line2 text, city text, state_region text, postcode text, country text,
  timezone      text NOT NULL,
  opening_hours jsonb NULL,                -- D7; no writer this stage
  stripe_terminal_location_id text NULL,   -- 01 §0.2; Stage 15 writes it
  archived_at   timestamptz NULL,
  created_by    uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX location_tenant_id_key ON keystone.location (tenant_id, id);
CREATE UNIQUE INDEX location_tenant_name_key ON keystone.location (tenant_id, lower(name)) WHERE archived_at IS NULL;
ALTER TABLE keystone.location ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.location FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.location USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.location FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.location FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ CT-F52 point 3 — the reference guard. Without it catalog-conformance's SET-EQUALITY check fails.
CREATE POLICY reference_guard_read ON keystone.location FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.location TO app_rw;
GRANT SELECT ON keystone.location TO reference_guard;
-- ★★★ CT-F52 point 5 — BOTH triggers, BOTH `ENABLE ALWAYS`. Without them catalog-conformance's
--     COVERAGE check fails (`catalog-conformance.mjs:186-195`: "has a tenant_id column and no
--     refuse_touch_reference_rows trigger, and is not on the EXEMPT list with a reason").
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE EXECUTE LEND — ADDED 25 Sep 2026, BEFORE THIS MIGRATION HAD EVER BEEN APPLIED.
--     WITHOUT IT THE `CREATE TRIGGER` STATEMENTS BELOW FAIL: "permission denied for function
--     keystone.refuse_touch_reference_rows()". CREATE TRIGGER requires EXECUTE on the trigger
--     function, checked at CREATE time (0151:91-110, EXECUTED — that migration hit this exact
--     failure in its own first draft and recorded it).
--   ★★ MEASURED, the three facts that make it unavoidable: `0099:83` REVOKEd ALL on the function
--      FROM PUBLIC, so the default grant every new function gets is gone; `0144:245` ALTERed it
--      OWNER TO `reference_guard`, so app_owner does not own it; and every migration that has ever
--      borrowed it (0151, 0400, 0402, 0408, 0414, 0415) REVOKEs it again at the end, so **there is
--      no standing grant to inherit.** The migration runner does `SET ROLE app_owner`
--      (`db/migrate.mjs:179`) — it is not superuser, so the privilege check is real.
--   ★ CONTRACTS.md CT-F52 point 4b says the trigger functions "need no per-table grant". That is
--     true of a PERSISTENT grant and was read here as ruling out this temporary borrow too — which
--     is how five pending migrations came to be written without it. The borrow is not a per-table
--     grant; it is held for the CREATE and handed straight back.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;


CREATE TRIGGER location_refuse_reference_delete_trg AFTER DELETE ON keystone.location
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.location ENABLE ALWAYS TRIGGER location_refuse_reference_delete_trg;
CREATE TRIGGER location_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.location
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.location ENABLE ALWAYS TRIGGER location_refuse_reference_truncate_trg;

-- ★ Handed straight back — app_owner must not keep EXECUTE on the reference guard's own function.
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;


-- CT-F52 point 4b, bullet 1: the reference_guard_read policy above is the PLAIN form (point 3) —
-- its USING clause calls no function — so there is nothing for a GRANT EXECUTE to name. Bullet 2:
-- keystone.refuse_touch_reference_rows() is owned BY reference_guard (0144:245), so the trigger
-- functions need no per-table grant either; no redundant grant added, function not re-owned.
-- Bullet 3 is asserted below, in the self-check DO block.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 6 — THE SELF-CHECK, modelled on 0369/0370. RAISEs unless every point (1)-(5), 4b
-- included, holds. Carries its POSITIVE CONTROL inside the SQL: a block made only of negative
-- assertions would pass on a database where nothing exists at all.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.location'::regclass) THEN
    RAISE EXCEPTION '0381: keystone.location does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.location'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0381: keystone.location does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.location'::regclass
     AND tgname IN ('location_refuse_reference_delete_trg', 'location_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0381: keystone.location does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  -- CT-F52 point 4b, bullet 3 / 0144 §e's end state: reference_guard_read on this table is
  -- exactly (TO reference_guard, FOR SELECT, PERMISSIVE) and nothing else.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.location'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0381: reference_guard_read on keystone.location is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.location', 'SELECT') THEN
    RAISE EXCEPTION '0381: app_rw is missing SELECT on keystone.location';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.location', 'INSERT') THEN
    RAISE EXCEPTION '0381: app_rw is missing INSERT on keystone.location';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.location', 'UPDATE') THEN
    RAISE EXCEPTION '0381: app_rw is missing UPDATE on keystone.location';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.location', 'DELETE') THEN
    RAISE EXCEPTION '0381: app_rw must not hold DELETE on keystone.location — nothing deletes a location; updateLocation archives instead';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.location', 'SELECT') THEN
    RAISE EXCEPTION '0381: reference_guard is missing SELECT on keystone.location';
  END IF;
END
$ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL — one location per practice, named after the practice, in the practice's own timezone
-- (0172 pattern: enumerate as auth_owner, write per-practice as app_owner under its own GUC).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $location_backfill$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_names text[];
  v_tenant_tzs   text[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_name         text;
  v_tz           text;
  v_inserted     integer := 0;
  v_row_count    integer;
  i              integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'),
         coalesce(array_agg(name ORDER BY id), '{}'),
         coalesce(array_agg(timezone ORDER BY id), '{}'),
         count(*)
    INTO v_tenant_ids, v_tenant_names, v_tenant_tzs, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0381: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    v_name      := v_tenant_names[i];
    v_tz        := v_tenant_tzs[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★ The GUC actually took effect — the anti-F490 assertion.
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0381: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    INSERT INTO keystone.location (tenant_id, name, timezone)
    SELECT v_tenant_id, v_name, coalesce(v_tz, 'UTC')
     WHERE NOT EXISTS (SELECT 1 FROM keystone.location WHERE tenant_id = v_tenant_id);
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0381: % practice(s) enumerated · % location(s) inserted', v_tenant_count, v_inserted;
END
$location_backfill$;

-- ★★★ THE CLOSING ASSERTION — an independent re-read, not the counters above. Re-enumerates the
--     practices AGAIN as auth_owner and re-reads each one under its own GUC as app_owner, because
--     a single global count(*) on a FORCE-RLS table with no GUC set would read 0 rows and pass
--     vacuously (F143/F490's shape).
DO $every_practice_holds_a_location$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_n          integer;
  i            integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    SELECT count(*) INTO v_n FROM keystone.location WHERE tenant_id = v_tenant_id;
    IF v_n = 0 THEN
      RAISE EXCEPTION '0381: practice % has no location after backfill', v_tenant_id;
    END IF;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0381: every one of % practice(s) confirmed to hold at least one location', coalesce(array_length(v_tenant_ids, 1), 0);
END
$every_practice_holds_a_location$;
