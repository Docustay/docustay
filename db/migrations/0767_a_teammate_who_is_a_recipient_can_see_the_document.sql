-- SENDING TO TEAMMATES · A TEAMMATE WHO IS A RECIPIENT CAN SEE THE DOCUMENT (21 Oct 2026, Ty).
-- keystone.document_is_visible (the staff branch of the document SELECT policy) let a Member see only documents they own or that sit on their team. A document sent to a teammate (the recipient's party row has external_ref = the member's id, or their email) was therefore invisible to that teammate: "Waiting on you" came back empty and opening the document said "not in this workspace" (found by the beta test of 20 Oct 2026).
-- The staff branch now also lets a staff person see a SENT document (never a draft) on which they are a recipient. Nothing else changes: every edit, send, void and delete still asks for the person's own right, which a Member does not have on someone else's document. This is the only change; the body is 0697's, verbatim, otherwise.
CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- RUN 4 ROUND 2: a document sent to an outside signer has no subject person, so it had no owner and a Member ("edit, owned") could not see, save or send the document they just uploaded. It falls back to its creator (src/documents/domain.mjs ownerFallbackColumn).
    v_owner := COALESCE(v_owner, p_instance.created_by);

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

    -- FIX PASS 3 (teams): a person on the document's team sees it. Before, team membership could only NARROW what a member saw (document_team_visible is an extra AND), so a member on a team could not open a teammate's document: the role's own scope ("their own") decided alone.
    RETURN keystone.user_may(v_viewer.id, 'document', 'view', v_owner)
        OR keystone.document_on_team(v_viewer.id, p_instance.team_id)
        -- SENDING TO TEAMMATES (21 Oct 2026): a teammate who is a recipient on a document that has been sent may see it (read only: every change still asks for its own right). A draft is never shown to the people it is addressed to.
        OR (p_instance.state <> 'draft'
            AND EXISTS (SELECT 1 FROM keystone.document_party dp, keystone.app_user me
                         WHERE me.id = v_viewer.id
                           AND dp.instance_id = COALESCE(p_instance.package_lead_id, p_instance.id)
                           AND dp.tenant_id = p_instance.tenant_id
                           AND (dp.external_ref = me.id OR (dp.email IS NOT NULL AND lower(dp.email) = lower(me.email)))));
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
$function$;
