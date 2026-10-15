-- 0533_parent_is_a_tag_not_a_role — the maintainer's ruling, 29 Sep 2026:
--
-- "Everyone who gets services is a client. One Clients list. What kind of client they are is a tag."
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT WAS WRONG. `role` held FOUR values — 'staff', 'adult_client', 'adolescent_client',
--     'parent' — and a person could only ever hold ONE. 'parent' outranked everything else a
--     person could be, so nobody could be a parent AND a client. Example Client gets services
--     himself and pays for his son; the old model could not hold him at all.
--
-- ★★ THE FIX. `role` becomes `adult_client` OR `adolescent_client` ONLY (`staff` unchanged —
--     staff are not part of this axis at all). Whether somebody is ALSO a parent is a computed
--     FACT — a `keystone.guardian` row naming them as `guardian_user_id` — never a role a person
--     holds INSTEAD of being a client. `guardian` already existed (0074) and already enforced this
--     exactly; nothing about the RELATION changes here, only what `role` no longer needs to repeat.
--
-- ★★★ EVERY 'parent' ROW BECOMES 'adult_client'. Every existing `guardian` row is untouched — that
--     link is what gives the migrated row its Parent tag from the moment this runs, with no second
--     write. A parent who only pays (never receives a service themselves) still gets a real
--     `adult_client` row; "adult_client" now means "an adult's own account", not "receives
--     services as an adult", the same way `role` already meant "adolescent_client" for a teen
--     regardless of whether they'd had a single session yet.
--
-- ★ APPLICATION-SIDE REPOINTING (not this file's job, recorded here for the reader following the
--   whole change): `src/nav/authorise.mjs`'s `effectiveRank` and every `role === "parent"` check
--   across the client-app routes (`src/routes/app.mjs`, `appHome.mjs`, `appProfile.mjs`) now read
--   `principal.user.is_guardian` — a fact joined once at session-resolution time
--   (`src/http/app.mjs`'s `loadPerson`: `EXISTS (SELECT 1 FROM keystone.guardian g WHERE
--   g.guardian_user_id = u.id)`) rather than re-derived per call. `src/people/guardians.mjs`'s
--   `linkGuardian` now requires the guardian to be `adult_client`, not `parent`. `src/auth/
--   invite.mjs`'s invite shape drops the `role = 'parent'` requirement for `childUserId` — any
--   adult-client invitation may optionally carry one, and ACCEPTING one is what creates the
--   guardian link, exactly as before.
--
-- ★★★ `keystone.document_is_visible` — THE ONE PLACE THIS MIGRATION TOUCHES LIVE LOGIC, BECAUSE
--     LEAVING IT ALONE WOULD BE A REAL REGRESSION, NOT A HARMLESS NO-OP. The function already keys
--     the SUBJECT-VS-GUARDIAN gate on `keystone.is_guardian_of()` (a real table check, 0074) via
--     `v_via_guard` — that gate is untouched and was never the problem. The problem is TWO LATER
--     LINES that compare `v_viewer.role` directly against a document TYPE's `audience` array and
--     against `assigned_to`, where the party name 'parent' was assumed to equal the ROLE value
--     'parent'. Once nobody's role is ever 'parent', a real guardian (v_via_guard = true) reading a
--     NON-session-note document assigned to 'parent' would be refused at the audience check — their
--     role reads 'adult_client', which is not 'parent', even though they plainly are one for this
--     document. Fixed by computing the PARTY name from `v_via_guard` first, `role` only for the
--     subject themselves — restoring the exact original behaviour, now correctly for a fact instead
--     of a role. The STAFF branch above it, and the session-note refusal's ORDER relative to the
--     subject check, are copied verbatim from 0420 and are NOT touched (0074's own header: "the
--     order of the checks below is load-bearing").
--
-- ★ NOT TOUCHED, RECORDED FOR TY: `keystone.practice_seat_counts` (0006/0007/0008) still counts
--   `WHERE u.role = 'parent'` for its `parent_seats` figure (`src/records/queries.mjs`'s "N adult,
--   N adolescent, N parent" sentence) — after this migration that count reads 0 for every practice,
--   forever. What a "parent seat" should mean when one person can be Adult AND Parent at once is a
--   billing-policy question, not a styling or a repoint; left alone rather than guessed at.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- §a1 — DROP THE OLD CONSTRAINTS FIRST (same order 0525 already proved is required: the old CHECK
--   would reject the data UPDATE below before it could ever write a row the new CHECK admits).
ALTER TABLE keystone.app_user DROP CONSTRAINT app_user_role_check;
ALTER TABLE keystone.invite DROP CONSTRAINT invite_role_check;
ALTER TABLE keystone.invite DROP CONSTRAINT invite_parent_has_child;

-- §b — THE DATA, PER TENANT, ENUMERATED VIA THE HEALTH RESOLVER (0525's own proof of why: this
--   migration runs as app_owner with no tenant context, and FORCE RLS means a naive un-looped
--   UPDATE would see, and change, zero rows while reporting success).
DO $migrate_parent_role$
DECLARE
  t          record;
  v_user_upd integer := 0;
  v_rows     integer;
BEGIN
  -- ★ 0500's real-client guard refuses any UPDATE of a `protected_real_client` app_user row
  --   without a named reason (Example Client is one such row — 0500's own header names him by
  --   name). This IS that deliberate, named change: the maintainer's own ruling tonight. `true` scopes it to
  --   THIS transaction only (SET LOCAL semantics), same as every other GUC this migration sets.
  PERFORM set_config('keystone.protected_write_reason',
    '0533: the maintainer''s ruling 29 Sep 2026 — parent is no longer a role; every role=parent row becomes '
    'adult_client, guardian links unchanged', true);

  FOR t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);

    UPDATE keystone.app_user SET role = 'adult_client' WHERE role = 'parent';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_user_upd := v_user_upd + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0533: % app_user row(s) migrated role parent -> adult_client', v_user_upd;
END
$migrate_parent_role$;

-- §a2 — RE-ADD THE CONSTRAINTS, now that every row already satisfies them.
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_role_check
  CHECK (role IN ('staff','adult_client','adolescent_client'));
ALTER TABLE keystone.invite ADD CONSTRAINT invite_role_check
  CHECK (role IN ('staff','adult_client','adolescent_client'));
-- ★ `child_user_id` is now optional and orthogonal — only an adult-client invitation may carry one
--   (only an adult may be a guardian); it is never REQUIRED the way 'parent' used to require it.
ALTER TABLE keystone.invite ADD CONSTRAINT invite_child_needs_adult
  CHECK (child_user_id IS NULL OR role = 'adult_client');

-- §c — `keystone.document_is_visible`, REDEFINED. Copied from 0420's body verbatim except the
--   three lines named in the header above. Diff against 0420, line for line:
--   · the STAFF branch (down to and including the closing `END IF;` before "EVERYTHING BELOW") —
--     byte-for-byte unchanged.
--   · the session-note refusal — drops the now-permanently-false `OR v_viewer.role = 'parent'`
--     disjunct (v_via_guard alone already refuses every guardian; the ORDER relative to the
--     subject check above it is unchanged).
--   · the audience check and the `v_party` CASE — both now ask `v_via_guard` FIRST, `role` only
--     for the subject themselves (v_via_guard = false).
CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_viewer    record;
  v_type      record;
  v_party     text;
  v_via_guard boolean := false;
  v_owner     uuid;
BEGIN
  SELECT u.id, u.role, u.staff_role INTO v_viewer
    FROM keystone.app_user u
   WHERE u.id = keystone.current_user_id()
     AND u.tenant_id = p_instance.tenant_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════
  -- 0388's STAFF BRANCH — UNCHANGED, verbatim, including the people.team_wide_notes disjunct
  -- (Stage 12 task 12.15, CT-F26). This migration does not touch this branch at all.
  -- ═════════════════════════════════════════════════════════════════════════════════════════
  IF v_viewer.role = 'staff' THEN
    SELECT su.owner_user_id INTO v_owner
      FROM keystone.app_user su WHERE su.id = p_instance.subject_user_id;

    IF p_instance.archived_at IS NOT NULL THEN
      RETURN keystone.user_may(v_viewer.id, 'document', 'delete', v_owner);
    END IF;

    SELECT t.is_session_note INTO v_type
      FROM keystone.document_type t WHERE t.id = p_instance.type_id;
    IF NOT FOUND THEN RETURN false; END IF;

    IF v_type.is_session_note THEN
      RETURN (p_instance.created_by IS NOT NULL AND p_instance.created_by = v_viewer.id)
          OR (v_owner IS NOT NULL AND v_owner = v_viewer.id)
          OR keystone.user_may(v_viewer.id, 'note', 'view', NULL)
          OR (v_viewer.staff_role = 'coach'
              AND EXISTS (SELECT 1 FROM keystone.tenant_setting ts
                           WHERE ts.tenant_id = p_instance.tenant_id
                             AND ts.key = 'people.team_wide_notes'
                             AND ts.value = 'true'::jsonb)
              AND keystone.user_may(v_viewer.id, 'person', 'view', v_owner));
    END IF;

    RETURN keystone.user_may(v_viewer.id, 'document', 'view', v_owner);
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════
  -- EVERYTHING BELOW THIS LINE IS 0420's BODY FOR THE NON-STAFF VIEWER, EXCEPT THE THREE LINES
  -- 0533 NAMES ABOVE. THE ORDER IS NOT TOUCHED (0074: "the order of the checks below is
  -- load-bearing" — reordering the subject check and the session-note refusal would hand a
  -- guardian their child's session notes).
  -- ═════════════════════════════════════════════════════════════════════════════════════════
  IF p_instance.archived_at IS NOT NULL THEN RETURN false; END IF;

  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN
    v_via_guard := keystone.is_guardian_of(v_viewer.id, p_instance.subject_user_id);
    IF NOT v_via_guard THEN RETURN false; END IF;
  END IF;

  SELECT t.audience, t.is_session_note, t.division INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★ 0533 — was `IF v_via_guard OR v_viewer.role = 'parent' THEN`. `role` can never be 'parent'
  --   again; `v_via_guard` alone already refuses every guardian exactly as before.
  IF v_type.is_session_note THEN
    IF v_via_guard THEN RETURN false; END IF;
    RETURN p_instance.shared_with_client_at IS NOT NULL;
  END IF;

  -- ★ 0533 — THE PARTY THIS VIEWER IS, ASKED AS A FACT FIRST. A guardian reading someone else's
  --   document (v_via_guard = true) is the party 'parent' regardless of their own `role`; the
  --   subject reading their own document (v_via_guard = false) maps from their own role exactly
  --   as before.
  IF v_via_guard THEN
    v_party := 'parent';
  ELSE
    v_party := CASE
                 WHEN v_viewer.role IN ('adult_client', 'adolescent_client')
                   THEN CASE v_type.division WHEN 'tech' THEN 'client' ELSE 'pir' END
                 ELSE NULL
               END;
  END IF;
  IF v_party IS NULL THEN RETURN false; END IF;
  IF NOT (v_party = ANY(v_type.audience)) THEN RETURN false; END IF;

  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END
$$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  '0533 (the maintainer, 29 Sep 2026): "parent" is no longer a role. Copies 0420''s body verbatim (staff branch '
  'untouched) except the audience/party check, which now asks v_via_guard (a real keystone.guardian '
  'row, unchanged since 0074) before it asks role — a guardian is the party ''parent'' regardless of '
  'their own role being adult_client, restoring exactly 0420''s behaviour now that role and party no '
  'longer share one value for a guardian.';

-- §d — THE SELF-CHECK, WITH POSITIVE CONTROLS. A bare, un-looped SELECT here would run under no
--   tenant context and report a "0 leftover" PASS that checked zero real rows (0525's own proof).
DO $the_migration_is_complete$
DECLARE
  t          record;
  v_leftover integer := 0;
  v_rows     integer;
BEGIN
  FOR t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);

    SELECT count(*) INTO v_rows FROM keystone.app_user WHERE role = 'parent';
    v_leftover := v_leftover + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_leftover > 0 THEN
    RAISE EXCEPTION '0533: % app_user row(s) still say role = parent across every tenant', v_leftover;
  END IF;

  -- ★ POSITIVE CONTROL — the new constraints actually admit the values they should and refuse
  --   'parent'. A constraint that silently failed to attach would let this whole migration look
  --   complete while enforcing nothing.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'keystone.app_user'::regclass
                AND conname = 'app_user_role_check'
                AND pg_get_constraintdef(oid) LIKE '%parent%') THEN
    RAISE EXCEPTION '0533: app_user_role_check still mentions parent after being redefined';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'keystone.app_user'::regclass
                    AND conname = 'app_user_role_check'
                    AND pg_get_constraintdef(oid) LIKE '%adult_client%') THEN
    RAISE EXCEPTION '0533: app_user_role_check does not admit adult_client after being redefined';
  END IF;

  IF to_regprocedure('keystone.document_is_visible(keystone.document_instance)') IS NULL THEN
    RAISE EXCEPTION '0533: keystone.document_is_visible was not created';
  END IF;

  RAISE NOTICE '0533: 0 app_user rows say role=parent across every tenant; role/invite constraints '
    'tightened; document_is_visible redefined';
END
$the_migration_is_complete$;
