-- 0698 · DELETION REQUESTS (Round 3, 10 Oct 2026). Account and workspace deletion get the shape the industry settled on: a REQUEST, a cooling-off period the person can cancel in, then a purge by the worker.
-- Additive. One tenant-scoped table, one platform-level record kind, one definer function that writes it. Design: specs/proofs/stage-t/run5/DELETION-DESIGN.md.
--   · keystone.deletion_request — kind 'account' | 'workspace'; at most one pending request per (workspace, kind, subject). No DELETE for the application (history stays until the workspace itself goes, 0695).
--   · keystone_meta.platform_event learns 'account.deleted' — the minimal proof that a person's account was erased: a SHA-256 of the lower-cased address, the workspace id and the request id. No name, no address.
--   · keystone.record_account_deletion() — SECURITY DEFINER, writes exactly that one event; the only way an ordinary session can add to platform_event.
CREATE TABLE keystone.deletion_request (
  id              uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('account', 'workspace')),
  subject_user_id uuid        NULL,
  requested_by    uuid        NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  scheduled_for   timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'running', 'done', 'failed')),
  cancelled_at    timestamptz NULL,
  cancelled_by    uuid        NULL,
  reminder_sent_at timestamptz NULL,
  finished_at     timestamptz NULL,
  attempts        integer     NOT NULL DEFAULT 0,
  failure         text        NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deletion_request_subject_ck CHECK ((kind = 'account') = (subject_user_id IS NOT NULL)),
  CONSTRAINT deletion_request_after_request_ck CHECK (scheduled_for >= requested_at)
);
CREATE UNIQUE INDEX deletion_request_one_pending_key ON keystone.deletion_request (tenant_id, kind, coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status IN ('pending', 'running');
CREATE INDEX deletion_request_due_idx ON keystone.deletion_request (scheduled_for) WHERE status = 'pending';
CREATE INDEX deletion_request_tenant_idx ON keystone.deletion_request (tenant_id, requested_at);

ALTER TABLE keystone.deletion_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.deletion_request FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.deletion_request USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.deletion_request FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.deletion_request FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                                WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.deletion_request FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
CREATE POLICY workspace_deletion ON keystone.deletion_request FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));

GRANT SELECT, INSERT, UPDATE ON keystone.deletion_request TO app_rw;
GRANT SELECT ON keystone.deletion_request TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER deletion_request_refuse_reference_delete_trg AFTER DELETE ON keystone.deletion_request
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.deletion_request ENABLE ALWAYS TRIGGER deletion_request_refuse_reference_delete_trg;
CREATE TRIGGER deletion_request_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.deletion_request
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.deletion_request ENABLE ALWAYS TRIGGER deletion_request_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER deletion_request_touch BEFORE UPDATE ON keystone.deletion_request
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

COMMENT ON TABLE keystone.deletion_request IS '0698 — a request to delete one person''s account or a whole workspace: pending for a cooling-off period the person can cancel in, then run by the worker. Rows are history and are never deleted by the application.';

ALTER TABLE keystone_meta.platform_event DROP CONSTRAINT platform_event_kind_check;
ALTER TABLE keystone_meta.platform_event ADD CONSTRAINT platform_event_kind_check CHECK (kind = ANY (ARRAY['health.check_failed','health.check_recovered','backup.verified','backup.failed','job.gave_up','job.reaper_stopped','workspace.deleted','account.deleted']));

CREATE OR REPLACE FUNCTION keystone.record_account_deletion(p_request uuid, p_email_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_tenant text := current_setting('keystone.tenant_id', true); v_r keystone.deletion_request%ROWTYPE;
BEGIN
  IF p_email_hash IS NULL OR p_email_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'an account deletion is recorded with the SHA-256 of the address, nothing else' USING ERRCODE = 'invalid_parameter_value'; END IF;
  SELECT * INTO v_r FROM keystone.deletion_request WHERE id = p_request AND tenant_id::text = v_tenant AND kind = 'account';
  IF NOT FOUND THEN RAISE EXCEPTION 'no such account deletion request in this workspace' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO keystone_meta.platform_event (kind, subject, facts) VALUES ('account.deleted', p_email_hash, jsonb_build_object('tenant_id', v_r.tenant_id, 'request_id', v_r.id, 'requested_at', v_r.requested_at));
END
$fn$;
REVOKE ALL ON FUNCTION keystone.record_account_deletion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.record_account_deletion(uuid, text) TO app_rw;

DO $deletion_request_self_check$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.deletion_request'::regclass) THEN RAISE EXCEPTION '0698: keystone.deletion_request does not have FORCE ROW LEVEL SECURITY'; END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'keystone.deletion_request'::regclass AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read', 'workspace_deletion')) <> 5 THEN RAISE EXCEPTION '0698: keystone.deletion_request does not carry exactly the five expected policies'; END IF;
  IF has_table_privilege('app_rw', 'keystone.deletion_request', 'DELETE') THEN RAISE EXCEPTION '0698: app_rw must NOT hold DELETE on keystone.deletion_request'; END IF;
  IF has_function_privilege('public', 'keystone.record_account_deletion(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION '0698: record_account_deletion must not be executable by PUBLIC'; END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN RAISE EXCEPTION '0698: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows()'; END IF;
END
$deletion_request_self_check$;
