-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.9 (correction to 0088) — TWO LIVE FUNCTIONS STILL READ THE COLUMN 0088 DROPPED.
--
-- ★★★ DROPPING `document_instance.deleted` DID NOT BREAK ANYTHING AT MIGRATION TIME, AND THAT IS THE
--     WHOLE PROBLEM. PL/pgSQL resolves column references at EXECUTION, so both of these compiled
--     happily against a column that no longer exists and would have raised
--     `record "p_instance" has no field "deleted"` the first time a document was read or an executed
--     instrument was touched. [MEASURED] `db/gates/p15_crm_screens.mjs` threw exactly that.
--
--   ★★ TWO of five functions mentioning "deleted" actually READ it. The other three only name it in
--      an error MESSAGE ("an executed instrument is never deleted…"), which is prose and is fine.
--      **A grep for the word found five; only the catalogue's `prosrc` told me which two mattered.**
--
--   · `document_is_visible`  — the row-level visibility predicate. A hidden document must stay
--     hidden, so the test becomes `archived_at IS NOT NULL`.
--   · `document_instance_terminal_is_immutable` — the frozen-column list for an executed instrument.
--     ★★★ `deleted` is NOT replaced by `archived_at` there, and that is a DECISION: an executed
--         instrument may be ARCHIVED. Archiving is not deletion — the record stays, its page still
--         opens, the signatures still reference it — and a practice with five years of executed
--         contracts needs to be able to put the old ones away. Freezing `archived_at` would make
--         every executed instrument permanent clutter, which is the opposite of what P2.9 is for.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.document_is_visible(p_instance document_instance)
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

  IF p_instance.archived_at IS NOT NULL THEN RETURN false; END IF;
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



CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_is_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF OLD.state NOT IN ('executed', 'declined') THEN
    RETURN NEW;
  END IF;

  -- ★ EVERY APPEND IS CAST. See the header: an unknown-typed literal makes `||` pick the array form.
  IF NEW.template_snapshot::text IS DISTINCT FROM OLD.template_snapshot::text THEN
    changed := changed || 'template_snapshot'::text; END IF;
  IF NEW.executed_at     IS DISTINCT FROM OLD.executed_at     THEN changed := changed || 'executed_at'::text; END IF;
  IF NEW.state           IS DISTINCT FROM OLD.state           THEN changed := changed || 'state'::text; END IF;
  IF NEW.builder         IS DISTINCT FROM OLD.builder         THEN changed := changed || 'builder'::text; END IF;
  IF NEW.title           IS DISTINCT FROM OLD.title           THEN changed := changed || 'title'::text; END IF;
  IF NEW.type_id         IS DISTINCT FROM OLD.type_id         THEN changed := changed || 'type_id'::text; END IF;
  IF NEW.template_id     IS DISTINCT FROM OLD.template_id     THEN changed := changed || 'template_id'::text; END IF;
  IF NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id THEN changed := changed || 'subject_user_id'::text; END IF;
  IF NEW.sent_at         IS DISTINCT FROM OLD.sent_at         THEN changed := changed || 'sent_at'::text; END IF;
  IF NEW.assigned_to     IS DISTINCT FROM OLD.assigned_to     THEN changed := changed || 'assigned_to'::text; END IF;


  IF array_length(changed, 1) > 0 THEN
    RAISE EXCEPTION
      'this instrument is % and cannot be changed (U25). Attempted to alter: %. The snapshot exists so '
      'that what a person signed cannot change afterwards — a mutable snapshot is no snapshot at all. '
      'To correct an executed instrument, VOID it and issue a new one; to withdraw one, void it rather '
      'than flagging it deleted.',
      OLD.state, array_to_string(changed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$


