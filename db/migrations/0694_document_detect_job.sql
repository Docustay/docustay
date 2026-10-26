-- 0694 · THE AI LOOK FOR FIELDS, AS A BACKGROUND JOB (Run 4, 10 Oct 2026). Additive. One row per "Find fields with AI" request on a draft; the pages inside it are worked in parallel by the worker, one task per page,
-- and each page's state lives in `pages` (a jsonb map written one key at a time, so two pages finishing together never overwrite each other). The model only ever picks numbered boxes the program itself found and says what
-- they are; it never gives coordinates. The result waits here until the editor fetches it, so the person's own saved draft is never overwritten behind their back.
CREATE TABLE keystone.document_detect_job (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  instance_id     uuid        NOT NULL,
  state           text        NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','cancelled')),
  pages_total     integer     NOT NULL CHECK (pages_total BETWEEN 1 AND 200),
  pages_done      integer     NOT NULL DEFAULT 0 CHECK (pages_done >= 0),
  pages           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  seats           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  second_check    boolean     NOT NULL DEFAULT false,
  provider        text        NULL,
  model           text        NULL,
  message         text        NULL,
  credits         numeric(10,3) NOT NULL DEFAULT 0,
  input_tokens    integer     NOT NULL DEFAULT 0,
  output_tokens   integer     NOT NULL DEFAULT 0,
  requested_by    uuid        NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz NULL,
  finished_at     timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_detect_job_requested_by_fkey FOREIGN KEY (tenant_id, requested_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (requested_by)
);
CREATE UNIQUE INDEX document_detect_job_tenant_id_key ON keystone.document_detect_job (tenant_id, id);
CREATE INDEX document_detect_job_instance_idx ON keystone.document_detect_job (tenant_id, instance_id, created_at);

ALTER TABLE keystone.document_detect_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_detect_job FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_detect_job USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_detect_job FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_detect_job FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                                WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_detect_job FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

GRANT SELECT, INSERT, UPDATE ON keystone.document_detect_job TO app_rw;
GRANT SELECT ON keystone.document_detect_job TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_detect_job_refuse_reference_delete_trg AFTER DELETE ON keystone.document_detect_job
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_detect_job ENABLE ALWAYS TRIGGER document_detect_job_refuse_reference_delete_trg;
CREATE TRIGGER document_detect_job_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_detect_job
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_detect_job ENABLE ALWAYS TRIGGER document_detect_job_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_detect_job_touch BEFORE UPDATE ON keystone.document_detect_job
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

COMMENT ON TABLE keystone.document_detect_job IS '0694 — one AI look for fields on a draft: the pages the program found boxes on, each worked by its own task; the model picks numbered boxes and names them, never gives coordinates. A job is finished or abandoned, never deleted by the application (the tenant cascade removes it with the workspace).';

DO $document_detect_job_self_check$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_detect_job'::regclass) THEN
    RAISE EXCEPTION '0694: keystone.document_detect_job does not have FORCE ROW LEVEL SECURITY';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'keystone.document_detect_job'::regclass AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read')) <> 4 THEN
    RAISE EXCEPTION '0694: keystone.document_detect_job does not carry exactly the four expected policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'keystone.document_detect_job'::regclass AND tgname IN ('document_detect_job_refuse_reference_delete_trg', 'document_detect_job_refuse_reference_truncate_trg') AND tgenabled = 'A') <> 2 THEN
    RAISE EXCEPTION '0694: keystone.document_detect_job does not carry both guard triggers, ENABLE ALWAYS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'keystone.document_detect_job'::regclass AND tgname = 'document_detect_job_touch' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0694: keystone.document_detect_job is missing its enabled touch trigger';
  END IF;
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'keystone.document_detect_job'::regclass AND p.polname = 'reference_guard_read' AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['reference_guard'::regrole::oid]) <> 1 THEN
    RAISE EXCEPTION '0694: reference_guard_read on keystone.document_detect_job is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE)';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_detect_job', 'SELECT') OR NOT has_table_privilege('app_rw', 'keystone.document_detect_job', 'INSERT') OR NOT has_table_privilege('app_rw', 'keystone.document_detect_job', 'UPDATE') THEN
    RAISE EXCEPTION '0694: app_rw is missing a privilege it needs on keystone.document_detect_job';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_detect_job', 'DELETE') THEN
    RAISE EXCEPTION '0694: app_rw must NOT hold DELETE on keystone.document_detect_job';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0694: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows()';
  END IF;
END
$document_detect_job_self_check$;
