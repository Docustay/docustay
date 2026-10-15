-- 0651 · THE SHARED DOCUMENT ENGINE (design: specs/SHARED-DOCUMENT-ENGINE-DESIGN-6OCT.md). Additive and idempotent where PostgreSQL allows.
--  1. document_template gains the source (a TipTap document), its version, its render profile, the hash of the source (the template-text hash the contract path never had)
--     and where the template came from. Existing rows keep NULL and their current behaviour: NULL render_profile means "by builder" (contract builder -> contract view,
--     pdf builder -> the printed pages).
--  2. document_ai_job — the AI draft and edit requests (a worker task runs them; a person reads the result).
ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS source         jsonb,
  ADD COLUMN IF NOT EXISTS source_version smallint,
  ADD COLUMN IF NOT EXISTS render_profile text,
  ADD COLUMN IF NOT EXISTS source_hash    text,
  ADD COLUMN IF NOT EXISTS origin         text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_template_render_profile_check') THEN
    ALTER TABLE keystone.document_template ADD CONSTRAINT document_template_render_profile_check CHECK (render_profile IS NULL OR render_profile IN ('typeset','contract'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_template_origin_check') THEN
    ALTER TABLE keystone.document_template ADD CONSTRAINT document_template_origin_check CHECK (origin IS NULL OR origin IN ('readymade','upload','written','ai','import'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_template_source_hash_check') THEN
    ALTER TABLE keystone.document_template ADD CONSTRAINT document_template_source_hash_check CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_template_source_pair_check') THEN
    ALTER TABLE keystone.document_template ADD CONSTRAINT document_template_source_pair_check CHECK ((source IS NULL) = (source_version IS NULL));
  END IF;
END $$;

-- §B — keystone.document_ai_job
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.document_ai_job (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  mode            text        NOT NULL CHECK (mode IN ('template','document')),
  kind            text        NOT NULL DEFAULT 'draft' CHECK (kind IN ('draft','edit')),
  vocabulary      text        NOT NULL CHECK (vocabulary IN ('docustay','workbench')),
  prompt          text        NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
  base_template_id uuid       NULL REFERENCES keystone.document_template(id) ON DELETE SET NULL,
  base_source     jsonb       NULL,
  state           text        NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','cancelled')),
  result_source   jsonb       NULL,
  patches         jsonb       NULL,
  message         text        NULL,
  provider        text        NULL,
  model           text        NULL,
  input_tokens    integer     NULL,
  output_tokens   integer     NULL,
  requested_by    uuid        NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz NULL,
  finished_at     timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_ai_job_requested_by_fkey FOREIGN KEY (tenant_id, requested_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (requested_by)
);
CREATE UNIQUE INDEX document_ai_job_tenant_id_key ON keystone.document_ai_job (tenant_id, id);
CREATE INDEX document_ai_job_tenant_created_idx ON keystone.document_ai_job (tenant_id, created_at);

ALTER TABLE keystone.document_ai_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_ai_job FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_ai_job USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_ai_job FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_ai_job FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                                WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ No tenant_delete: no delete path is named for this table (header) — a job is done
-- or abandoned, never deleted, same "toggled, never deleted" shape as keystone.loyalty_rule (0414).
CREATE POLICY reference_guard_read ON keystone.document_ai_job FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- CT-F52 point 4 — no delete path this stage (see header): SELECT, INSERT, UPDATE only.
GRANT SELECT, INSERT, UPDATE ON keystone.document_ai_job TO app_rw;
GRANT SELECT ON keystone.document_ai_job TO reference_guard;

-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers, each ENABLE ALWAYS. The lend/give-back.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_ai_job_refuse_reference_delete_trg AFTER DELETE ON keystone.document_ai_job
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_job ENABLE ALWAYS TRIGGER document_ai_job_refuse_reference_delete_trg;
CREATE TRIGGER document_ai_job_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_ai_job
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_job ENABLE ALWAYS TRIGGER document_ai_job_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- §0.4 A base shape's touch trigger (updated_at) — document_ai_job is not append-only:
-- confirmed_fields/state are set after the row is first written.
CREATE TRIGGER document_ai_job_touch BEFORE UPDATE ON keystone.document_ai_job
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

COMMENT ON TABLE keystone.document_ai_job IS '0651 — one AI draft or edit request of the shared document engine: the prompt (a description of a KIND of document, never a person''s data), its state, and the result as a source for a person to read. Never creates or publishes a template. No delete path: a job is done, failed or cancelled, never deleted.';

-- CT-F52 point 6 — the closing self-check, WITH ITS POSITIVE CONTROL INSIDE THE SQL (0408/0414's template).
DO $document_ai_job_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_ai_job'::regclass) THEN
    RAISE EXCEPTION '0651: keystone.document_ai_job does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.document_ai_job'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0651: keystone.document_ai_job does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='document_ai_job' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0651: document_ai_job has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.document_ai_job'::regclass
     AND tgname IN ('document_ai_job_refuse_reference_delete_trg', 'document_ai_job_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0651: keystone.document_ai_job does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'keystone.document_ai_job'::regclass
                    AND tgname = 'document_ai_job_touch' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0651: keystone.document_ai_job is missing its enabled document_ai_job_touch trigger';
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.document_ai_job'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0651: reference_guard_read on keystone.document_ai_job is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.document_ai_job', 'SELECT') THEN
    RAISE EXCEPTION '0651: app_rw is missing SELECT on keystone.document_ai_job';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_ai_job', 'INSERT') THEN
    RAISE EXCEPTION '0651: app_rw is missing INSERT on keystone.document_ai_job';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_ai_job', 'UPDATE') THEN
    RAISE EXCEPTION '0651: app_rw is missing UPDATE on keystone.document_ai_job';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_ai_job', 'DELETE') THEN
    RAISE EXCEPTION '0651: app_rw must NOT hold DELETE on keystone.document_ai_job — a job is done, failed or cancelled, never deleted';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.document_ai_job', 'SELECT') THEN
    RAISE EXCEPTION '0651: reference_guard is missing SELECT on keystone.document_ai_job';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0651: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the document_ai_job lend was not revoked';
  END IF;
END
$document_ai_job_ct_f52_self_check$;

-- Written, not applied.
