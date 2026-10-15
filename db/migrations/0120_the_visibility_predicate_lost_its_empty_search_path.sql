-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P10 CLOSE — A SECURITY DEFINER FUNCTION I REWROTE IN 0118 LOST ITS EMPTY search_path.
--
-- ★★★ WHAT I DID, PLAINLY. 0098 defined `document_is_visible` with `SET search_path = ''`. P10.1's
--     migration 0118 rewrote the function to make the party depend on the document's DIVISION — a
--     correct fix — and in retyping the header wrote `SET search_path = keystone, pg_temp`.
--     **The function body did not change in any way that needed that, and nothing asked for it.**
--     It was a transcription loss, and it converted a hardened function into a live
--     privilege-escalation primitive.
--
-- ★★★ WHY `keystone, pg_temp` IS NOT "NEARLY AS GOOD AS EMPTY". `pg_temp` IS THE CALLER'S OWN
--     SCHEMA. Any caller may `CREATE TEMP TABLE` or `CREATE FUNCTION pg_temp....` and, for any name
--     in the body that is NOT schema-qualified, have their object resolved instead — and then
--     executed with the DEFINER's privileges. `document_is_visible` is the predicate three RLS
--     policies consult to decide who may read a document. The thing an attacker gets to influence
--     is the answer to *"may this person see this instrument?"*
--   ★★ `search_path = ''` removes the question entirely: every name must be schema-qualified, and
--      an unqualified one fails LOUDLY at definition time rather than resolving to a stranger's
--      object at call time.
--
-- ★★★ NOTHING ELSE CHANGES. The body below is 0118's, character-for-character, including P10.1's
--     division branch. This migration alters the HEADER and only the header. It was caught by
--     `db/gates/p21a_definer_search_path.mjs`, which is exactly the gate that exists for it — and
--     it was caught at the PHASE CLOSE, not when P10.1 was written, because P10.1 ran its own gates
--     and not the suite. ★ That is the whole argument for the full suite at every close.
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
  'P10 CLOSE (0120): 0118''s body verbatim — the division-aware party mapping is unchanged — with search_path restored to the empty string 0098 had set. 0118 rewrote the header as `keystone, pg_temp`, which lets any caller shadow an unqualified name through their own temp schema and have it run with the definer''s privileges, on the predicate three RLS policies use to decide who may read a document.';
