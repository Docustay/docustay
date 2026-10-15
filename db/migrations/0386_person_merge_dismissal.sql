-- 0386_person_merge_dismissal
--
-- 12.12 — "not the same person": a dismissal is a suggestion memory (never suggest this pair again
-- from `/api/people/check-duplicate`), not history. `applyMerge` deletes any dismissal row touching
-- the loser before it reparents (re-pointing it could collide with the pair's unique key — a
-- dismissal is never updated), which is why this table carries no tenant_update policy and is
-- deliberately NOT added to `PERSON_FK_REFS` in src/records/merge.mjs.

CREATE TABLE keystone.person_merge_dismissal (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  person_low_id uuid NOT NULL, person_high_id uuid NOT NULL,
  dismissed_by uuid NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_merge_dismissal_ordered CHECK (person_low_id < person_high_id),
  CONSTRAINT person_merge_dismissal_low_fkey  FOREIGN KEY (tenant_id, person_low_id)  REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT person_merge_dismissal_high_fkey FOREIGN KEY (tenant_id, person_high_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT person_merge_dismissal_by_fkey   FOREIGN KEY (tenant_id, dismissed_by)   REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (dismissed_by)
);
CREATE UNIQUE INDEX person_merge_dismissal_pair_key ON keystone.person_merge_dismissal (tenant_id, person_low_id, person_high_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST (CONTRACTS §3.2), all eight points, for
-- keystone.person_merge_dismissal.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Point 1 — ENABLE and FORCE. ENABLE alone leaves the table owner exempt.
ALTER TABLE keystone.person_merge_dismissal ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.person_merge_dismissal FORCE  ROW LEVEL SECURITY;

-- Point 2 — tenant policies. tenant_delete IS present: applyMerge deletes the loser's dismissal
-- rows before it reparents. No tenant_update: a dismissal is never updated (the insert is
-- ON CONFLICT DO NOTHING), and there is no UPDATE grant.
CREATE POLICY tenant_isolation ON keystone.person_merge_dismissal USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.person_merge_dismissal FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.person_merge_dismissal FOR DELETE USING (tenant_id = keystone.current_tenant_id());

-- Point 3 — the reference_guard read policy, plain form (calls no function).
CREATE POLICY reference_guard_read ON keystone.person_merge_dismissal FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- Point 4 — grants. No UPDATE: a dismissal is never updated.
GRANT SELECT, INSERT, DELETE ON keystone.person_merge_dismissal TO app_rw;
GRANT SELECT ON keystone.person_merge_dismissal TO reference_guard;

-- Point 4b — the reference_guard EXECUTE lend, answered in all three bullets (A-F9, 25 Sep 2026).
-- Bullet 1: the reference_guard_read policy above is the PLAIN form from point 3 — its USING clause
-- calls no function, so there is nothing for a GRANT EXECUTE to name.
-- Bullet 2: keystone.refuse_touch_reference_rows() is OWNED BY reference_guard (0144:245); that
-- ownership, not a grant, is what makes point 5's triggers work below. No redundant grant added,
-- function not re-owned.
-- Bullet 3: asserted in the closing DO block below, verbatim per 0144 §e's end state.

-- Point 5 — both refuse_touch_reference_rows triggers, each ENABLE ALWAYS.
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


CREATE TRIGGER person_merge_dismissal_refuse_reference_delete_trg AFTER DELETE ON keystone.person_merge_dismissal
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.person_merge_dismissal ENABLE ALWAYS TRIGGER person_merge_dismissal_refuse_reference_delete_trg;
CREATE TRIGGER person_merge_dismissal_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.person_merge_dismissal
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.person_merge_dismissal ENABLE ALWAYS TRIGGER person_merge_dismissal_refuse_reference_truncate_trg;

-- ★ Handed straight back — app_owner must not keep EXECUTE on the reference guard's own function.
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;


COMMENT ON TABLE keystone.person_merge_dismissal IS '12.12 — "not the same person": a dismissed duplicate-suggestion pair, never suggested again by findPossibleDuplicate. A suggestion memory, not history — applyMerge deletes the loser''s rows rather than reparenting them, and undo does not restore them.';

-- Point 6 — the closing self-check, WITH ITS POSITIVE CONTROL INSIDE THE SQL (template: 0369/0370/0385).
DO $$
DECLARE
  v_policy_count int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.person_merge_dismissal'::regclass) THEN
    RAISE EXCEPTION '0386: keystone.person_merge_dismissal does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.person_merge_dismissal'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_delete', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0386: keystone.person_merge_dismissal does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.person_merge_dismissal'::regclass
     AND tgname IN ('person_merge_dismissal_refuse_reference_delete_trg', 'person_merge_dismissal_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0386: keystone.person_merge_dismissal does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.person_merge_dismissal', 'SELECT') THEN
    RAISE EXCEPTION '0386: app_rw is missing SELECT on keystone.person_merge_dismissal';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.person_merge_dismissal', 'INSERT') THEN
    RAISE EXCEPTION '0386: app_rw is missing INSERT on keystone.person_merge_dismissal';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.person_merge_dismissal', 'DELETE') THEN
    RAISE EXCEPTION '0386: app_rw is missing DELETE on keystone.person_merge_dismissal';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.person_merge_dismissal', 'UPDATE') THEN
    RAISE EXCEPTION '0386: app_rw must not hold UPDATE on keystone.person_merge_dismissal — a dismissal is never updated, only inserted (ON CONFLICT DO NOTHING) or deleted';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.person_merge_dismissal', 'SELECT') THEN
    RAISE EXCEPTION '0386: reference_guard is missing SELECT on keystone.person_merge_dismissal';
  END IF;

  -- CT-F52 point 4b, bullet 3 / 0144 §e's end state: reference_guard_read on this table is
  -- exactly (TO reference_guard, FOR SELECT, PERMISSIVE) and nothing else.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.person_merge_dismissal'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0386: reference_guard_read on keystone.person_merge_dismissal is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;
END $$;
