-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0388 — TEAM-WIDE NOTES VISIBILITY: THE SWITCH THE NOTE RULE READS. (Stage 12 task 12.15, OQ-12.10,
-- CT-F26.)
--
-- ★★★ WHAT THIS ADDS. `keystone.document_is_visible()` (0194 §b) answers "can this staff viewer read
--     this session note?" with three disjuncts: the writer, the assigned coach, or a `note`
--     view/everything grant (the Owner). The Roles screen's "team-wide notes" switch
--     (`people.team_wide_notes`, a `tenant_setting`) needs a FOURTH: when a practice has switched it
--     on, any COACH who can already view the note's subject (`person`/`view`) can also read that
--     subject's session notes, even ones a colleague wrote. OFF is the default — nothing changes
--     until an Owner or Admin (`setting: edit/everything`) explicitly turns it on.
--
-- ★★★ THE `staff_role = 'coach'` CONJUNCT IS OQ-12.10's DOCTRINE-7 NARROWING, NOT DECORATION.
--     Without it an Admin — whose `note` grant 05 §5 deliberately sets to `none`
--     (`src/permissions/defaults.mjs:92`) — would gain note access purely from a practice-wide
--     setting, which is a privacy widening only Ty rules on. The Owner is unaffected: their own
--     `note: view/everything` grant already satisfies the THIRD disjunct, unchanged.
--
-- ★★ CT-F26 — THE ONE CROSS-STAGE RULE FOR THIS FUNCTION. Stage 14's note-share migration (0420)
--    replaces this SAME function again, for a different reason, and MUST copy THIS body (0388's),
--    not 0194's stale one — copying the older body would silently revert team-wide notes. See
--    CONTRACTS.md CT-F26.
--
-- ★ WHO SUPPLIES THE CONDITION. `ts.value = 'true'::jsonb` reads a row the APPLICATION writes via
--   the existing settings route (`POST /api/settings`, catalogued by 12.1) when an Owner/Admin flips
--   the Roles screen switch — never a GUC, never something only a test sets. Absent the row (the
--   default, and every tenant today), the EXISTS is false and behaviour is identical to 0194.
--
-- ★ EVERYTHING BELOW THE STAFF SESSION-NOTE RETURN IS 0194 §b's BODY, VERBATIM — the archived check,
--   the draft check, the guardian edge, and the client/parent party mapping are UNTOUCHED.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0388: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regprocedure('keystone.document_is_visible(keystone.document_instance)') IS NULL THEN
    RAISE EXCEPTION '0388: keystone.document_is_visible does not exist — 0194 must apply first';
  END IF;

  IF to_regclass('keystone.tenant_setting') IS NULL THEN
    RAISE EXCEPTION '0388: keystone.tenant_setting does not exist';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §b — THE PREDICATE. 0194 §b's BODY, VERBATIM, WITH ONE ADDED DISJUNCT ON THE SESSION-NOTE RETURN.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
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
  -- 0194's STAFF BRANCH — the staff short-circuit stays gone. Archived, session-note and
  -- every-other-document questions are all answered by a real grant or a real relationship,
  -- never by role alone.
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
      -- ★★★ 05 §6 — the writer, the assigned coach, a `note` view/everything grant (the Owner), OR
      --     (12.15 / OQ-12.10, CT-F26) a COACH — never an Admin, whose `note` grant is `none`, see
      --     the header — reading under the team-wide-notes practice setting, and ONLY when that same
      --     coach already holds `person`/`view` on this note's subject. This is the ONE disjunct
      --     0388 adds to 0194's RETURN; the first three disjuncts are 0194's, unchanged.
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

    -- ── every other document → the real grant on the instance's indirect owner ───────────────
    RETURN keystone.user_may(v_viewer.id, 'document', 'view', v_owner);
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════
  -- EVERYTHING BELOW THIS LINE IS 0194's BODY, VERBATIM, FOR THE NON-STAFF VIEWER (client,
  -- adolescent client, parent). UNTOUCHED — the parent/guardian refusal is not widened.
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

  IF v_type.is_session_note AND (v_via_guard OR v_viewer.role = 'parent') THEN RETURN false; END IF;

  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

  v_party := CASE
               WHEN v_viewer.role IN ('adult_client', 'adolescent_client')
                 THEN CASE v_type.division WHEN 'tech' THEN 'client' ELSE 'pir' END
               WHEN v_viewer.role = 'parent' THEN 'parent'
               ELSE NULL
             END;
  IF v_party IS NULL THEN RETURN false; END IF;

  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END
$$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  '0388 (Stage 12 task 12.15, OQ-12.10, CT-F26) — adds ONE disjunct to 0194''s staff session-note '
  'RETURN: a COACH (never an Admin — 05 §5''s note grant is none) who already holds person/view on '
  'the note''s subject may also read that subject''s session notes when tenant_setting '
  'people.team_wide_notes = true. Default OFF; every other branch is 0194''s, unchanged. Still '
  'SECURITY DEFINER with an empty search_path. Stage 14''s CT-F07 migration (0420) must copy THIS '
  'body, not 0194''s — see CONTRACTS.md CT-F26.';

-- ── §c · SELF-CHECK — THE SHAPE 0194 §c ALREADY ASSERTED, RE-ASSERTED AFTER CREATE OR REPLACE ────
DO $shape_check$
DECLARE
  r record;
BEGIN
  SELECT p.prosecdef,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path
    INTO r
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'document_is_visible';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0388: keystone.document_is_visible does not exist after CREATE OR REPLACE';
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0388: keystone.document_is_visible is not SECURITY DEFINER';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0388: keystone.document_is_visible has no pinned search_path — hijackable (0120''s lesson)';
  END IF;

  RAISE NOTICE '0388: keystone.document_is_visible is SECURITY DEFINER, search_path pinned, and now carries the people.team_wide_notes disjunct (coaches only, default off).';
END
$shape_check$;
