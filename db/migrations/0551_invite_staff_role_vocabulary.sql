-- 0551_invite_staff_role_vocabulary
--
-- Team brief (1 Oct 2026) — "there is no way to invite a new team member", root-caused by actually
-- trying it, locally, end to end. There were TWO independent vocabulary mismatches stacked on top
-- of each other, and either one alone was enough to make every staff invite fail:
--
--   1. TeamInviteDrawer.jsx sent `staffRole: "coach"` — a FRONTEND bug, fixed in the same pass
--      (webreact/src/lib/screens/people/TeamInviteDrawer.jsx), because `keystone.app_user.staff_role`
--      has required `'member' | 'admin' | 'owner'` since migration 0525 renamed the rank.
--
--   2. ★★★ THIS ONE, A SCHEMA BUG, NOT A FRONTEND ONE: `keystone.invite.staff_role` (0202, Stage 8 —
--      written BEFORE 0525's rename) still carries the OLD vocabulary, `CHECK (staff_role IN
--      ('admin','coach'))`. 0525 updated `app_user`'s own CHECK and nothing else — `invite` was never
--      touched. [EXECUTED locally] fixing bug 1 alone (sending "member") then failed with a DIFFERENT
--      error: `new row for relation "invite" violates check constraint "invite_staff_role_check"`.
--      There is NO value that satisfies both tables' constraints at once — "coach" passes `invite`
--      and fails `app_user`; "member" passes `app_user` and fails `invite`. Every staff invite,
--      through any caller, for this table's whole lifetime, was structurally guaranteed to fail.
--
-- ★ CORRECTED while testing this migration locally: the comment used to say "no row has ever
--   carried a staff_role value on this table — nothing to backfill". [MEASURED, local dev DB]
--   FALSE — two rows from an earlier test harness run (26 Sep 2026, before this bug was found)
--   carry `staff_role = 'coach'`, which only works if a staff invite was attempted and accepted
--   BEFORE 0525's rename landed, while 'coach' was still valid in BOTH tables. Production may hold
--   the same kind of row (any invite created before 0525 and still unaccepted/unexpired), so the
--   backfill below runs unconditionally — a no-op where there is nothing to touch, corrective
--   where there is. `'owner'` is included for the same reason app_user's own CHECK includes it
--   (0525), even though no caller offers it today: one vocabulary, declared once, not re-typed
--   narrower in a second table that happens to reference the same fact.

-- ★ ORDER MATTERS, AND GETTING IT WRONG IS ITS OWN SMALL LESSON: the backfill UPDATE must run
--   AFTER the old constraint is dropped, not before — [EXECUTED locally] updating 'coach' to
--   'member' while the OLD constraint (`IN ('admin','coach')`) is still in force fails the exact
--   same way the application code already does ('member' is not in that set either). Drop first,
--   backfill into an unconstrained column, add the new constraint last so its own validation scan
--   sees only already-correct values.
ALTER TABLE keystone.invite DROP CONSTRAINT invite_staff_role_check;

UPDATE keystone.invite SET staff_role = 'member' WHERE staff_role = 'coach';

ALTER TABLE keystone.invite ADD CONSTRAINT invite_staff_role_check
  CHECK (staff_role IN ('member','admin','owner'));

DO $self_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.invite'::regclass
       AND conname = 'invite_staff_role_check'
       AND pg_get_constraintdef(oid) ILIKE '%coach%'
  ) THEN
    RAISE EXCEPTION '0551: invite_staff_role_check still mentions the old "coach" vocabulary';
  END IF;
  RAISE NOTICE '0551: keystone.invite.staff_role now accepts member/admin/owner, matching app_user';
END
$self_check$;
