-- 0808 — deleting a workspace, the screens' half (26 Oct 2026).
--   · deletion_request.progress: what the progress screen shows while the worker carries a request out ('queued' → 'working'); the request itself disappears with the workspace.
--   · keystone.ended_session: the public ids of the sessions that were ended because their workspace was deleted. A person whose page then answers "signed out" asks this table why, and the login page can say "This workspace was deleted". The ids are not secrets (the secret half is never stored here) and are purged after 30 days.
ALTER TABLE keystone.deletion_request ADD COLUMN IF NOT EXISTS progress text NULL;

CREATE TABLE IF NOT EXISTS keystone.ended_session (
  token_id text PRIMARY KEY CHECK (token_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  reason   text NOT NULL DEFAULT 'workspace_deleted',
  ended_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.ended_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.ended_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ended_session_read ON keystone.ended_session;
CREATE POLICY ended_session_read ON keystone.ended_session FOR SELECT TO app_rw, app_owner USING (true);
DROP POLICY IF EXISTS ended_session_write ON keystone.ended_session;
CREATE POLICY ended_session_write ON keystone.ended_session FOR ALL TO auth_owner USING (true) WITH CHECK (true);
GRANT SELECT ON keystone.ended_session TO app_rw, app_owner;
GRANT SELECT, INSERT, DELETE ON keystone.ended_session TO auth_owner;

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.delete_workspace_credentials(p_tenant uuid, p_uids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT keystone.workspace_deletion_active(p_tenant) THEN
    RAISE EXCEPTION 'workspace credentials are removed only as part of deleting the workspace' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM keystone.ended_session WHERE ended_at < now() - interval '30 days';
  INSERT INTO keystone.ended_session (token_id) SELECT token_id FROM keystone_auth.session WHERE tenant_id = p_tenant ON CONFLICT DO NOTHING;
  DELETE FROM keystone_auth.session        WHERE tenant_id = p_tenant;
  DELETE FROM keystone_auth.api_token      WHERE tenant_id = p_tenant;
  DELETE FROM keystone_auth.webhook_source WHERE tenant_id = p_tenant;
  IF p_uids IS NOT NULL AND cardinality(p_uids) > 0 THEN
    DELETE FROM keystone_auth.email_code        WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.passkey_challenge WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.backup_code       WHERE factor_id IN (SELECT id FROM keystone_auth.totp_factor WHERE firebase_uid = ANY (p_uids));
    DELETE FROM keystone_auth.totp_factor       WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.passkey           WHERE firebase_uid = ANY (p_uids);
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION keystone.delete_workspace_credentials(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.delete_workspace_credentials(uuid, text[]) TO app_owner;
SET LOCAL ROLE app_owner;
