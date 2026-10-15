-- 0411_modifier_and_line_item_widening — Stage 14 task 14.4 (STAGE-14-PLAN.md §14.4)
--
-- A MODIFIER is a reusable priced/timed add-on that can be attached to one or more services
-- (`keystone.modifier_service`), and `line_item` gains `modifier_id` + `unit` so a sold line can
-- name the modifier it carried and the unit it was sold in.
--
-- ★★ MONEY SHAPE HELD: this migration never lets a past line's agreed amount move. `line_item`
--    still snapshots `unit_amount_minor` once, at sale, and nothing here writes to it. `modifier_id`
--    and `unit` are new NULLable columns with NO WRITER in this stage — 7-pt CALLERS records that
--    the column writer is Stage 15's `15.68` (CT-F37, CT-F41); this migration only makes room.
--
-- No backfill of `unit` on existing lines: production has 0 rows in `keystone.line_item` at 0411
-- (measured, §0.3 of STAGE-14-PLAN.md); lines written after this migration snapshot `unit` at sale
-- (Stage 15's `15.68`).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0411: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  IF to_regclass('keystone.line_item') IS NULL THEN
    RAISE EXCEPTION '0411: keystone.line_item does not exist';
  END IF;
  IF to_regclass('keystone.service') IS NULL THEN
    RAISE EXCEPTION '0411: keystone.service does not exist';
  END IF;

  IF to_regclass('keystone.modifier') IS NOT NULL THEN
    RAISE EXCEPTION '0411: keystone.modifier already exists';
  END IF;
  IF to_regclass('keystone.modifier_service') IS NOT NULL THEN
    RAISE EXCEPTION '0411: keystone.modifier_service already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'line_item'
       AND column_name IN ('modifier_id', 'unit')
  ) THEN
    RAISE EXCEPTION '0411: keystone.line_item already has modifier_id or unit — check for a duplicate run';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'line_item_at_most_one_source'
  ) THEN
    RAISE EXCEPTION '0411: line_item_at_most_one_source does not exist — cannot widen a constraint that is not there';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · keystone.modifier — §0.4 A shape
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.modifier (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name               text        NOT NULL CHECK (btrim(name) <> ''),
  price_delta_minor  integer     NULL,
  minutes_delta      integer     NULL,
  applies            text        NOT NULL DEFAULT 'all' CHECK (applies IN ('all', 'one_to_one', 'list')),
  after_time         time        NULL,
  active             boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modifier_changes_something CHECK (price_delta_minor IS NOT NULL OR minutes_delta IS NOT NULL)
);
CREATE UNIQUE INDEX modifier_tenant_name_key  ON keystone.modifier (tenant_id, lower(name));
CREATE UNIQUE INDEX modifier_tenant_id_id_key ON keystone.modifier (tenant_id, id);
CREATE INDEX        modifier_tenant_idx       ON keystone.modifier (tenant_id);

ALTER TABLE keystone.modifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.modifier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.modifier USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.modifier FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.modifier FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.modifier FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.modifier TO app_rw;

CREATE TRIGGER modifier_touch BEFORE UPDATE ON keystone.modifier
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

