-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P6.B10 CORRECTION — `task` BECAME OWNABLE AND `unassigned_count()` WAS NEVER TOLD.
--
-- ★★★ `db/gates/p1_ownership.mjs` FAILS WITH *"unassigned_count('task') raises, but task has an
--     unassigned view"* — and it is right. P6.B10 pointed the ownership axis at
--     `keystone.task.assignee_id` (`src/permissions/ownership.mjs`), deliberately NULLABLE because
--     **"an unassigned task is a real state: a task an event chain raised that nobody has picked
--     up"** — and `/tasks/team` exists precisely to show those. So `task` is now exactly what this
--     function is for, and it answers by raising.
--
-- ★★ THE OLD MESSAGE IS ALSO NOW WRONG, WHICH IS THE MORE EXPENSIVE HALF. It states that *"person
--    and account are the two that can be unowned (booking.host_id and document_instance.assigned_to
--    are NOT NULL, so they never can be)"*. That was true when written and is now an explanation
--    that will cost somebody an hour — the same class as the four `NOT_BUILT` reasons corrected in
--    this phase, where the screen was fine and the SENTENCE was the defect.
--
-- ★ THE SHAPE OF THE ANSWER IS DELIBERATE AND UNCHANGED: no dynamic SQL, no default branch
--   returning zero. An unknown object still RAISES, because returning 0 for a typo renders a badge
--   reading "nothing is unassigned" — the exact false reassurance this function exists to prevent.
--
-- ★★ AND `closed_at IS NULL` IS PART OF THE COUNT, NOT AN OPTIMISATION. A CLOSED task that nobody
--    was assigned is not outstanding work; counting it would put a permanent, unclearable number on
--    a badge whose whole purpose is "this needs a person". Both task lists already filter on it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.unassigned_count(p_object text)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE v_n integer;
BEGIN
  CASE p_object
    WHEN 'person'  THEN SELECT count(*) INTO v_n FROM keystone.app_user
                         WHERE owner_user_id IS NULL AND role <> 'staff';
    WHEN 'account' THEN SELECT count(*) INTO v_n FROM keystone.account WHERE owner_user_id IS NULL;
    -- ★★★ P6.B10 — the third ownable object, and the only one whose owner column is the SUBJECT of
    --     a screen: /tasks/team shows unclaimed work, so this number is what makes it findable.
    WHEN 'task'    THEN SELECT count(*) INTO v_n FROM keystone.task
                         WHERE assignee_id IS NULL AND closed_at IS NULL;
    ELSE
      RAISE EXCEPTION
        'unassigned_count: "%" is not an ownable object — person, account and task are the three '
        'that can be unowned (booking.host_id and document_instance.assigned_to are NOT NULL, so '
        'they never can be)', p_object
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  RETURN v_n;
END;
$function$;
