-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- REFINES 0095 — WHICH WAS RIGHT ABOUT THE DEFECT AND TOO BLUNT ABOUT THE REMEDY.
--
-- ★★★ 0095 REMOVED THE `archived_at` TEST FROM `document_is_visible` ENTIRELY, on the grounds that
--     "a policy answers WHO MAY SEE A ROW, never WHETHER THE ROW IS CURRENT." The defect it fixed
--     was real and is proven: archiving a document failed its own WITH CHECK, and restoring one
--     could never find it.
--   ★★ BUT `db/gates/p6_document_visibility.mjs` THEN WENT RED, AND IT WAS RIGHT TO:
--         ✗ D1 — client sees only audience-permitted documents
--           got 2: client_agreement/executed, client_agreement/sent/ARCHIVED
--      **A client could now see a document the practice had retired.** For a CLIENT, currency IS
--      part of who-may-see: a retired document is not theirs to read or act on, and it appearing in
--      their list is the practice saying something it did not mean to say.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULE, CORRECTED — ARCHIVED IS VISIBLE TO STAFF AND TO NOBODY ELSE.
--
--   · STAFF see archived documents. They must: they are the only party who can RESTORE one, and a
--     row they cannot see is a row they cannot un-archive. This is what 0095 was protecting.
--   · CLIENTS, PARENTS AND GUARDIANS do not. This is what the gate was protecting.
--
--   ★★ Both were true at once and the previous two versions each held one of them. The check moves
--      to sit immediately AFTER the staff branch — one line, in a different place, and the two
--      requirements stop being in tension.
--   ★ Note the ordering is load-bearing in the WRITE direction too: `archiveRecord` runs as staff,
--     so the staff branch returns true and the policy's WITH CHECK passes on the newly-archived
--     row. That is why moving the line works where deleting it and keeping it both failed.
--
-- ★★★ AND THE LIST LAYER IS UNCHANGED AND STILL CORRECT. `scoped()` filters `archived_at IS NULL`
--     for every archivable table, so an archived document does not clutter a STAFF list either.
--     This policy governs reachability — the record page, and restore — not what a list shows.
--     Three layers, three different questions: RLS = may this person see it, list = is it current,
--     record page = show me the one I asked for.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance keystone.document_instance)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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

  -- ★★★ STAFF FIRST, AND THAT ORDER IS THE WHOLE MIGRATION. Staff reach an archived document so it
  --     can be restored; the WITH CHECK on the archiving UPDATE passes for the same reason.
  IF v_viewer.role = 'staff' THEN RETURN true; END IF;

  -- ★★★ AND NOBODY ELSE DOES. A retired document is not a client's to read. [MEASURED] with this
  --     line absent, a client saw `client_agreement/sent/archived` in their own list.
  IF p_instance.archived_at IS NOT NULL THEN RETURN false; END IF;

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
END $$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  'The tenant_isolation policy on document_instance. ★★★ ARCHIVED IS VISIBLE TO STAFF ONLY — they '
  'are the only party who can restore a document, and a row they cannot see is a row they cannot '
  'un-archive (0095 proved archiving itself failed the WITH CHECK when the test preceded the staff '
  'branch). A client must NOT see a retired document, which is what 0098 restores. Lists are '
  'filtered separately by scoped(); this governs reachability, not what a list shows.';
