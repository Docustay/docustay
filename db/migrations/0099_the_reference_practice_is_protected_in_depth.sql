-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P3 CLOSE (§VISUAL) — 0094's GUARD PROTECTED ONE ROW AGAINST ONE VERB. BOTH HALVES WERE TOO NARROW.
--
-- ★★★ F1 · `TRUNCATE keystone.tenant CASCADE` DESTROYED THE REFERENCE PRACTICE AND THE GUARD NEVER
--     FIRED. [EXECUTED, in a transaction, rolled back]
--       ### A4 TRUNCATE keystone.tenant CASCADE
--           SUCCEEDED — reference practices remaining: 0
--           POSITIVE CONTROL: ordinary tenant deletes — rowCount=1
--     0094 declared `BEFORE DELETE ... FOR EACH ROW`, and **a row-level DELETE trigger does not fire
--     on TRUNCATE.** TRUNCATE needs its own `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger.
--   ★★ The whole thesis of 0094 was *"a trigger that cannot be turned off by the only tool that
--      turns triggers off."* **TRUNCATE is a second such tool and it was not covered** — and no gate
--      tested it, because the gate tested the two mechanisms the migration had thought of.
--
-- ★★★ F2 · AND THE GUARD PROTECTED THE TENANT **ROW**, NOT THE PRACTICE. [EXECUTED] under
--     `session_replication_role = replica`, **108 child rows were deleted with zero refusal**; the
--     tenant row then refused while marked, and deleted cleanly once unmarked:
--       B2  emptied 108 child rows
--       B2a delete while MARKED = REFUSED ... is permanent and cannot be deleted
--       B2b UNMARK then delete  = SUCCEEDED rc=1  -> tenant rows left: 0
--     `teardownWorld(admin, tenantId, prefix)` takes ANY id and has **no `is_reference` check at
--     all**. So a gate handed the wrong id empties the practice, leaving a marked-but-EMPTY husk —
--     which is worse than deletion, because everything still says the reference practice exists.
--   ★ The only thing standing in the way was a JavaScript `!t.is_reference` in a sweep script:
--     **exactly the convention 0094 says it exists to replace.**
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULING — PROTECT THE PRACTICE, NOT THE ROW; AND COVER EVERY VERB THAT REMOVES DATA.
--
--   · DELETE on any tenant-scoped table → refused if the rows belong to the reference practice.
--   · TRUNCATE on any tenant-scoped table → refused if that table holds ANY reference-practice row.
--   · Both `ENABLE ALWAYS`, so `session_replication_role = replica` does not lift them — the same
--     property 0094 established for the tenant row, extended to everything the practice is made of.
--
-- ★★ STATEMENT-LEVEL WITH A TRANSITION TABLE, NOT ROW-LEVEL. A row trigger doing a lookup per row
--    would tax every gate teardown in the suite — and those delete thousands of rows. `REFERENCING
--    OLD TABLE AS deleted_rows` lets one check cover the whole statement, so the cost is one
--    EXISTS per DELETE rather than one per row.
--  ★ TRUNCATE triggers cannot use transition tables (there are no per-row images), so that check
--    asks the simpler question the verb deserves: does this table hold any reference row at all?
--
-- ★★★ THE HAZARD THIS ACCEPTS, NAMED RATHER THAN DISCOVERED LATER: these triggers make the
--     reference practice genuinely un-emptiable, so `scripts/seed-reference-tenant.mjs` can no
--     longer be "reset by hand". That is the intent — P3.1's own words are *"never torn down"* —
--     and the escape hatch is the two-step it already had: UNMARK `is_reference`, then act.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.refuse_touch_reference_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
BEGIN
  -- ★ TG_OP tells the two cases apart: DELETE has a transition table, TRUNCATE does not.
  IF TG_OP = 'DELETE' THEN
    EXECUTE format(
      'SELECT t.slug FROM deleted_rows d JOIN keystone.tenant t ON t.id = d.tenant_id '
      'WHERE t.is_reference LIMIT 1')
      INTO v_slug;
  ELSE
    EXECUTE format(
      'SELECT t.slug FROM keystone.%I x JOIN keystone.tenant t ON t.id = x.tenant_id '
      'WHERE t.is_reference LIMIT 1', TG_TABLE_NAME)
      INTO v_slug;
  END IF;

  IF v_slug IS NOT NULL THEN
    RAISE EXCEPTION
      '% on keystone.% would remove rows belonging to the reference practice (%), which is '
      'permanent. ★ 0094 protected the tenant ROW; this protects what the practice is MADE OF — a '
      'marked but EMPTY reference practice is worse than a deleted one, because every surface still '
      'reports that it exists. If you are cleaning up after a gate, you have the wrong tenant id.',
      TG_OP, TG_TABLE_NAME, v_slug
      USING ERRCODE = '23503';
  END IF;

  RETURN NULL;   -- ★ statement-level AFTER/BEFORE triggers ignore the return value
END $$;

REVOKE ALL ON FUNCTION keystone.refuse_touch_reference_rows() FROM PUBLIC;

-- ── EVERY TENANT-SCOPED TABLE, FROM THE CATALOGUE ───────────────────────────────────────────────
-- ★★ NOT A HAND-KEPT LIST. This register has recorded twice that a hand-listed set of tables goes
--    stale invisibly (the gate teardowns that omitted six, F187). The catalogue is the list.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'keystone'
       AND c.relkind = 'r'
       AND c.relname <> 'tenant'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON keystone.%I '
      'REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT '
      'EXECUTE FUNCTION keystone.refuse_touch_reference_rows()',
      r.t || '_refuse_reference_delete_trg', r.t);
    EXECUTE format(
      'ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I',
      r.t, r.t || '_refuse_reference_delete_trg');

    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON keystone.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()',
      r.t || '_refuse_reference_truncate_trg', r.t);
    EXECUTE format(
      'ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I',
      r.t, r.t || '_refuse_reference_truncate_trg');
  END LOOP;
END $$;

-- ── AND THE TENANT TABLE ITSELF, FOR THE VERB 0094 MISSED ───────────────────────────────────────
-- ★★★ F1's actual fix. The DELETE guard from 0094 stays exactly as it is; this adds the one verb it
--     could never see.
CREATE OR REPLACE FUNCTION keystone.refuse_truncate_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM keystone.tenant WHERE is_reference) THEN
    RAISE EXCEPTION
      'TRUNCATE on keystone.tenant would destroy the reference practice, which is permanent. '
      '★ A BEFORE DELETE row trigger does NOT fire on TRUNCATE — that is why 0094''s guard, which '
      'refuses every DELETE, did not stop this. MEASURED: TRUNCATE succeeded and left 0 reference '
      'practices.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION keystone.refuse_truncate_tenant() FROM PUBLIC;

CREATE TRIGGER tenant_refuse_truncate_trg
  BEFORE TRUNCATE ON keystone.tenant
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_truncate_tenant();

ALTER TABLE keystone.tenant ENABLE ALWAYS TRIGGER tenant_refuse_truncate_trg;

COMMENT ON FUNCTION keystone.refuse_touch_reference_rows() IS
  'P3 CLOSE / F2. Refuses DELETE or TRUNCATE of any row belonging to the reference practice, on '
  'every tenant-scoped table, ENABLE ALWAYS. ★★★ 0094 protected the tenant ROW only — MEASURED: 108 '
  'child rows were deleted with no refusal, leaving a marked but EMPTY practice, which is worse than '
  'deletion because every surface still reports it exists. Statement-level with a transition table '
  'so the cost is one EXISTS per statement, not per row.';
