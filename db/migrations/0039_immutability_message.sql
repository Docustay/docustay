-- 0039_immutability_message
-- P15C.11 — ★★★ 0038's TRIGGER REFUSED BY ACCIDENT, WITH A MEANINGLESS MESSAGE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [EXECUTED] an UPDATE to an executed instrument raised:
--     malformed array literal: "template_snapshot"
-- NOT the U25 refusal it was written to raise. **The row was still protected — but only because the
-- function crashed before it could return.**
--
-- ★★ THE CAUSE: `changed := changed || 'template_snapshot'` is AMBIGUOUS in Postgres. The `||` operator
--    has both `anyarray || anyelement` and `anyarray || anyarray` forms, and an UNKNOWN-typed literal on
--    the right resolves to the ARRAY form — so Postgres tried to parse the column name as an array
--    literal and failed.
--   ★ The fix is one cast per append: `|| 'template_snapshot'::text`.
--
-- ★★★ AND THIS IS THE SAME CLASS OF DEFECT AS P15C.7's M18, ONE LAYER DOWN: **a correct refusal
--     delivered as a crash is a defect in its own right.** A person editing an executed instrument would
--     have seen "malformed array literal" — which names nothing, points nowhere, and reads as a bug in
--     the app rather than as a rule they have just run into. The guard has to say WHAT it is refusing and
--     WHY, or the next person works around it.
--   ★ It would also have passed a naive test: "the UPDATE was refused" is TRUE. The assertion that caught
--     it required the refusal to NAME THE FIELD — which is why that assertion exists.

CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_is_immutable()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
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
  IF NEW.deleted         IS DISTINCT FROM OLD.deleted         THEN changed := changed || 'deleted'::text; END IF;

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
$fn$;

COMMENT ON FUNCTION keystone.document_instance_terminal_is_immutable() IS
  'P15C.11 / U25, message fixed at 0039. Every `||` append is cast to ::text because an unknown-typed '
  'literal makes Postgres resolve `||` to the array form — 0038 therefore raised "malformed array '
  'literal: template_snapshot" instead of its own refusal. The row was still protected, but only because '
  'the function crashed: a correct refusal delivered as a crash names nothing and reads as an app bug. '
  'Caught by an assertion that required the refusal to NAME THE FIELD, not merely to happen.';
