-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0137 — OLD SUBJECT NAMES ARE CORRECTED ON THE WAY IN (Stage 3 Task 2, fix round 1, I1).
--
-- ★★★ THE GAP THIS CLOSES. Migration 0136 rewrote every EXISTING `app_user`/`user`/
--     `document_instance` row to `person`/`document`, and `emit()` (`src/events/outbox.mjs`) now
--     REFUSES any writer that tries to pass a retired literal. But those are two independent
--     changes shipped as two independent deploys of two independent artifacts (a migration, run
--     by hand — `package.json:11`, the Dockerfile CMD does not run migrations — and application
--     code, deployed separately) [review I1]. There is exactly one order that is NOT safe:
--       · 0136 runs BEFORE the new code is serving → the OLD code (still writing `app_user`) keeps
--         inserting retired literals AFTER the one-time sweep already ran and already re-checked
--         "none left". Nothing re-runs that check. Those rows are retired-literal forever.
--       · 0136 runs AFTER the new code is serving (code-first) → no gap: new writers already emit
--         `person`/`document`, and 0136 only ever finds and sweeps whatever the OLD code left
--         behind before the deploy.
--     ★★ THE STATED ORDER IS: deploy the code, THEN run 0136. This migration's whole point is to
--        make the OTHER order safe too, so the order stops being a thing an operator has to get
--        right by memory. After 0137, ANY row that arrives with a retired `subject_type` — from an
--        old server process still running mid-deploy, from a straggler background job holding an
--        old code path, from a future writer somebody adds without reading `SUBJECT_TYPES` — is
--        corrected AT THE DATABASE, not silently stored wrong. Run order after this file ships:
--        0136 then 0137 then deploy IS SAFE; 0137 then 0136 then deploy IS SAFE; 0136 then deploy
--        with 0137 never applied is the one gap that remains, so 0137 ships promptly alongside 0136.
--
-- ★★ A TRIGGER, NOT A CHECK (see `src/events/outbox.mjs`'s Fix Round 1 M1 comment for the corrected
--    claim: no CHECK on `subject_type` exists, at 0136 or now). A CHECK could only REFUSE a retired
--    literal, which would turn a straggler writer's insert into a hard failure — worse than what it
--    replaces. A BEFORE INSERT trigger CORRECTS it instead: the row is still written, under the
--    right vocabulary, and the caller never sees an error for a fact the database already knows how
--    to fix. `SUBJECT_TYPES`/`SUBJECT_TYPE_ALIASES` (`src/events/topics.mjs`) still own the actual
--    vocabulary; this trigger's CASE is the identical map, kept beside it in SQL because a trigger
--    function cannot import a JS module — the same relationship migration 0135's CHECK has with
--    `ACTOR_SHAPE` (that file's own header explains the pattern this one repeats).
--
-- ★ PLAIN, NOT SECURITY DEFINER. The function only rewrites the row already being inserted — it
--   reads and writes nothing else, needs no privilege beyond what the inserting role already has,
--   and a corrective trigger that could act with someone else's privileges is a bigger surface than
--   the one-line rewrite it exists to make. `SET search_path = pg_catalog` for the same reason every
--   SECURITY DEFINER function in this schema sets it — a search_path that could be hijacked by an
--   object of the same name in an earlier schema is a hazard whether or not this function is
--   definer-rights, and costs nothing to close here too.
--
-- ★★★ NO RESET ROLE (F482). `db/migrate.mjs` sets `app_owner` before this file runs and restores it
--     before the next one; a bare `RESET ROLE` would hand later objects to the connecting superuser.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION keystone.event_subject_type_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
BEGIN
  -- ★ THE SAME MAP AS SUBJECT_TYPE_ALIASES (src/events/topics.mjs), BY HAND, IN SQL — a trigger
  --   function cannot import a JS module, so this is the one place it is written twice, kept
  --   beside its JS twin rather than anywhere else, the same way 0135's event_actor_check keeps
  --   PROVIDERS by hand beside outbox.mjs's ACTOR_SHAPE.
  IF NEW.subject_type IN ('app_user', 'user') THEN
    NEW.subject_type := 'person';
  ELSIF NEW.subject_type = 'document_instance' THEN
    NEW.subject_type := 'document';
  END IF;
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION keystone.event_subject_type_normalize() OWNER TO app_owner;

COMMENT ON FUNCTION keystone.event_subject_type_normalize() IS
  '0137 (Stage 3 Task 2, fix round 1, I1) — BEFORE INSERT correction for keystone.event.subject_type. '
  'Rewrites the three retired literals (app_user, user -> person; document_instance -> document) so a '
  'straggler writer from an old deploy, or any future writer that does not read SUBJECT_TYPES, cannot '
  'leave a row in the retired vocabulary. Plain (not SECURITY DEFINER) — it only rewrites the row it '
  'is already given. See src/events/topics.mjs SUBJECT_TYPE_ALIASES for the one other place this same '
  'map is written, and src/events/outbox.mjs for why emit() still refuses these literals in JS rather '
  'than relying on this trigger alone (refusing at the caller names the mistake; this trigger is the '
  'backstop for whatever does not go through emit()).';

CREATE TRIGGER event_subject_type_normalize
  BEFORE INSERT ON keystone.event
  FOR EACH ROW
  EXECUTE FUNCTION keystone.event_subject_type_normalize();

COMMENT ON TRIGGER event_subject_type_normalize ON keystone.event IS
  '0137 — normalises app_user/user -> person and document_instance -> document on the way in. Makes '
  'the 0136/deploy run order safe in either direction (see this migration''s file header).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE POSITIVE CONTROL, IN-MIGRATION. `app_owner` cannot simply INSERT INTO keystone.event —
--     the table is FORCE RLS under `tenant_isolation` (WITH CHECK tenant_id = current_tenant_id()),
--     and with no tenant GUC set the insert would be REFUSED outright, not silently accepted. So a
--     REAL tenant is needed, enumerated as `auth_owner` exactly as 0131/0136 do (`tenant_health_read`,
--     0017, FOR SELECT USING true) — this reads ONE tenant id, not a privileged write.
--   ★★ AND THE INSERT MUST NEVER STICK. A PL/pgSQL `BEGIN … EXCEPTION … END` block is Postgres's
--      own implicit SAVEPOINT: entering the block opens one, and reaching the deliberate
--      `RAISE EXCEPTION` at its end unwinds it — exactly "insert inside a savepoint, then roll back
--      to the savepoint" — without ever leaving a probe row behind, and without the top-level SQL
--      `SAVEPOINT`/`ROLLBACK TO` statements, which PL/pgSQL does not accept directly.
--   ★ A REAL ASSERTION FAILURE RAISES A DIFFERENT MESSAGE, so the outer handler tells the two apart:
--     the sentinel means "the probe finished, roll it back", anything else means "the trigger is
--     broken", and only the second one is allowed to fail the migration.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $probe_trigger$
DECLARE
  v_tenant_id uuid;
  v_person    text;
  v_document  text;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT id INTO v_tenant_id FROM keystone.tenant ORDER BY id LIMIT 1;
  SET LOCAL ROLE app_owner;

  IF v_tenant_id IS NULL THEN
    -- ★ An empty database (fresh install, before any signup) has no tenant to probe under — zero
    --   tenants is legitimate here the same way 0131 treats zero matching rows as legitimate.
    RAISE NOTICE '0137: no tenant exists to run the in-migration trigger probe against — skipped (legitimate on a fresh database)';
  ELSE
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    BEGIN
      INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, actor)
      VALUES (v_tenant_id, 'people.person.created', 'people', 'app_user', 'system')
      RETURNING subject_type INTO v_person;

      INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, actor)
      VALUES (v_tenant_id, 'documents.document.created', 'documents', 'document_instance', 'system')
      RETURNING subject_type INTO v_document;

      IF v_person <> 'person' THEN
        RAISE EXCEPTION '0137: trigger did not normalise app_user -> person (got %)', v_person;
      END IF;
      IF v_document <> 'document' THEN
        RAISE EXCEPTION '0137: trigger did not normalise document_instance -> document (got %)', v_document;
      END IF;

      -- ★ THE DELIBERATE UNWIND. Both probe rows above are undone by this exception, caught below.
      RAISE EXCEPTION '0137_PROBE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> '0137_PROBE_ROLLBACK' THEN
        RAISE;  -- ★ a REAL failure (the trigger did not do its job) — propagate and fail the migration.
      END IF;
      -- ★ expected: the probe ran, both rewrites were correct, and this block's implicit savepoint
      --   has already rolled the two probe rows back. Nothing left to do.
    END;
    PERFORM set_config('keystone.tenant_id', '', true);
    RAISE NOTICE '0137: trigger probe passed — app_user -> % , document_instance -> % (both rolled back)', v_person, v_document;
  END IF;
END
$probe_trigger$;
