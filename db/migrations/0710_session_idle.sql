-- 0710 · Run 7 part 6: automatic sign-out after a period without activity. keystone.session_idle_seconds tells the request path how long a live session has gone unseen (seconds since
-- last_seen_at, else since it was created), so a workspace's idle limit can end it. Same ownership and grant pattern as touch_session (0175): auth_owner owns the table, app_owner holds no
-- USAGE on keystone_auth, so the function is created, revoked and granted AS auth_owner. Returns an identifier-free integer; NULL for a session that is not live.
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.session_idle_seconds(p_token_id text, p_secret_hash bytea)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT floor(extract(epoch FROM now() - COALESCE(s.last_seen_at, s.created_at)))::integer
    FROM keystone_auth.session s
   WHERE s.token_id = p_token_id AND s.secret_hash = p_secret_hash AND s.revoked_at IS NULL AND s.expires_at > now()
$$;

ALTER FUNCTION keystone.session_idle_seconds(text, bytea) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.session_idle_seconds(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.session_idle_seconds(text, bytea) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.session_idle_seconds(text, bytea) IS 'Run 7 part 6 — seconds a live session has gone without a request (last_seen_at, else created_at); the idle sign-out reads it.';

RESET ROLE;
DO $$
DECLARE v_sig text := 'keystone.session_idle_seconds(text, bytea)';
BEGIN
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'app_rw cannot EXECUTE session_idle_seconds'; END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can EXECUTE session_idle_seconds — the REVOKE degraded to a warning'; END IF;
END $$;
