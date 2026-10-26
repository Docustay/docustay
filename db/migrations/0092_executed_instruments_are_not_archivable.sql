-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.9 (correction to 0091) — AN EXECUTED INSTRUMENT MAY NOT BE ARCHIVED. I GOT THIS WRONG.
--
-- ★★★ 0091 REMOVED `deleted` FROM THE FROZEN-COLUMN LIST AND DELIBERATELY DID NOT REPLACE IT WITH
--     `archived_at`, arguing that "archiving is not deletion — the record stays, its page still
--     opens". **That argument is false for this table, and `test/p15c_frozen.test.mjs` said so.**
--
--   ★★ THE PINNED ASSERTION, VERBATIM: *"Soft-deleting an executed instrument removes it from every
--      surface while the row remains — indistinguishable, to a reader, from it never having
--      existed."* It was written about `deleted`. It is equally true of `archived_at`, because 0091
--      ALSO pointed `document_is_visible` at the new column — and that is a ROW-LEVEL visibility
--      predicate, not a list filter. An archived document does not merely leave the lists; **it
--      stops being readable at all, record page included.**
--
--   ★★★ SO THE TWO HALVES OF 0091 CONTRADICTED EACH OTHER. Its own §5 claim — "an archived record
--       leaves the lists and KEEPS ITS PAGE" — is true of a person (a list filter) and false of a
--       document (a row policy). I asserted it for `person` and generalised it to nine objects
--       without re-checking the mechanism for each. **One rule, two enforcement layers, and only one
--       of them behaves the way the rule says.**
--
-- ★ SO: `archived_at` JOINS THE FROZEN LIST. An executed instrument cannot be archived. Old executed
--   contracts stay in the documents list — real clutter, and the lesser harm by a wide margin
--   against a signed agreement becoming unreadable. ★ A tenant who wants them out of the way needs a
--   FILTER on that screen, not a state change on the instrument; P6.43 owns it.
-- ★★ DRAFTS, SENT AND DECLINED INSTRUMENTS ARE STILL ARCHIVABLE — the trigger only fires on terminal
--    states, which is the distinction that makes this safe rather than merely strict.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

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
  IF NEW.archived_at     IS DISTINCT FROM OLD.archived_at     THEN changed := changed || 'archived_at'::text; END IF;


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
$function$;
