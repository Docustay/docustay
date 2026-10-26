-- 0409_service_category_and_unit
--
-- Stage 14 task 14.2 — categories group services; units say what a thing is sold by; every
-- practice starts with the seven units. Two new tenant tables (`keystone.service_category`,
-- `keystone.unit`) and one SECURITY DEFINER function (`keystone.seed_units`) that seeds the seven
-- built-in units into a practice, on the same "the signup role cannot read back what it inserts"
-- footing as `keystone.seed_builtin_roles` (`src/provisioning/prefix.mjs:181-184`: `app_signup` has
-- no SELECT policy on anything and so cannot read back the id of a row it just created).
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, for BOTH `keystone.service_category`
-- and `keystone.unit`. `db/gates/p21a_cross_tenant_fuzz.mjs` enumerates tables from `pg_class`, so
-- both are picked up automatically and both must pass independently.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.service_category
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.service_category (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  position    integer     NOT NULL DEFAULT 0,
  visibility  text        NOT NULL DEFAULT 'shown' CHECK (visibility IN ('first','shown','hidden','last')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX service_category_tenant_id_key ON keystone.service_category (tenant_id, id);
CREATE UNIQUE INDEX service_category_tenant_name_key ON keystone.service_category (tenant_id, lower(name));

ALTER TABLE keystone.service_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.service_category FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.service_category USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.service_category FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.service_category FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ tenant_delete — ADDED 25 Sep 2026, BEFORE THIS MIGRATION HAD EVER BEEN APPLIED.
--     THIS FILE ORIGINALLY SAID "no delete path this stage" AND ASSERTED app_rw HELD NO DELETE.
--     THAT WAS WRONG WITHIN ITS OWN STAGE: task 14.16's field 4 requires a real `deleteCategory`
--     and a `POST /api/items/categories/delete` route, with the exact 409 sentence while the
--     category is still referenced. 14.16's builder measured the contradiction and reported it
--     rather than silently downgrading the delete to a no-op; this is the other half of the fix.
--   ★★ A CATEGORY CANNOT BE "TURNED OFF" INSTEAD. Unlike `keystone.unit` below — which carries
--      `is_active` and is deliberately toggled, never deleted — `service_category` has no active
--      or archived column at all. There is no third option: either the grant exists or the route
--      500s on every call. Every tenant-scoped request runs as `app_rw`.
--   ★ CT-F52 point 1 requires the policy wherever the grant exists, so the two land together.
CREATE POLICY tenant_delete ON keystone.service_category FOR DELETE USING (tenant_id = keystone.current_tenant_id());
-- ★★★ CT-F52 point 3 — the reference guard. Without it catalog-conformance's SET-EQUALITY check fails.
CREATE POLICY reference_guard_read ON keystone.service_category FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.service_category TO app_rw;
GRANT SELECT ON keystone.service_category TO reference_guard;
CREATE TRIGGER service_category_touch BEFORE UPDATE ON keystone.service_category
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
-- ★★★ CT-F52 point 5 — BOTH triggers, BOTH ENABLE ALWAYS.
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


CREATE TRIGGER service_category_refuse_reference_delete_trg AFTER DELETE ON keystone.service_category
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.service_category ENABLE ALWAYS TRIGGER service_category_refuse_reference_delete_trg;
CREATE TRIGGER service_category_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.service_category
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.service_category ENABLE ALWAYS TRIGGER service_category_refuse_reference_truncate_trg;

-- CT-F52 point 4b, bullet 1: reference_guard_read above is the PLAIN form (point 3) — its USING
-- clause calls no function — so there is nothing for a GRANT EXECUTE to name. Bullet 2:
-- keystone.refuse_touch_reference_rows() is owned BY reference_guard (0144:245), so the trigger
-- functions need no per-table grant either. Bullet 3 is asserted below, in the self-check.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 6 — THE SELF-CHECK for keystone.service_category, modelled on 0381/0402. RAISEs
-- unless every point (1)-(5), 4b included, holds. Carries its POSITIVE CONTROL inside the SQL.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $service_category_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.service_category'::regclass) THEN
    RAISE EXCEPTION '0409: keystone.service_category does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.service_category'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION '0409: keystone.service_category does not carry exactly the five expected policies (found %)', v_policy_count;
  END IF;
  -- ★★★ THE ASSERTION THAT USED TO STAND HERE SAID THE OPPOSITE — "has a tenant_delete policy but
  --     no delete path". 14.16 builds the delete path in this same stage, so the policy is now
  --     REQUIRED and its absence is the failure. Flipped 25 Sep 2026, unapplied. See §A's note.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
                  AND tablename='service_category' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0409: service_category has a delete path (14.16) but no tenant_delete policy — every delete would be silently filtered by FORCEd RLS';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.service_category'::regclass
     AND tgname IN ('service_category_refuse_reference_delete_trg', 'service_category_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0409: keystone.service_category does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  -- CT-F52 point 4b, bullet 3 / 0144 §e's end state.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.service_category'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])
     <> 1 THEN
    RAISE EXCEPTION '0409: reference_guard_read on keystone.service_category is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all.
  IF NOT has_table_privilege('app_rw', 'keystone.service_category', 'SELECT') THEN
    RAISE EXCEPTION '0409: app_rw is missing SELECT on keystone.service_category';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.service_category', 'INSERT') THEN
    RAISE EXCEPTION '0409: app_rw is missing INSERT on keystone.service_category';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.service_category', 'UPDATE') THEN
    RAISE EXCEPTION '0409: app_rw is missing UPDATE on keystone.service_category';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.service_category', 'DELETE') THEN
    RAISE EXCEPTION '0409: app_rw is missing DELETE on keystone.service_category — 14.16''s deleteCategory would fail with insufficient_privilege on every call';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.service_category', 'SELECT') THEN
    RAISE EXCEPTION '0409: reference_guard is missing SELECT on keystone.service_category';
  END IF;
END
$service_category_ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — keystone.unit
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.unit (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key         text        NOT NULL CHECK (key ~ '^[a-z][a-z_]*$'),
  name        text        NOT NULL,
  plural      text        NOT NULL,
  active      boolean     NOT NULL DEFAULT false,
  is_default  boolean     NOT NULL DEFAULT false,
  is_seeded   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE UNIQUE INDEX unit_tenant_id_key ON keystone.unit (tenant_id, id);
CREATE UNIQUE INDEX unit_one_default ON keystone.unit (tenant_id) WHERE is_default;

ALTER TABLE keystone.unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.unit FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.unit USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.unit FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.unit FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ CT-F52 point 3 — the reference guard.
CREATE POLICY reference_guard_read ON keystone.unit FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.unit TO app_rw;
GRANT SELECT ON keystone.unit TO reference_guard;
CREATE TRIGGER unit_touch BEFORE UPDATE ON keystone.unit
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
-- ★★★ CT-F52 point 5 — BOTH triggers, BOTH ENABLE ALWAYS.
CREATE TRIGGER unit_refuse_reference_delete_trg AFTER DELETE ON keystone.unit
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.unit ENABLE ALWAYS TRIGGER unit_refuse_reference_delete_trg;
CREATE TRIGGER unit_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.unit
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.unit ENABLE ALWAYS TRIGGER unit_refuse_reference_truncate_trg;

-- ★ Handed straight back — app_owner must not keep EXECUTE on the reference guard's own function.
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;


-- CT-F52 point 4b, bullets 1 and 2 as above — the plain USING clause calls no function, and the
-- guard trigger functions are owned BY reference_guard already. Bullet 3 is asserted below.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 6 — THE SELF-CHECK for keystone.unit.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $unit_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.unit'::regclass) THEN
    RAISE EXCEPTION '0409: keystone.unit does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.unit'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0409: keystone.unit does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='unit' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0409: unit has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.unit'::regclass
     AND tgname IN ('unit_refuse_reference_delete_trg', 'unit_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0409: keystone.unit does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.unit'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])
     <> 1 THEN
    RAISE EXCEPTION '0409: reference_guard_read on keystone.unit is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.unit', 'SELECT') THEN
    RAISE EXCEPTION '0409: app_rw is missing SELECT on keystone.unit';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.unit', 'INSERT') THEN
    RAISE EXCEPTION '0409: app_rw is missing INSERT on keystone.unit';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.unit', 'UPDATE') THEN
    RAISE EXCEPTION '0409: app_rw is missing UPDATE on keystone.unit';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.unit', 'DELETE') THEN
    RAISE EXCEPTION '0409: app_rw must not hold DELETE on keystone.unit — units are toggled off (active=false), never deleted';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.unit', 'SELECT') THEN
    RAISE EXCEPTION '0409: reference_guard is missing SELECT on keystone.unit';
  END IF;
END
$unit_ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §C — keystone.seed_units(p_tenant_id uuid) — the risky part.
--
-- SECURITY DEFINER, SET search_path = '' (db/gates/p21a_definer_search_path.mjs requires the empty
-- search_path on every definer; every identifier below is schema-qualified accordingly — an
-- unqualified `unit` would fail at RUNTIME, not at creation, exactly because there is no search_path
-- left to resolve it).
--
-- DEFINER because the signup role cannot read back what it inserts — same footing as
-- keystone.seed_builtin_roles (src/provisioning/prefix.mjs:181-184, MEASURED: "app_signup has no
-- SELECT policy on anything and so cannot read back the id of the role it just created").
--
-- The refusal guard is copied in SHAPE from keystone.seed_builtin_roles's own refusal
-- (db/migrations/0367_seed_role_action_and_backfill.sql:32-37, MEASURED — the cited plan line
-- "0367:28-34" is the header/blank-line-shifted position of the SAME guard in the file as it reads
-- today; the guard text itself, "asked to seed tenant % while the transaction is in tenant %", is
-- reproduced verbatim below) — this is the whole reason the function can be DEFINER safely: it
-- refuses to seed any tenant other than the one the caller's own transaction is already inside.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.seed_units(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF p_tenant_id IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION
      'seed_units refused: asked to seed tenant % while the transaction is in tenant % — '
      'a caller may only seed the tenant it is already inside',
      p_tenant_id, coalesce(keystone.current_tenant_id()::text, '(none)');
  END IF;

  INSERT INTO keystone.unit (tenant_id, key, name, plural, active, is_default, is_seeded)
  SELECT p_tenant_id, v.key, v.name, v.plural, v.active, v.is_default, true
    FROM (VALUES
      ('session',   'Session',    'Sessions',    true,  true),
      ('hour',      'Hour',       'Hours',       true,  false),
      ('month',     'Month',      'Months',      true,  false),
      ('each',      'Each',       'Each',        true,  false),
      ('day',       'Day',        'Days',        false, false),
      ('week',      'Week',       'Weeks',       false, false),
      ('half_hour', 'Half hour',  'Half hours',  false, false)
    ) AS v(key, name, plural, active, is_default)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION keystone.seed_units(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.seed_units(uuid) TO app_rw, app_signup;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §D — BACKFILL every existing practice (§0.4 D pattern, db/migrations/0172_idempotency_redaction_backfill.sql
-- / db/migrations/0381_location.sql, M): enumerate as auth_owner, then per practice SET the GUC,
-- PROVE it took, PERFORM keystone.seed_units(v_tenant_id) as app_owner (which is exactly the tenant
-- the GUC now names, so the DEFINER's own guard above passes), and assert the closing per-practice
-- row count. Under FORCE RLS a loop that never set the GUC would insert nothing and still report
-- success — the per-practice assertion below is what stops that from passing silently.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $unit_backfill$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_seeded_count integer;
  v_practices    integer := 0;
  v_total        bigint  := 0;
  i              integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0409: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★★★ the anti-F490 assertion: the GUC actually took effect for THIS practice.
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0409: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    PERFORM keystone.seed_units(v_tenant_id);

    -- ★ per-practice closing assertion, field 4(d): exactly 7 seeded units for THIS practice —
    --   a silent no-op (GUC unset, insert matched nothing) cannot pass this.
    SELECT count(*) INTO v_seeded_count
      FROM keystone.unit WHERE tenant_id = v_tenant_id AND is_seeded = true;
    IF v_seeded_count <> 7 THEN
      RAISE EXCEPTION '0409: practice % holds % seeded unit(s) after seed_units, expected exactly 7',
        v_tenant_id, v_seeded_count;
    END IF;

    v_practices := v_practices + 1;
    v_total := v_total + v_seeded_count;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0409: % practice(s) enumerated · % practice(s) confirmed with exactly 7 seeded units · % seeded unit row(s) total',
    v_tenant_count, v_practices, v_total;
END
$unit_backfill$;
