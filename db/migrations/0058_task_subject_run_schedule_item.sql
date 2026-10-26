-- 0058 — THE SIXTH CHECKABLE SUBJECT TYPE. P20.4's sweeper gains `run_schedule_item`.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THIS MIGRATION EXISTS BECAUSE A GATE DEMANDED IT, BY NAME, AND THAT IS THE WHOLE STORY.
--     0056 deliberately listed only FIVE checkable types and `db/gates/p20_orphan_tasks.mjs`
--     asserted `keystone.run_schedule_item` DOES NOT EXIST — so the omission was a MEASURED fact
--     rather than a forgotten one. 0057 (P20.5) created the table, and on the very next full suite
--     that gate went red with:
--
--         ✗ keystone.run_schedule_item EXISTS now — add it to task_subject_checkable_types()
--           in the same change
--
--     [EXECUTED 2026-09-14] That is the guard working exactly as designed. The temptation is to
--     relax the assertion; the correct move is the one it names.
--
-- ★★★ AND THE FAILURE IT PREVENTS IS THE WORST ONE IN PHASE 20, RESTATED SO NOBODY UNDOES THIS.
--     Before this migration, a task whose `subject_type` is `run_schedule_item` was UNVERIFIABLE:
--     `task_subject_exists()` returned NULL, and the sweeper LEFT IT ALONE and reported it. That was
--     correct while the table did not exist, and it is now merely stale — the sweeper can look, so it
--     must. The alternative failure modes, both bad:
--       · leave it unverifiable → `chase_the_grant` tasks whose schedule item is long gone accumulate
--         forever, which is ADD3-1's "a task that outlives its subject".
--       · make "cannot check" mean "gone" → every Run task closes on the first sweep with its subject
--         sitting right there. Those are P20.9's tasks: the ones standing between a client being
--         billed and nobody noticing the work cannot be done.
--     0056's three-valued `task_subject_exists()` is what keeps both off the table. This migration
--     only moves one type from the second column to the first.

CREATE OR REPLACE FUNCTION keystone.task_subject_checkable_types()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['person','account','document','booking','entitlement','run_schedule_item']::text[] $$;

-- ★★ AND THE LOOKUP BRANCH, WITHOUT WHICH THE LIST ABOVE IS A LIE. `task_subject_exists()` guards on
--    the array and then CASEs on the type; adding the type to the array without adding the branch
--    would fall through to the `ELSE`, which returns NULL. That would be the same "unverifiable"
--    answer as before — silently, while the list claimed otherwise. The two edits are one change.
CREATE OR REPLACE FUNCTION keystone.task_subject_exists(p_subject_type text, p_subject_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path TO ''
AS $$
DECLARE
  v_found boolean;
BEGIN
  -- ★★★ THE NULL RETURN IS THE POINT. An unrecognised type is not "missing" — it is unchecked, and
  --     saying so is what stops the sweeper from closing work it never looked at.
  IF NOT (p_subject_type = ANY (keystone.task_subject_checkable_types())) THEN
    RETURN NULL;
  END IF;

  CASE p_subject_type
    WHEN 'person' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = p_subject_id) INTO v_found;
    WHEN 'account' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.account a WHERE a.id = p_subject_id) INTO v_found;
    WHEN 'document' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.document_instance i WHERE i.id = p_subject_id) INTO v_found;
    WHEN 'booking' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.booking b WHERE b.id = p_subject_id) INTO v_found;
    WHEN 'entitlement' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.entitlement e WHERE e.id = p_subject_id) INTO v_found;
    -- ★ NEW at 0058, once 0057 gave the table an existence to check.
    WHEN 'run_schedule_item' THEN
      SELECT EXISTS (SELECT 1 FROM keystone.run_schedule_item r WHERE r.id = p_subject_id) INTO v_found;
    ELSE
      -- ★ Unreachable while the guard above and the array agree. If they ever disagree, this returns
      --   NULL rather than falling through to a default of FALSE — the safe direction.
      RETURN NULL;
  END CASE;

  RETURN v_found;
END;
$$;

COMMENT ON FUNCTION keystone.task_subject_checkable_types() IS
  'P20.4 — the subject_type values the orphan sweeper can verify. SIX as of 0058. '
  '★ It held five until 0057 created keystone.run_schedule_item; p20_orphan_tasks.mjs asserted that '
  'absence, so the day the table appeared the gate went red and named this migration as the fix. '
  '★★ Adding a type here WITHOUT adding its branch to task_subject_exists() would fall through to '
  'ELSE and return NULL — the same "unverifiable" answer, silently, while this list claimed otherwise. '
  'The two edits are ONE change.';
