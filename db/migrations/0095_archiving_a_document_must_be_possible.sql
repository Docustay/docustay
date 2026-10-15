-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2 CLOSE (§VISUAL) — ARCHIVING A DOCUMENT WAS NOT A ONE-WAY DOOR. IT WAS A DOOR THAT DID NOT OPEN.
--
-- ★★★ [EXECUTED, local, today] `archiveRecord(object: 'document')` — the ONLY sanctioned way to
--     archive anything — FAILS OUTRIGHT:
--
--       error: new row violates row-level security policy for table "document_instance"
--
--     `keystone.document_is_visible()` is the `tenant_isolation` policy on `document_instance`, and
--     it returned FALSE for any row with `archived_at IS NOT NULL`. A policy is checked on the NEW
--     row as a `WITH CHECK`, so the instant the UPDATE set the column, the row it had just written
--     became invisible to the policy that authorised writing it. **Postgres rejected the write.**
--
--   ★★ AND HAD IT SUCCEEDED IT WOULD HAVE BEEN WORSE. Set by any path that bypasses RLS, the row
--      then fails the USING clause too: invisible to the record page, to every list, and — the part
--      that matters — **to `restoreRecord`'s own UPDATE, which finds zero rows and refuses.**
--      P2.9's stated promise is *"archiving is not a one-way door, and that is the whole argument
--      for it over deletion."* For documents it was a door with no handle on either side.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULING — AN RLS POLICY ANSWERS "WHO MAY SEE THIS ROW", NEVER "IS THIS ROW CURRENT".
--
--   Those are different questions and they belong at different layers. Visibility is about the
--   VIEWER — their role, the guardian edge they travelled, the audience the type declares. Currency
--   is about the RECORD, and is the same answer for everybody who may see it at all.
--   ★★ Collapsing them costs exactly what it cost here: the row vanishes for the administrator
--      trying to undo the mistake as thoroughly as for the client who should not see it.
--
--   ★ WHERE THE FILTER CORRECTLY LIVES, AND ALREADY DID: `scoped()` in src/records/lists.mjs
--     appends `AND <alias>.archived_at IS NULL` for every archivable table, and `document_instance`
--     is one. So the day-to-day lists were ALREADY right, and this line was not doing the work it
--     looked like it was doing — it was only breaking the two paths that must reach an archived row.
--
-- ★★ HOW THIS GOT THROUGH P2.9. The gate archived a PERSON and asserted the record page still
--    opened. It never archived a DOCUMENT. **The subject was supplied by the test's own choice of
--    object** — the house defect, in the one phase that exists to prevent it. `document` is the only
--    one of the nine archivable objects whose table carries a row-level visibility predicate, which
--    is precisely why picking any other object proved nothing about it.
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

  -- ★★★ THE `archived_at` TEST THAT STOOD HERE IS GONE, AND ITS ABSENCE IS THE MIGRATION.
  --     It made archiving a document impossible and restoring one unreachable. The day-to-day
  --     filtering it appeared to provide is done by `scoped()`, at the list layer, where a record
  --     being current is a question about the LIST rather than about the VIEWER.

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
END $$;

COMMENT ON FUNCTION keystone.document_is_visible(keystone.document_instance) IS
  'The tenant_isolation policy on document_instance. ★★★ It answers WHO MAY SEE THIS ROW and '
  'deliberately says nothing about whether the row is current. An archived_at test lived here and '
  'made archiveRecord() fail with "new row violates row-level security policy" — the policy is a '
  'WITH CHECK on the new row, so setting the column invalidated the write that set it. Archiving is '
  'filtered by scoped() at the LIST layer, which is the layer that question belongs to.';
