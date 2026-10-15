-- 0419_document_ai_and_pdf_import — Stage 14 task 14.12 · CT-F52 (both tables)
--
-- A record of each AI draft/check (hash, never content) and each PDF import's detected fields.
-- ★★★ PRIVACY BOUNDARY: this table holds what people send to an OUTSIDE model. It stores a
-- prompt HASH, never prompt text or response body — no "prompt text"/"response body" column
-- exists here, on purpose. The blocked list (DOB, sobriety date, recovery fields, notes,
-- emergency contact, consent detail, guardian relationship) never leaves the platform, not even
-- in metadata, and nothing in this table's column list could carry it.
--
-- keystone.document_ai_request (§0.4 A, append-only, app_rw SELECT/INSERT) — same append-only
-- shape as keystone.loyalty_entry (0414): no updated_at column, no touch trigger, no
-- tenant_update/tenant_delete policy, no UPDATE/DELETE grant. A usage/audit row is never edited.
--
-- keystone.document_pdf_import (§0.4 A) — the original PDF IS kept (R-14.12): the browser PUTs it
-- straight to storage through 14.77's presigned URL and the bytes never pass through the
-- application, so s3_key just names the object. No delete path is named for this table, so (as
-- with keystone.loyalty_rule/loyalty_reward, 0414) app_rw gets SELECT, INSERT, UPDATE only — no
-- DELETE, no tenant_delete policy.
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, applied to BOTH tables.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.document_ai_request
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.document_ai_request (
  id             uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  kind           text        NOT NULL CHECK (kind IN ('draft','check')),
  template_id    uuid        NULL REFERENCES keystone.document_template(id) ON DELETE SET NULL,
  prompt_sha256  text        NOT NULL CHECK (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  input_tokens   integer     NULL,
  output_tokens  integer     NULL,
  outcome        text        NOT NULL CHECK (outcome IN ('ok','refused','failed','not_configured')),
  requested_by   uuid        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_ai_request_requested_by_fkey FOREIGN KEY (tenant_id, requested_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (requested_by)
);
CREATE INDEX document_ai_request_tenant_created_idx ON keystone.document_ai_request (tenant_id, created_at);

ALTER TABLE keystone.document_ai_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_ai_request FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_ai_request USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_ai_request FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ No tenant_update, no tenant_delete: append-only usage/audit row (header).
CREATE POLICY reference_guard_read ON keystone.document_ai_request FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- CT-F52 point 4 — SELECT, INSERT ONLY. No UPDATE, no DELETE. A usage/audit row is never edited.
GRANT SELECT, INSERT ON keystone.document_ai_request TO app_rw;
GRANT SELECT ON keystone.document_ai_request TO reference_guard;

-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers, each ENABLE ALWAYS. The lend/give-back.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_ai_request_refuse_reference_delete_trg AFTER DELETE ON keystone.document_ai_request
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_request ENABLE ALWAYS TRIGGER document_ai_request_refuse_reference_delete_trg;
CREATE TRIGGER document_ai_request_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_ai_request
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_request ENABLE ALWAYS TRIGGER document_ai_request_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

COMMENT ON TABLE keystone.document_ai_request IS '14.12 — a record of each AI draft/check: prompt HASH, never content. Append-only (no updated_at, no touch trigger); app_rw SELECT/INSERT only.';

-- CT-F52 point 6 — the closing self-check, WITH ITS POSITIVE CONTROL INSIDE THE SQL (0408/0414's template).
DO $document_ai_request_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_ai_request'::regclass) THEN
    RAISE EXCEPTION '0419: keystone.document_ai_request does not have FORCE ROW LEVEL SECURITY';
  END IF;

  -- ★ Exactly three named policies — NO tenant_update, NO tenant_delete (append-only).
  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.document_ai_request'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'reference_guard_read');
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION '0419: keystone.document_ai_request does not carry exactly the three expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='document_ai_request' AND policyname IN ('tenant_update','tenant_delete')) THEN
    RAISE EXCEPTION '0419: document_ai_request must not carry a tenant_update or tenant_delete policy — it is append-only';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.document_ai_request'::regclass
     AND tgname IN ('document_ai_request_refuse_reference_delete_trg', 'document_ai_request_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0419: keystone.document_ai_request does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.document_ai_request'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0419: reference_guard_read on keystone.document_ai_request is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.document_ai_request', 'SELECT') THEN
    RAISE EXCEPTION '0419: app_rw is missing SELECT on keystone.document_ai_request';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_ai_request', 'INSERT') THEN
    RAISE EXCEPTION '0419: app_rw is missing INSERT on keystone.document_ai_request';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_ai_request', 'UPDATE') THEN
    RAISE EXCEPTION '0419: app_rw must NOT hold UPDATE on keystone.document_ai_request — it is append-only';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_ai_request', 'DELETE') THEN
    RAISE EXCEPTION '0419: app_rw must NOT hold DELETE on keystone.document_ai_request — it is append-only';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.document_ai_request', 'SELECT') THEN
    RAISE EXCEPTION '0419: reference_guard is missing SELECT on keystone.document_ai_request';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0419: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the document_ai_request lend was not revoked';
  END IF;
END
$document_ai_request_ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — keystone.document_pdf_import
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.document_pdf_import (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  file_name         text        NOT NULL,
  page_count        integer     NOT NULL CHECK (page_count > 0),
  text_sha256       text        NOT NULL,
  detected_fields   jsonb       NOT NULL DEFAULT '[]',
  confirmed_fields  jsonb       NULL,
  state             text        NOT NULL DEFAULT 'detected' CHECK (state IN ('detected','confirmed','abandoned')),
  template_id       uuid        NULL REFERENCES keystone.document_template(id) ON DELETE SET NULL,
  created_by        uuid        NULL,
  -- ★ R-14.12: the original PDF IS kept — the browser PUTs it straight to storage through 14.77's
  -- presigned URL and the bytes never pass through the application.
  s3_key            text        NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_pdf_import_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX document_pdf_import_tenant_id_key ON keystone.document_pdf_import (tenant_id, id);
-- ★ Two imports may not claim the same s3_key in one practice; the same key in another practice
-- is allowed (tenant-leading partial unique index, per field 8's own two-sided check).
CREATE UNIQUE INDEX document_pdf_import_tenant_s3_key_key ON keystone.document_pdf_import (tenant_id, s3_key) WHERE s3_key IS NOT NULL;
CREATE INDEX document_pdf_import_tenant_created_idx ON keystone.document_pdf_import (tenant_id, created_at);

ALTER TABLE keystone.document_pdf_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_pdf_import FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_pdf_import USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_pdf_import FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_pdf_import FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                                WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ No tenant_delete: no delete path is named for this table (header) — an import is confirmed
-- or abandoned, never deleted, same "toggled, never deleted" shape as keystone.loyalty_rule (0414).
CREATE POLICY reference_guard_read ON keystone.document_pdf_import FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- CT-F52 point 4 — no delete path this stage (see header): SELECT, INSERT, UPDATE only.
GRANT SELECT, INSERT, UPDATE ON keystone.document_pdf_import TO app_rw;
GRANT SELECT ON keystone.document_pdf_import TO reference_guard;

-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers, each ENABLE ALWAYS. The lend/give-back.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_pdf_import_refuse_reference_delete_trg AFTER DELETE ON keystone.document_pdf_import
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_pdf_import ENABLE ALWAYS TRIGGER document_pdf_import_refuse_reference_delete_trg;
CREATE TRIGGER document_pdf_import_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_pdf_import
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_pdf_import ENABLE ALWAYS TRIGGER document_pdf_import_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- §0.4 A base shape's touch trigger (updated_at) — document_pdf_import is not append-only:
-- confirmed_fields/state are set after the row is first written.
CREATE TRIGGER document_pdf_import_touch BEFORE UPDATE ON keystone.document_pdf_import
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

COMMENT ON TABLE keystone.document_pdf_import IS '14.12 — a PDF import''s detected fields. The original PDF is kept: the browser PUTs it straight to 14.77''s presigned URL, so s3_key names the object (R-14.12). No delete path: an import is confirmed or abandoned, never deleted.';

-- CT-F52 point 6 — the closing self-check, WITH ITS POSITIVE CONTROL INSIDE THE SQL (0408/0414's template).
DO $document_pdf_import_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_pdf_import'::regclass) THEN
    RAISE EXCEPTION '0419: keystone.document_pdf_import does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.document_pdf_import'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0419: keystone.document_pdf_import does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='document_pdf_import' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0419: document_pdf_import has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.document_pdf_import'::regclass
     AND tgname IN ('document_pdf_import_refuse_reference_delete_trg', 'document_pdf_import_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0419: keystone.document_pdf_import does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'keystone.document_pdf_import'::regclass
                    AND tgname = 'document_pdf_import_touch' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0419: keystone.document_pdf_import is missing its enabled document_pdf_import_touch trigger';
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.document_pdf_import'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0419: reference_guard_read on keystone.document_pdf_import is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.document_pdf_import', 'SELECT') THEN
    RAISE EXCEPTION '0419: app_rw is missing SELECT on keystone.document_pdf_import';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_pdf_import', 'INSERT') THEN
    RAISE EXCEPTION '0419: app_rw is missing INSERT on keystone.document_pdf_import';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_pdf_import', 'UPDATE') THEN
    RAISE EXCEPTION '0419: app_rw is missing UPDATE on keystone.document_pdf_import';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_pdf_import', 'DELETE') THEN
    RAISE EXCEPTION '0419: app_rw must NOT hold DELETE on keystone.document_pdf_import — an import is confirmed or abandoned, never deleted';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.document_pdf_import', 'SELECT') THEN
    RAISE EXCEPTION '0419: reference_guard is missing SELECT on keystone.document_pdf_import';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0419: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the document_pdf_import lend was not revoked';
  END IF;
END
$document_pdf_import_ct_f52_self_check$;

-- Written, not applied.
