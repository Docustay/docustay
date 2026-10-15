-- 0369_a_dismissed_prompt_is_the_only_prompt_we_keep
--
-- S11-OQ-2 / D9 — prompts are computed on read, never stored as a queue or a cache. The single
-- fact this project keeps about a prompt is that a person DISMISSED it: which practice, which
-- viewer, which prompt kind, which subject (if the prompt has one), and when. Re-dismissing the
-- same (tenant, app_user, prompt_kind, subject_key) refreshes dismissed_at rather than piling up
-- rows. keystone.prompt_dismissal is that table, and it is the only stored prompt fact — everything
-- else about "should this prompt show right now" is computed at read time by src/prompts/engine.mjs
-- (task 11.4), never persisted.

CREATE TABLE keystone.prompt_dismissal (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id      uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,  -- who dismissed it
  prompt_kind      text        NOT NULL CHECK (prompt_kind ~ '^[a-z][a-z0-9_]*$' AND char_length(prompt_kind) <= 64),
  subject_key      text        NOT NULL DEFAULT '' CHECK (subject_key = '' OR subject_key ~ '^[0-9a-f-]{36}$'),
  fact_fingerprint text        NOT NULL CHECK (char_length(fact_fingerprint) BETWEEN 1 AND 128),
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_dismissal_once UNIQUE (tenant_id, app_user_id, prompt_kind, subject_key)
);
CREATE INDEX prompt_dismissal_viewer ON keystone.prompt_dismissal (tenant_id, app_user_id);
ALTER TABLE keystone.prompt_dismissal ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.prompt_dismissal FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.prompt_dismissal USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.prompt_dismissal FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.prompt_dismissal FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                           WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.prompt_dismissal FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE ON keystone.prompt_dismissal TO app_rw;
GRANT SELECT ON keystone.prompt_dismissal TO reference_guard;
-- ★ REHEARSAL FIX (25 Sep 2026): CREATE TRIGGER requires EXECUTE on the trigger function for the
-- creating role, and app_owner deliberately does not hold it on refuse_touch_reference_rows()
-- (owned by reference_guard, ACL reference_guard-only). Without this dance the file dies with
-- "permission denied for function keystone.refuse_touch_reference_rows" — MEASURED against a
-- copy of production. Idiom copied from 0402:32-46.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER prompt_dismissal_refuse_reference_delete_trg AFTER DELETE ON keystone.prompt_dismissal
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.prompt_dismissal ENABLE ALWAYS TRIGGER prompt_dismissal_refuse_reference_delete_trg;
CREATE TRIGGER prompt_dismissal_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.prompt_dismissal
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.prompt_dismissal ENABLE ALWAYS TRIGGER prompt_dismissal_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;
COMMENT ON TABLE keystone.prompt_dismissal IS 'D9 — prompts are computed on read; a dismissal is the only prompt fact stored. One row per (practice, person, kind, subject); re-dismissing refreshes it. subject_key is the subject uuid as text, or '''' when the prompt has no single subject.';

-- CT-F52 point 4b, bullet 1: the reference_guard_read policy above is the PLAIN form (point 3) —
-- its USING clause calls no function — so there is nothing for a GRANT EXECUTE to name. Bullet 2:
-- keystone.refuse_touch_reference_rows() is owned BY reference_guard (0144:245), so the trigger
-- functions need no per-table grant either; no redundant grant added, function not re-owned.
-- Bullet 3 is asserted below, in the DO block.

DO $$
DECLARE
  v_policy_count int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.prompt_dismissal'::regclass) THEN
    RAISE EXCEPTION '0369: keystone.prompt_dismissal does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.prompt_dismissal'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0369: keystone.prompt_dismissal does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.prompt_dismissal'::regclass
     AND tgname IN ('prompt_dismissal_refuse_reference_delete_trg', 'prompt_dismissal_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0369: keystone.prompt_dismissal does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  -- CT-F52 point 4b, bullet 3 / 0144 §e's end state: reference_guard_read on this table is
  -- exactly (TO reference_guard, FOR SELECT, PERMISSIVE) and nothing else.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.prompt_dismissal'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0369: reference_guard_read on keystone.prompt_dismissal is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.prompt_dismissal', 'SELECT') THEN
    RAISE EXCEPTION '0369: app_rw is missing SELECT on keystone.prompt_dismissal';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.prompt_dismissal', 'DELETE') THEN
    RAISE EXCEPTION '0369: app_rw must not hold DELETE on keystone.prompt_dismissal — nothing deletes a dismissal; app_user deletion cascades as owner';
  END IF;
END $$;
