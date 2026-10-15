-- 0038_executed_is_immutable
-- P15C.11 — ★★★ U25 WAS ENFORCED AT **NEITHER** LAYER. `executed_shape` ONLY CHECKS THAT TWO COLUMNS
--               ARE PRESENT.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [MEASURED] `executed_shape` (0009:158-160) asserts that an executed row HAS a snapshot and a
-- timestamp. It says nothing about whether either may CHANGE afterwards — and there was no trigger
-- refusing an UPDATE to an executed row anywhere (zero hits). The UI side was a FLAG (`readOnlyWhen`
-- computed in buildRecordShell): a flag, not a refusal.
--   ★★ So an executed instrument's frozen words, its price and its execution time were all editable by
--      any `UPDATE` — including one from a well-meaning fix-up script. **The snapshot exists precisely so
--      that what a person signed cannot change afterwards; a mutable snapshot is no snapshot at all.**
--
-- ★★★ WHAT THIS TRIGGER PERMITS, AND WHY THE LIST IS SHORT AND EXPLICIT:
--   · NOTHING on the instrument's substance: not `template_snapshot`, not `executed_at`, not `state`,
--     not `builder`, not `title`, not `type_id`, not `template_id`, not `subject_user_id`.
--   · `updated_at` ALONE may move, and only alongside nothing else, so an UPDATE that merely touches a
--     timestamp does not become a way to smuggle a change.
--   ★★ `deleted` IS **NOT** PERMITTED TO CHANGE. Soft-deleting an executed instrument would remove it
--      from every surface while leaving the row — which is indistinguishable, to a reader, from it never
--      having existed. If an executed instrument must be withdrawn, that is a VOID with its own record,
--      not a flag flip.
--
-- ★ A DECLINED instrument is treated the same way: it is a terminal state carrying what it said when it
--   was declined, and editing it would rewrite a refusal.

CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_is_immutable()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  -- ★ Only rows that were ALREADY terminal are protected. Reaching `executed` is a legitimate UPDATE —
  --   it is the one that freezes the snapshot — so the guard looks at OLD.state, never NEW.state.
  IF OLD.state NOT IN ('executed', 'declined') THEN
    RETURN NEW;
  END IF;

  -- ★★ EVERY SUBSTANTIVE COLUMN, NAMED. A blanket "nothing may change" would also block `updated_at`,
  --    and a blanket "compare the whole row" cannot say WHICH field somebody tried to move — which is
  --    the first thing a person debugging this needs.
  IF NEW.template_snapshot::text IS DISTINCT FROM OLD.template_snapshot::text THEN
    changed := changed || 'template_snapshot'; END IF;
  IF NEW.executed_at      IS DISTINCT FROM OLD.executed_at      THEN changed := changed || 'executed_at'; END IF;
  IF NEW.state            IS DISTINCT FROM OLD.state            THEN changed := changed || 'state'; END IF;
  IF NEW.builder          IS DISTINCT FROM OLD.builder          THEN changed := changed || 'builder'; END IF;
  IF NEW.title            IS DISTINCT FROM OLD.title            THEN changed := changed || 'title'; END IF;
  IF NEW.type_id          IS DISTINCT FROM OLD.type_id          THEN changed := changed || 'type_id'; END IF;
  IF NEW.template_id      IS DISTINCT FROM OLD.template_id      THEN changed := changed || 'template_id'; END IF;
  IF NEW.subject_user_id  IS DISTINCT FROM OLD.subject_user_id  THEN changed := changed || 'subject_user_id'; END IF;
  IF NEW.sent_at          IS DISTINCT FROM OLD.sent_at          THEN changed := changed || 'sent_at'; END IF;
  IF NEW.assigned_to      IS DISTINCT FROM OLD.assigned_to      THEN changed := changed || 'assigned_to'; END IF;
  -- ★★★ AND `deleted`. Soft-deleting an executed instrument hides it from every surface while the row
  --     remains — indistinguishable from never having existed. A withdrawal is a VOID with a record.
  IF NEW.deleted          IS DISTINCT FROM OLD.deleted          THEN changed := changed || 'deleted'; END IF;

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

CREATE TRIGGER document_instance_terminal_immutable
  BEFORE UPDATE ON keystone.document_instance
  FOR EACH ROW EXECUTE FUNCTION keystone.document_instance_terminal_is_immutable();

-- ★★ AND A DELETE IS REFUSED OUTRIGHT on a terminal row. A `DELETE` would take the evidence with it —
--    including the signature chain that references it.
CREATE OR REPLACE FUNCTION keystone.document_instance_terminal_no_delete()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
BEGIN
  IF OLD.state IN ('executed', 'declined') THEN
    RAISE EXCEPTION
      'an % instrument is never deleted — its signature records reference it and its snapshot is the '
      'record of what was agreed. Void it instead.', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$fn$;

CREATE TRIGGER document_instance_terminal_no_delete
  BEFORE DELETE ON keystone.document_instance
  FOR EACH ROW EXECUTE FUNCTION keystone.document_instance_terminal_no_delete();

COMMENT ON FUNCTION keystone.document_instance_terminal_is_immutable() IS
  'P15C.11 / U25. An executed or declined instrument is immutable: every substantive column is named and '
  'compared, `updated_at` alone may move, and `deleted` may NOT — soft-deleting an executed instrument '
  'hides it from every surface while the row remains, which reads the same as never having existed. '
  'Before this, U25 was enforced at NEITHER layer: executed_shape only asserts the snapshot and timestamp '
  'are PRESENT, and the UI side was a computed flag rather than a refusal.';
