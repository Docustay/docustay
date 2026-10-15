-- 0537_document_audience_uses_real_vocabulary — the maintainer, 29 Sep 2026 brief: "clients signing documents"
-- is priority one. Testing the life-coaching invoice+document flow end to end this session found
-- that NO CLIENT CAN EVER SEE THEIR OWN SENT DOCUMENT — only a parent/guardian viewing on their
-- behalf ever could. This is the fix.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE BUG, MEASURED, NOT ASSUMED. `keystone.document_is_visible()`'s audience check for a
--     non-staff viewer computes `v_party` — 'client' or 'pir' depending on the document TYPE's
--     `division` (tech vs anything else), 'parent' for a guardian — and checks
--     `v_party = ANY(v_type.audience)`. But `document_type.audience` is NEVER populated with
--     'client', 'pir' or 'both': `SELECT DISTINCT unnest(audience) FROM keystone.document_type`
--     across the whole database returns exactly four values — adolescent_client, adult_client,
--     parent, staff — the frozen `AUDIENCES` vocabulary (src/documents/writes.mjs:102,
--     src/documents/vocabulary.mjs:63), which every type-creation path (including
--     `ensureAgreementType`, used by EVERY coach-authored contract and both starter templates)
--     is the ONLY vocabulary that ever gets written there. 'client' and 'pir' are not IN that
--     set and never will be, so `v_party = ANY(v_type.audience)` is FALSE for every document a
--     client views on their own behalf, always — the function returns false before it ever
--     reaches the `assigned_to` check that correctly names them. A guardian passes only because
--     'parent' (the one token the two vocabularies happen to share) is genuinely in both.
-- ★★ REPRODUCED LIVE THIS SESSION: sent "Sign and Send Test v2" (type `coaching_agreement`,
--     division 'tech', audience {staff,adult_client,adolescent_client,parent},
--     assigned_to {client}) to a real test client. GET /api/app/documents returned {"documents":
--     []} for that client's own session — the row exists (state 'sent', correct subject_user_id)
--     but keystone.document_is_visible() refused it.
-- ★★★ THE FIX. Audience answers "may THIS ROLE ever see THIS TYPE at all" — org policy, set once
--     per type — so it must be asked in the SAME vocabulary it is stored in: the viewer's own
--     `role` (already exactly 'adult_client' | 'adolescent_client' by this point in the
--     function), or 'parent' for a guardian, exactly mirroring how `audience` already reads for
--     staff/parent. `v_party` ('client'/'pir'/'parent') is UNCHANGED and still the only thing
--     checked against `assigned_to`, whose real data (measured: `assigned_to = {client}`) already
--     agrees with what `v_party` computes — that half was never broken.
-- ★ EVERYTHING ELSE in this function — the staff branch, the session-note branch, the guardian
--   resolution, the assigned_to check — is 0533's body, byte-for-byte. This migration touches
--   exactly the one audience-comparison line.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_viewer        record;
  v_type          record;
  v_party         text;
  v_audience_key  text;
  v_via_guard     boolean := false;
  v_owner         uuid;
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
  -- EVERYTHING BELOW THIS LINE IS 0533's BODY FOR THE NON-STAFF VIEWER, EXCEPT THE AUDIENCE
  -- CHECK THIS MIGRATION'S HEADER NAMES. THE ORDER IS NOT TOUCHED (0074: "the order of the
  -- checks below is load-bearing").
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

  IF v_type.is_session_note THEN
    IF v_via_guard THEN RETURN false; END IF;
    RETURN p_instance.shared_with_client_at IS NOT NULL;
  END IF;

  -- ★ 0537 — THE AUDIENCE CHECK, IN AUDIENCE'S OWN VOCABULARY. `document_type.audience` is only
  --   ever one of staff/adult_client/adolescent_client/parent (the frozen AUDIENCES list) — so
  --   the key checked against it must be one of those, not a party token that vocabulary never
  --   contains. A guardian is asked as 'parent' (mirrors how audience already names guardians);
  --   the subject themselves is asked as their OWN role, which by this line is guaranteed to be
  --   'adult_client' or 'adolescent_client' (session-note and archived/draft cases already
  --   returned above; staff already returned in the branch above this one).
  IF v_via_guard THEN
    v_audience_key := 'parent';
  ELSE
    v_audience_key := v_viewer.role;
  END IF;
  IF NOT (v_audience_key = ANY(v_type.audience)) THEN RETURN false; END IF;

  -- ★ v_party is UNCHANGED — still the only thing checked against `assigned_to`, whose real
  --   vocabulary (measured: {client}, {client,parent}, {parent}, {both}) already agrees with it.
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

  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END
$$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  '0537 (the maintainer, 29 Sep 2026): the audience check now asks in audience''s OWN vocabulary (the '
  'viewer''s role, or ''parent'' for a guardian) instead of the party token (''client''/''pir'') '
  'that document_type.audience never actually contains — MEASURED: every real audience array '
  'holds only staff/adult_client/adolescent_client/parent. Before this, no client could ever see '
  'a document sent to them; only a guardian viewing on their behalf could, because ''parent'' is '
  'the one token the two vocabularies happened to share. v_party (checked against assigned_to, a '
  'genuinely different column with its own, already-correct vocabulary) is unchanged.';

-- ── SELF-CHECK ─────────────────────────────────────────────────────────────────────────────────
DO $document_audience_check$
BEGIN
  IF to_regprocedure('keystone.document_is_visible(keystone.document_instance)') IS NULL THEN
    RAISE EXCEPTION '0537: keystone.document_is_visible was not created';
  END IF;
  RAISE NOTICE '0537: keystone.document_is_visible audience check now uses role vocabulary (client visibility fixed)';
END
$document_audience_check$;
