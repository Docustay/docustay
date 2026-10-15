-- 0077 — P1.6 FIX · A SESSION NOTE IS REFUSED ON THE **GUARDIAN EDGE**, NOT ON THE VIEWER'S ROLE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ FOUND BY THE P1 ADVERSARIAL REVIEW, AND IT BREAKS P1.6's HEADLINE CLAIM.
--     Both locks on a child's session notes name the literal `'parent'`:
--       0074  IF v_type.is_session_note AND v_viewer.role = 'parent' THEN RETURN false;
--       CHECK session_notes_never_to_parents — NOT (is_session_note AND 'parent' = ANY (audience))
--     **And NOTHING constrains a guardian's role.** `keystone.guardian` accepts any two app_user ids;
--     `addGuardian()` checks only self-linking. So an ADULT CLIENT who is also a parent — routine in
--     a recovery practice — is a guardian whose `role` is `adult_client`, and neither lock fires.
--
--   [EXECUTED by the reviewer, against a session-note type with audience {staff, adult_client}]
--       document_is_visible to the role='parent' guardian       → hidden  (correct)
--       document_is_visible to the role='adult_client' guardian → TRUE    ← the leak
--     Both halves are reachable through the product's own writers: `createDocumentType` refuses only
--     `audience.includes('parent')`, and `addGuardian` links any role to any child.
--
-- ★★★ WHY F145 MISSED IT, AND THE LESSON. F145 concluded the `document_is_visible` line was
--     unreachable dead defence-in-depth because the CHECK made the shape unrepresentable. **Both
--     statements were true only of a `parent`-ROLED guardian.** The mutation that "stayed green"
--     stayed green because the fixture's guardian had role='parent' — the very case both locks
--     cover. ★★ A guard keyed on a ROLE cannot protect a relationship, and the gate that tested it
--     used the one role where the difference does not show.
--
-- ★★★ THE FIX IS TO ASK THE RIGHT QUESTION. The rule was never "parents may not read session
--     notes" — it is **"nobody reads somebody else's session note."** A person may read their own if
--     the audience admits them; reaching one THROUGH GUARDIANSHIP is refused, whatever the
--     guardian's role happens to be. That is role-independent, and it cannot be bypassed by
--     inventing a new role or by an audience the operator configures.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_viewer    record;
  v_type      record;
  v_party     text;
  v_via_guard boolean := false;
BEGIN
  SELECT u.id, u.role, u.staff_role INTO v_viewer
    FROM keystone.app_user u
   WHERE u.id = keystone.current_user_id()
     AND u.tenant_id = p_instance.tenant_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_instance.deleted THEN RETURN false; END IF;
  IF v_viewer.role = 'staff' THEN RETURN true; END IF;
  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  -- ★ Reaching the document AT ALL: it is the viewer's own, or they are a guardian of its subject.
  --   ★★ `v_via_guard` REMEMBERS WHICH, and that memory is the whole fix — the old code discarded
  --      it and then asked about the viewer's role instead.
  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN
    v_via_guard := keystone.is_guardian_of(v_viewer.id, p_instance.subject_user_id);
    IF NOT v_via_guard THEN RETURN false; END IF;
  END IF;

  SELECT t.audience, t.is_session_note INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ THE RULE, ASKED CORRECTLY. Not "is this viewer a parent" but **"is this somebody else's
  --     session note?"** Keyed on the EDGE the viewer travelled, so no role — existing or invented
  --     — and no audience an operator configures can get round it.
  --   ★ The old `role = 'parent'` test is kept as a SECOND condition, not replaced by one: a
  --     `parent` is refused even on their OWN subject row, which is what it always did.
  IF v_type.is_session_note AND (v_via_guard OR v_viewer.role = 'parent') THEN RETURN false; END IF;

  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

  v_party := CASE v_viewer.role
               WHEN 'adult_client'      THEN 'pir'
               WHEN 'adolescent_client' THEN 'pir'
               WHEN 'parent'            THEN 'parent'
               ELSE NULL
             END;
  IF v_party IS NULL THEN RETURN false; END IF;

  IF p_instance.assigned_to = '{}'::text[] THEN RETURN false; END IF;

  RETURN 'both' = ANY(p_instance.assigned_to) OR v_party = ANY(p_instance.assigned_to);
END $function$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  'P1.6 / 0077 — ★★★ THE SESSION-NOTE REFUSAL IS KEYED ON THE GUARDIAN EDGE, NOT ON THE VIEWER''S '
  'ROLE. Both original locks named the literal ''parent'' and nothing constrains a guardian''s role, '
  'so an adult_client who is also a parent read their child''s session notes. The rule was never '
  '"parents may not read session notes" — it is "nobody reads somebody else''s session note."';
