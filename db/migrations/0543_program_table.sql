-- 0543_program_table
--
-- FOLLOW-UP BRIEF, Part 1 — "replace the hard-coded coaching_group with a real Programs system."
-- `coaching_group` (migration 0536) is a two-value CHECK constraint ('life'|'recovery') — the exact
-- ORPHAN-adjacent shape CLAUDE.md warns about: a picker's list of choices frozen into a column's own
-- CHECK, so adding a third line of business (Part 8's Family Coaching) would mean another migration
-- touching a constraint instead of inserting a row. `keystone.program` is a real, editable,
-- tenant-scoped table — CT-F52's full new-tenant-table checklist, all eight points, modelled
-- EXACTLY on `keystone.service_category` (0409 §A), since a Program is the same shape one level up:
-- a named, ordered, delete-not-archive grouping that services/packages/plans point into.
--
-- ★★★ THIS MIGRATION IS PURELY ADDITIVE. `coaching_group` is NOT touched, NOT dropped, NOT made
--     nullable — every existing read/write of it (src/items/writes.mjs, editors.mjs,
--     records/lists/items.mjs, money/catalogue.mjs, money/metadata.mjs, routes/app.mjs,
--     CoachingGroupGate.jsx) keeps working unchanged whether or not this migration has been applied
--     yet. `program_id` is a NEW, NULLABLE column: old code that never mentions it is unaffected:
--     new code (this session's) treats it as OPTIONAL on every create/update, so a request that
--     omits it behaves exactly as it did before this migration existed. This is deliberate —
--     dropping `coaching_group` (the "contract" half of expand/contract) is FUTURE work, done only
--     after Ty confirms this migration is live AND the UI has fully switched over; doing both in one
--     migration would make today's already-deployed app 500 on every catalogue write the moment this
--     file is applied, before the new UI is even live to stop sending the old field.
-- ★★ SCOPE-WIDENED PAST GLRS. Unlike 0536 (which sends Stripe metadata scoped to GLRS's own
--    catalogue), `program` is basic catalogue *structure* — every practice gets it, the same way
--    every practice gets `keystone.unit` (0409 §C) whether or not it has sold anything yet. Two
--    starter rows ('Life Coaching', 'Recovery Coaching') seeded for every tenant below; Part 8's
--    third row ('Family Coaching') is GLRS-only, in its own migration (0546).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.program — CT-F52, all eight points, modelled on keystone.service_category (0409 §A).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.program (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  position    integer     NOT NULL DEFAULT 0,
  visibility  text        NOT NULL DEFAULT 'shown' CHECK (visibility IN ('first','shown','hidden','last')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_tenant_id_key ON keystone.program (tenant_id, id);
CREATE UNIQUE INDEX program_tenant_name_key ON keystone.program (tenant_id, lower(name));

ALTER TABLE keystone.program ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.program FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.program USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.program FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.program FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★ Same delete-not-archive shape as service_category (0409 §A note): a Program has no active/
--   archived column — either it exists or it is deleted, guarded by the reference count at the
--   application layer (deleteProgram, Part 9) before the DELETE is ever issued.
CREATE POLICY tenant_delete ON keystone.program FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.program FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.program TO app_rw;
GRANT SELECT ON keystone.program TO reference_guard;
CREATE TRIGGER program_touch BEFORE UPDATE ON keystone.program
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ★★★ THE EXECUTE LEND (0409 §A's own note, verbatim reasoning) — CREATE TRIGGER needs EXECUTE on
--     keystone.refuse_touch_reference_rows() at CREATE time; app_owner holds no standing grant.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER program_refuse_reference_delete_trg AFTER DELETE ON keystone.program
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.program ENABLE ALWAYS TRIGGER program_refuse_reference_delete_trg;
CREATE TRIGGER program_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.program
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.program ENABLE ALWAYS TRIGGER program_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ── CT-F52 point 6 — the self-check, modelled on 0409's own. ─────────────────────────────────────
DO $program_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.program'::regclass) THEN
    RAISE EXCEPTION '0543: keystone.program does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.program'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION '0543: keystone.program does not carry exactly the five expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.program'::regclass
     AND tgname IN ('program_refuse_reference_delete_trg', 'program_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0543: keystone.program does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.program'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])
     <> 1 THEN
    RAISE EXCEPTION '0543: reference_guard_read on keystone.program is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE)';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.program', 'SELECT') THEN
    RAISE EXCEPTION '0543: app_rw is missing SELECT on keystone.program';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.program', 'INSERT') THEN
    RAISE EXCEPTION '0543: app_rw is missing INSERT on keystone.program';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.program', 'UPDATE') THEN
    RAISE EXCEPTION '0543: app_rw is missing UPDATE on keystone.program';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.program', 'DELETE') THEN
    RAISE EXCEPTION '0543: app_rw is missing DELETE on keystone.program';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.program', 'SELECT') THEN
    RAISE EXCEPTION '0543: reference_guard is missing SELECT on keystone.program';
  END IF;
END
$program_ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — program_id on service/package/plan. NULLABLE — see the additive note at the top of this file.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.service ADD COLUMN program_id uuid NULL;
ALTER TABLE keystone.service
  ADD CONSTRAINT service_program_id_fkey FOREIGN KEY (tenant_id, program_id)
    REFERENCES keystone.program (tenant_id, id) ON DELETE SET NULL (program_id);

ALTER TABLE keystone.package ADD COLUMN program_id uuid NULL;
ALTER TABLE keystone.package
  ADD CONSTRAINT package_program_id_fkey FOREIGN KEY (tenant_id, program_id)
    REFERENCES keystone.program (tenant_id, id) ON DELETE SET NULL (program_id);

ALTER TABLE keystone.plan ADD COLUMN program_id uuid NULL;
ALTER TABLE keystone.plan
  ADD CONSTRAINT plan_program_id_fkey FOREIGN KEY (tenant_id, program_id)
    REFERENCES keystone.program (tenant_id, id) ON DELETE SET NULL (program_id);

COMMENT ON COLUMN keystone.service.program_id IS
  '0543: which Program (Life Coaching / Recovery Coaching / …) this belongs to — the real, editable '
  'replacement for coaching_group (0536), kept alongside it during the transition (see file header). '
  'Nullable: a NULL row has not been re-pointed at a Program yet and falls back to reading '
  'coaching_group, same as every row created before this migration.';
COMMENT ON COLUMN keystone.package.program_id IS '0543: see keystone.service.program_id.';
COMMENT ON COLUMN keystone.plan.program_id    IS '0543: see keystone.service.program_id.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §C — seed 'Life Coaching' and 'Recovery Coaching' for EVERY tenant (unlike 0536's GLRS-only
-- catalogue seed, this is structure every practice gets — same footing as keystone.unit, 0409 §D),
-- then backfill program_id on every existing row from its own coaching_group value.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ FOUND LIVE, TESTING THIS MIGRATION LOCALLY — the first draft of this DO block counted rows
--     backfilled, and the trailing self-check below it, AFTER `set_config('keystone.tenant_id', '',
--     true)` had already cleared the GUC. Under FORCE ROW LEVEL SECURITY that makes every SELECT
--     see zero rows regardless of what the UPDATEs actually did — a MISSING-NEGATIVE: the self-check
--     "no row is missing a program_id" was reported as passing on a database where RLS was hiding
--     every row, service/package/plan included, so it would have passed identically whether the
--     backfill worked or did nothing at all. The real UPDATEs (inside the loop, properly
--     GUC-scoped) are not in question — the per-tenant guard below (raising if a tenant's own
--     seeded program came back NULL) ran clean across every practice with no exception, which is
--     EXECUTED evidence the seeding+lookup half worked — but the count and the "nothing missed"
--     check are moved INSIDE the loop, per-tenant, before the GUC is ever cleared, so they can
--     actually fail when something is wrong instead of only when nothing is checked.
DO $program_backfill$
DECLARE
  v_tenant_ids     uuid[];
  v_tenant_count   integer;
  v_tenant_id      uuid;
  v_life_id        uuid;
  v_recovery_id    uuid;
  v_practices      integer := 0;
  v_rows_updated   bigint  := 0;
  v_tenant_missing bigint;
  i                integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0543: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0543: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    INSERT INTO keystone.program (tenant_id, name, position)
      VALUES (v_tenant_id, 'Life Coaching', 0)
      ON CONFLICT (tenant_id, lower(name)) DO NOTHING;
    INSERT INTO keystone.program (tenant_id, name, position)
      VALUES (v_tenant_id, 'Recovery Coaching', 1)
      ON CONFLICT (tenant_id, lower(name)) DO NOTHING;

    SELECT id INTO v_life_id FROM keystone.program WHERE tenant_id = v_tenant_id AND lower(name) = 'life coaching';
    SELECT id INTO v_recovery_id FROM keystone.program WHERE tenant_id = v_tenant_id AND lower(name) = 'recovery coaching';
    IF v_life_id IS NULL OR v_recovery_id IS NULL THEN
      RAISE EXCEPTION '0543: practice % is missing a seeded program after insert (life=%, recovery=%)',
        v_tenant_id, v_life_id, v_recovery_id;
    END IF;

    UPDATE keystone.service SET program_id = v_life_id
      WHERE tenant_id = v_tenant_id AND coaching_group = 'life' AND program_id IS NULL;
    UPDATE keystone.service SET program_id = v_recovery_id
      WHERE tenant_id = v_tenant_id AND coaching_group = 'recovery' AND program_id IS NULL;
    UPDATE keystone.package SET program_id = v_life_id
      WHERE tenant_id = v_tenant_id AND coaching_group = 'life' AND program_id IS NULL;
    UPDATE keystone.package SET program_id = v_recovery_id
      WHERE tenant_id = v_tenant_id AND coaching_group = 'recovery' AND program_id IS NULL;
    UPDATE keystone.plan SET program_id = v_life_id
      WHERE tenant_id = v_tenant_id AND coaching_group = 'life' AND program_id IS NULL;
    UPDATE keystone.plan SET program_id = v_recovery_id
      WHERE tenant_id = v_tenant_id AND coaching_group = 'recovery' AND program_id IS NULL;

    -- ★ PER-TENANT CHECK, WHILE THE GUC IS STILL SET TO THIS TENANT — every row this practice owns
    --   that has a coaching_group must now also have a program_id, since v_life_id/v_recovery_id
    --   are both known non-null (the exception above would have fired otherwise) and cover the
    --   CHECK constraint's only two values.
    SELECT count(*) INTO v_tenant_missing FROM (
      SELECT id FROM keystone.service WHERE tenant_id = v_tenant_id AND program_id IS NULL
      UNION ALL SELECT id FROM keystone.package WHERE tenant_id = v_tenant_id AND program_id IS NULL
      UNION ALL SELECT id FROM keystone.plan WHERE tenant_id = v_tenant_id AND program_id IS NULL
    ) x;
    IF v_tenant_missing <> 0 THEN
      RAISE EXCEPTION '0543: practice % still has % catalogue row(s) with no program_id after its own backfill',
        v_tenant_id, v_tenant_missing;
    END IF;

    SELECT count(*) INTO v_tenant_missing FROM (
      SELECT id FROM keystone.service WHERE tenant_id = v_tenant_id AND program_id IS NOT NULL
      UNION ALL SELECT id FROM keystone.package WHERE tenant_id = v_tenant_id AND program_id IS NOT NULL
      UNION ALL SELECT id FROM keystone.plan WHERE tenant_id = v_tenant_id AND program_id IS NOT NULL
    ) x;
    v_rows_updated := v_rows_updated + v_tenant_missing;
    v_practices := v_practices + 1;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0543: % practice(s) seeded with Life/Recovery programs and confirmed with no missing program_id · % catalogue row(s) carry a program_id in total',
    v_practices, v_rows_updated;
END
$program_backfill$;
