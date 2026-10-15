-- 0679 · The API-call log (Final Push FP-C2, 7 Oct 2026). Additive. One row per AUTHENTICATED developer API call: when, which key, what, how it went, how long, and the request id for lookup.
-- Never a body, never a header, never a secret. Kept 30 days (purged as new rows arrive, see src/developer/callLog.mjs).
CREATE TABLE keystone.api_call_log (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  at          timestamptz NOT NULL DEFAULT now(),
  token_id    text        NULL CHECK (token_id IS NULL OR char_length(token_id) <= 40),
  key_name    text        NULL CHECK (key_name IS NULL OR char_length(key_name) <= 120),
  method      text        NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  path        text        NOT NULL CHECK (char_length(path) <= 300),
  status      integer     NOT NULL CHECK (status BETWEEN 100 AND 599),
  duration_ms integer     NOT NULL CHECK (duration_ms >= 0),
  request_id  text        NULL CHECK (request_id IS NULL OR char_length(request_id) <= 80),
  ip          text        NULL CHECK (ip IS NULL OR char_length(ip) <= 64)
);
CREATE INDEX api_call_log_recent_idx  ON keystone.api_call_log (tenant_id, at DESC, id DESC);
CREATE INDEX api_call_log_request_idx ON keystone.api_call_log (tenant_id, request_id) WHERE request_id IS NOT NULL;

ALTER TABLE keystone.api_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.api_call_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.api_call_log USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.api_call_log FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.api_call_log FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.api_call_log FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, DELETE ON keystone.api_call_log TO app_rw;
GRANT SELECT ON keystone.api_call_log TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER api_call_log_refuse_reference_delete_trg AFTER DELETE ON keystone.api_call_log
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.api_call_log ENABLE ALWAYS TRIGGER api_call_log_refuse_reference_delete_trg;
CREATE TRIGGER api_call_log_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.api_call_log
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.api_call_log ENABLE ALWAYS TRIGGER api_call_log_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- Role handling as in 0046/0201: `keystone_auth.api_token` belongs to auth_owner, and a SECURITY DEFINER over it must be CREATED AS auth_owner; the role is handed back explicitly (never RESET ROLE).
SET LOCAL ROLE auth_owner;

-- The name a key was given, for the log row. SECURITY DEFINER because app_rw has no privilege on keystone_auth.api_token; tenant-scoped INSIDE the function; returns the NAME only, never anything secret.
CREATE FUNCTION keystone.api_key_name(p_token_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.name FROM keystone_auth.api_token t WHERE t.token_id = p_token_id AND t.tenant_id = keystone.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION keystone.api_key_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.api_key_name(text) TO app_rw;

SET ROLE app_owner;
