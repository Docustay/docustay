-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P10.1 — THE PARTY A VIEWER IS DEPENDS ON THE DIVISION. IT WAS HARD-CODED TO THE RECOVERY WORD.
--
-- ★★★ MEASURED 2026-09-15, THREE PROBES THROUGH `withTenant` AS A REAL `adult_client`:
--
--       division=tech      assigned_to={client}   → the client sees it:  FALSE
--       division=recovery  assigned_to={pir}      → the client sees it:  true
--       division=tech      assigned_to={pir}      → the client sees it:  true
--
--     `document_is_visible()` maps every client role to ONE party:
--       adult_client → 'pir' · adolescent_client → 'pir' · parent → 'parent'
--     So an instrument assigned to `client` — **a legal value of `assigned_to`, permitted by the
--     column's own CHECK, and the correct word for the tech division** — is invisible to the very
--     person it was assigned to. Not refused with a reason: absent. It does not appear in their
--     documents list, and `/api/app/documents/:id` 404s on it.
--
-- ★★★ THIS IS CLAUDE.md §2.7's DEFECT WITH THE SIGN FLIPPED, AND THE RULE IS THE SAME ONE.
--     The recorded case: *a GLT tech client's signature rendered under a badge reading "PIR" on an
--     executed instrument, because a `|| signerByRole.client` fallback let the recovery branch catch
--     the tech party.* **There, a tech party was given the recovery word. Here, only the recovery
--     word exists at all** — so the tech party is not mislabelled, it is unreachable.
--   ★★ §2.7's rule covers both: **NAME THE PARTY YOU MEAN, NEVER BORROW ANOTHER'S.** A single
--      viewer-role → party mapping cannot do that in a product with two divisions, because the same
--      person IS a different party depending on which division's instrument they are holding.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT CHANGES, EXACTLY — AND IT IS ONE CASE.
--
--     Before: v_party := (adult_client|adolescent_client → 'pir', parent → 'parent')
--     After:  the same, EXCEPT that in a `tech` document a client is `client`.
--
--   ★★ NOTHING ELSE MOVES. Every refusal above this line is untouched: staff-only, archived, draft,
--      not-your-subject, session-note-via-guardian, audience. A viewer who could not reach a
--      document before still cannot; the only row that becomes visible is one whose OWN
--      `assigned_to` already named the viewer's party, in the viewer's own division, on the viewer's
--      own subject row.
--   ★ `parent` is unchanged in both divisions: a parent is a `parent` wherever they are. The word
--     that differs between divisions is the one for the person receiving the service.
--
-- ★★★ AND THE DIVISION COMES FROM THE TYPE, WHICH IS WHERE IT IS DECLARED. `document_type.division`
--     is NOT NULL with a CHECK of exactly `recovery | tech`, so there is no third branch to get
--     wrong and no default to fall through.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = keystone, pg_temp
AS $$
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

  -- ★★★ STAFF FIRST, AND THAT ORDER IS THE WHOLE MIGRATION (0012). Staff reach an archived document
  --     so it can be restored; the WITH CHECK on the archiving UPDATE passes for the same reason.
  IF v_viewer.role = 'staff' THEN RETURN true; END IF;

  -- ★★★ AND NOBODY ELSE DOES. A retired document is not a client's to read. [MEASURED] with this
  --     line absent, a client saw `client_agreement/sent/archived` in their own list.
  IF p_instance.archived_at IS NOT NULL THEN RETURN false; END IF;

  IF p_instance.state = 'draft' THEN RETURN false; END IF;

  -- ★ Reaching the document AT ALL: it is the viewer's own, or they are a guardian of its subject.
  --   ★★ `v_via_guard` REMEMBERS WHICH, and that memory is the whole fix of 0012 — the old code
  --      discarded it and then asked about the viewer's role instead.
  IF p_instance.subject_user_id IS DISTINCT FROM v_viewer.id THEN
    v_via_guard := keystone.is_guardian_of(v_viewer.id, p_instance.subject_user_id);
    IF NOT v_via_guard THEN RETURN false; END IF;
  END IF;

  SELECT t.audience, t.is_session_note, t.division INTO v_type
    FROM keystone.document_type t WHERE t.id = p_instance.type_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- ★★★ THE RULE, ASKED CORRECTLY. Not "is this viewer a parent" but **"is this somebody else's
  --     session note?"** Keyed on the EDGE the viewer travelled, so no role — existing or invented
  --     — and no audience an operator configures can get round it.
  IF v_type.is_session_note AND (v_via_guard OR v_viewer.role = 'parent') THEN RETURN false; END IF;

  IF NOT (v_viewer.role = ANY(v_type.audience)) THEN RETURN false; END IF;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════
  -- ★★★ P10.1 — THE ONE LINE THAT CHANGED. THE PARTY DEPENDS ON THE DIVISION.
  --     A person receiving the service is a `pir` on a recovery instrument and a `client` on a tech
  --     one. Mapping every client role to `pir` made every tech document assigned to `client`
  --     invisible to its own subject — measured, not theorised; see this file's header.
  --   ★ `parent` is a `parent` in both divisions, so it does not branch.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════
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
  'P10.1 (0117): the party a viewer is depends on the document DIVISION — pir in recovery, client in tech. Before this, a tech document assigned to `client` was invisible to the client it was assigned to. Everything above that line is 0012 unchanged.';
