-- 0056 — A TASK WHOSE SUBJECT NO LONGER EXISTS MUST NOT SURVIVE. P20.4.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ §A4.4 REQUIRES A CHOICE AND REQUIRES IT STATED: *"P20.4's rule … is NOT expressible as a FK,
--     because `subject_id` is polymorphic. It is a trigger or a sweeper that sets
--     `closed_reason='subject_gone'`. State which, and assert it."*
--
--     **IT IS A SWEEPER, AND THE MEASUREMENT IS WHY — NOT TASTE.** [MEASURED 2026-09-14] across the
--     six `subject_type` values:
--
--       subject_type       table               can it be DELETEd?                      lifecycle column
--       -----------------  ------------------  --------------------------------------  ----------------
--       person             app_user            blocked by TEN RESTRICT FKs             (none)
--       account            account             freely                                  status
--       document           document_instance   REFUSED when terminal (0038's trigger)  state
--       booking            booking             blocked by 2 RESTRICT FKs               state
--       entitlement        entitlement         freely                                  status
--       run_schedule_item  run_schedule_item   ★ THE TABLE DOES NOT EXIST (P20.6)      —
--
--     Three things follow, and each one kills the trigger design on its own:
--       1. ★★★ SIX TRIGGERS WOULD BE FIVE. `run_schedule_item` is P20.6's table, so the sixth cannot
--          be written today — and a five-of-six trigger set has a HOLE THAT LOOKS LIKE COVERAGE.
--       2. ★★★ FOR THE MOST IMPORTANT TYPE, DELETE IS FORBIDDEN. `document_instance_terminal_no_delete`
--          refuses to delete an executed instrument. A DELETE trigger there is nearly dead code: it
--          would never fire for the documents that actually matter.
--       3. ★★ FOUR OF SIX CARRY A `status`/`state` COLUMN, so in this product a subject usually stops
--          mattering WITHOUT being deleted. A trigger on DELETE is watching the wrong verb.
--
--     A sweeper is one function, covers every type uniformly, gains the sixth type by adding one
--     branch when P20.6 lands, and can be run and asserted without deleting anything.
--
-- ★★★ AND HERE IS THE TRAP THAT DESIGNED THE FUNCTION BELOW, BECAUSE THE OBVIOUS SHAPE IS A DISASTER.
--     The natural sweeper is `WHERE NOT EXISTS (… per-type branches …)`. With `run_schedule_item`
--     having no branch, `NOT EXISTS` is TRUE for every such task — so **the first sweep would close
--     every Run task as "subject gone" while its subject was sitting right there.** Those are P20.9's
--     tasks: the ones standing between a client being billed and nobody noticing the work cannot be
--     done. A fail-OPEN in the one direction that destroys the phase's revenue protection.
--   ★★ SO THE CHECK IS THREE-VALUED, NOT BOOLEAN. `task_subject_exists()` returns
--        TRUE  — I looked, it is there
--        FALSE — I looked, it is gone      ← the ONLY value that closes a task
--        NULL  — I CANNOT CHECK THIS TYPE  ← leaves the task alone, and is reported, never assumed
--     "Absent" and "unverifiable" are different answers and this system has been burned by conflating
--     them before (the `document_is_visible()` null-viewer case, and P18.9's not-found-vs-no-subject).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ THE TYPES THIS SWEEPER CAN ACTUALLY VERIFY, AS DATA. A gate reads this to assert both halves:
--   that the five it claims are really checked, and that the sixth is really NOT — so the day
--   P20.6 lands, the omission is a visible red rather than a silent gap.
CREATE FUNCTION keystone.task_subject_checkable_types()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['person','account','document','booking','entitlement']::text[] $$;

COMMENT ON FUNCTION keystone.task_subject_checkable_types() IS
  'P20.4 — the subject_type values the orphan sweeper can verify. ★ DELIBERATELY EXCLUDES '
  '''run_schedule_item'': its table does not exist until P20.6, and a sweeper that treated '
  '"unverifiable" as "absent" would close every Run task as subject_gone on its first run — which are '
  'precisely P20.9''s billed-and-not-deliverable tasks. Add it here IN THE SAME CHANGE as the table.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ NOT `SECURITY DEFINER`, ON PURPOSE. It runs inside the sweeper's `withTenant` transaction, so
--    RLS applies to every read below and the function can only ever see one practice's rows. A
--    definer version would need FORCE-RLS reasoning (0008:8-16) and would gain nothing: the caller
--    already legitimately has the tenant context.
--  ★ `STABLE`, not IMMUTABLE — it reads tables.
CREATE FUNCTION keystone.task_subject_exists(p_subject_type text, p_subject_id uuid)
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
    ELSE
      -- ★ Unreachable while the guard above and the array agree. If they ever disagree, this returns
      --   NULL rather than falling through to a default of FALSE — the safe direction.
      RETURN NULL;
  END CASE;

  RETURN v_found;
END;
$$;

COMMENT ON FUNCTION keystone.task_subject_exists(text, uuid) IS
  'P20.4 — THREE-VALUED on purpose: TRUE it is there, FALSE it is gone, NULL I cannot check this '
  'type. ★ Only FALSE closes a task. The obvious NOT EXISTS formulation would make "unverifiable" '
  'indistinguishable from "absent" and close every run_schedule_item task on the first sweep. '
  '★★ Not SECURITY DEFINER: it runs inside the caller''s withTenant transaction, so RLS applies and '
  'it can only see one practice''s rows.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ IT CLOSES. IT DOES NOT DELETE. §A4.4: *"Do not let it merely DELETE: a task that vanishes with
--    no record is the same failure as a task that outlives its subject."* So `closed_reason` is
--    `'subject_gone'` — a third reason distinct from 'event' and 'manual', which means the Tasks
--    screen can answer "where did that go" for every task that ever left it.
--  ★ `closed_by_event_id` stays NULL and that is legal: `task_closed_shape` requires an event id only
--    when the reason IS 'event'. A sweeper genuinely has no event behind it, and inventing one would
--    put a fabricated cause in the audit trail.
CREATE FUNCTION keystone.close_tasks_with_missing_subjects()
RETURNS TABLE (closed_count integer, skipped_unverifiable integer)
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_closed integer;
  v_skipped integer;
BEGIN
  -- ★ Counted BEFORE the update, and reported, so "we closed 0" and "we could not look at 12" are
  --   never the same line. A sweep that silently skips is how a task outlives its subject anyway.
  SELECT count(*)::integer INTO v_skipped
    FROM keystone.task t
   WHERE t.closed_at IS NULL
     AND keystone.task_subject_exists(t.subject_type, t.subject_id) IS NULL;

  WITH gone AS (
    SELECT t.id FROM keystone.task t
     WHERE t.closed_at IS NULL
       -- ★★★ `= false`, NOT `IS NOT TRUE`. `IS NOT TRUE` is also true for NULL, which would close
       --     every unverifiable task — the exact disaster this migration's header describes. One
       --     operator apart.
       AND keystone.task_subject_exists(t.subject_type, t.subject_id) = false
  )
  UPDATE keystone.task t
     SET closed_at = now(), closed_reason = 'subject_gone'
    FROM gone
   WHERE t.id = gone.id;

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN QUERY SELECT v_closed, v_skipped;
END;
$$;

COMMENT ON FUNCTION keystone.close_tasks_with_missing_subjects() IS
  'P20.4 — closes open tasks whose subject row is ABSENT, with closed_reason=''subject_gone''. '
  '★ It CLOSES, never DELETEs: §A4.4 — a task that vanishes with no record is the same failure as one '
  'that outlives its subject. ★★ Returns the count it could NOT verify alongside the count it closed, '
  'so a silent skip is impossible to mistake for a clean sweep.';

GRANT EXECUTE ON FUNCTION keystone.task_subject_checkable_types() TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.task_subject_exists(text, uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.close_tasks_with_missing_subjects() TO app_rw;