COMMENT ON TABLE keystone.modifier IS
  '14.4 (§0.4 A) — a reusable priced/timed add-on. modifier_changes_something requires at least one '
  'of price_delta_minor/minutes_delta set; a modifier that changes nothing is not a modifier.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · keystone.modifier_service — §0.4 A minus touch trigger (join table, service_host's shape)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.modifier_service (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  modifier_id   uuid        NOT NULL,
  service_id    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modifier_service_modifier_id_fkey FOREIGN KEY (tenant_id, modifier_id)
    REFERENCES keystone.modifier (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT modifier_service_service_id_fkey FOREIGN KEY (tenant_id, service_id)
    REFERENCES keystone.service (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT modifier_service_unique UNIQUE (tenant_id, modifier_id, service_id)
);
CREATE INDEX modifier_service_tenant_idx ON keystone.modifier_service (tenant_id);

ALTER TABLE keystone.modifier_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.modifier_service FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.modifier_service USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.modifier_service FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.modifier_service FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.modifier_service FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.modifier_service TO app_rw;

COMMENT ON TABLE keystone.modifier_service IS
  '14.4 (§0.4 A minus touch trigger) — which services a modifier applies to; join table, service_host''s shape.';

-- ═══ CT-F52 §3.2 points (3)(4)(4b)(5) — THE REFERENCE-PRACTICE GUARD HALF, both tables ═══════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER modifier_refuse_reference_delete_trg AFTER DELETE ON keystone.modifier
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.modifier ENABLE ALWAYS TRIGGER modifier_refuse_reference_delete_trg;
CREATE TRIGGER modifier_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.modifier
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.modifier ENABLE ALWAYS TRIGGER modifier_refuse_reference_truncate_trg;

CREATE TRIGGER modifier_service_refuse_reference_delete_trg AFTER DELETE ON keystone.modifier_service
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.modifier_service ENABLE ALWAYS TRIGGER modifier_service_refuse_reference_delete_trg;
CREATE TRIGGER modifier_service_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.modifier_service
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.modifier_service ENABLE ALWAYS TRIGGER modifier_service_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.modifier TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.modifier FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

GRANT SELECT ON keystone.modifier_service TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.modifier_service FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · line_item — the line that carries a modifier and the unit it was sold in
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A column added to an existing table inherits that table's RLS/policies/grant automatically.
-- `keystone.line_item`'s app_rw grant is TABLE-LEVEL (`GRANT SELECT, INSERT, UPDATE, DELETE ON
-- keystone.%I TO app_rw` in the ENABLE-RLS loop, `db/migrations/0015:363`, MEASURED) — not
-- column-level (contrast `keystone.link_token`, CCR-16) — so no re-grant is needed here.
ALTER TABLE keystone.line_item ADD COLUMN modifier_id uuid NULL;
ALTER TABLE keystone.line_item ADD COLUMN unit        text NULL;

ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_modifier_fkey FOREIGN KEY (tenant_id, modifier_id)
  REFERENCES keystone.modifier (tenant_id, id) ON DELETE SET NULL (modifier_id);

-- ★★★ THE SOURCE CHECK WIDENS FROM THREE TERMS TO FOUR — a line's source may now also be a bare
--     modifier (no service/package/plan underneath it), and still at most one of the four.
ALTER TABLE keystone.line_item DROP CONSTRAINT line_item_at_most_one_source;
ALTER TABLE keystone.line_item
  ADD CONSTRAINT line_item_at_most_one_source
  CHECK ((service_id IS NOT NULL)::int + (package_id IS NOT NULL)::int
       + (plan_id IS NOT NULL)::int + (modifier_id IS NOT NULL)::int <= 1);

COMMENT ON COLUMN keystone.line_item.modifier_id IS
  '14.4 — which modifier this line carried, if any. No writer in Stage 14: Stage 15''s 15.68 '
  '(CT-F37, CT-F41) is the first writer, reading the modifier id 14.79 puts in the '
  'booking.booking.created payload.';
COMMENT ON COLUMN keystone.line_item.unit IS
  '14.4 — the unit this line was sold in, snapshotted at sale (never re-derived from the catalogue '
  'afterwards, same posture as every other line_item snapshot column). No writer in Stage 14 — see '
  'Stage 15''s 15.68. No backfill: 0 rows in keystone.line_item in production at 0411.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §b · SHAPE CHECK — CT-F52 (1)-(5), 4b included, plus line_item's widened shape, with POSITIVE
--      CONTROLS alongside every negative assertion.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $shape_check$
DECLARE
  n int;
BEGIN
  -- ── modifier ──────────────────────────────────────────────────────────────────────────────
  IF to_regclass('keystone.modifier') IS NULL THEN
    RAISE EXCEPTION '0411: keystone.modifier does not exist after CREATE TABLE';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.modifier'::regclass) THEN
    RAISE EXCEPTION '0411: keystone.modifier does not have FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'modifier'
     AND policyname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF n <> 5 THEN
    RAISE EXCEPTION '0411: expected 5 policies on keystone.modifier, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.modifier'::regclass
     AND tgname IN ('modifier_refuse_reference_delete_trg', 'modifier_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0411: both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on keystone.modifier, found %', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.modifier'::regclass AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid] AND polcmd = 'r' AND polpermissive
  ) THEN
    RAISE EXCEPTION '0411: reference_guard_read on keystone.modifier must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ── modifier_service ──────────────────────────────────────────────────────────────────────
  IF to_regclass('keystone.modifier_service') IS NULL THEN
    RAISE EXCEPTION '0411: keystone.modifier_service does not exist after CREATE TABLE';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.modifier_service'::regclass) THEN
    RAISE EXCEPTION '0411: keystone.modifier_service does not have FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'modifier_service'
     AND policyname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF n <> 5 THEN
    RAISE EXCEPTION '0411: expected 5 policies on keystone.modifier_service, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.modifier_service'::regclass
     AND tgname IN ('modifier_service_refuse_reference_delete_trg', 'modifier_service_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0411: both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on keystone.modifier_service, found %', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.modifier_service'::regclass AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid] AND polcmd = 'r' AND polpermissive
  ) THEN
    RAISE EXCEPTION '0411: reference_guard_read on keystone.modifier_service must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ── the named constraints ─────────────────────────────────────────────────────────────────
  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('modifier_changes_something', 'modifier_service_modifier_id_fkey',
                          'modifier_service_service_id_fkey', 'modifier_service_unique',
                          'line_item_modifier_fkey', 'line_item_at_most_one_source')) <> 6 THEN
    RAISE EXCEPTION '0411: one or more named constraints did not get created';
  END IF;

  -- ── line_item's new columns ───────────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'line_item' AND column_name = 'modifier_id'
  ) THEN
    RAISE EXCEPTION '0411: keystone.line_item.modifier_id missing after ALTER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'line_item' AND column_name = 'unit'
  ) THEN
    RAISE EXCEPTION '0411: keystone.line_item.unit missing after ALTER';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'line_item_at_most_one_source')
      NOT LIKE '%modifier_id%' THEN
    RAISE EXCEPTION '0411: line_item_at_most_one_source was not widened to include modifier_id';
  END IF;

  -- ── POSITIVE CONTROLS, in the same block: these must be TRUE ─────────────────────────────
  IF NOT has_table_privilege('app_rw', 'keystone.modifier', 'DELETE') THEN
    RAISE EXCEPTION '0411: app_rw is missing DELETE on keystone.modifier';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.modifier', 'SELECT') THEN
    RAISE EXCEPTION '0411: reference_guard has no SELECT on keystone.modifier; its policy would have nothing underneath it';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.modifier_service', 'DELETE') THEN
    RAISE EXCEPTION '0411: app_rw is missing DELETE on keystone.modifier_service';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.modifier_service', 'SELECT') THEN
    RAISE EXCEPTION '0411: reference_guard has no SELECT on keystone.modifier_service; its policy would have nothing underneath it';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.line_item', 'SELECT') THEN
    RAISE EXCEPTION '0411: app_rw is missing SELECT on keystone.line_item (table-level grant should already cover the new columns)';
  END IF;
  IF NOT has_column_privilege('app_rw', 'keystone.line_item', 'modifier_id', 'UPDATE') THEN
    RAISE EXCEPTION '0411: app_rw cannot UPDATE keystone.line_item.modifier_id — the table-level grant did not extend to the new column';
  END IF;
  -- ★★★ the EXECUTE borrow must have been handed straight back — a migration that ends still
  --     holding it is the defect (CT-F52 point 4b).
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0411: app_owner still holds EXECUTE on refuse_touch_reference_rows() after the borrow — must be revoked';
  END IF;

  RAISE NOTICE '0411: keystone.modifier and keystone.modifier_service carry FORCE RLS + tenant policies + reference guard; line_item.modifier_id/unit added; line_item_at_most_one_source widened to 4 terms.';
END
$shape_check$;

-- Written, not applied.
