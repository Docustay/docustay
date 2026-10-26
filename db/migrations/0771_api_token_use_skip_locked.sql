-- 0771 — noting a key's last use never waits on another request (R13-D249, 23 Oct 2026).
-- record_api_token_use (0680) ran a plain UPDATE of the key's row inside the request's transaction. Postgres makes an UPDATE wait for a
-- row another transaction holds even when the WHERE would then skip it, so while one slow request on a key (a webhook test to a slow
-- receiver, a signed PDF) held the row, every other call on the same key waited, and after lock_timeout (15 s) answered 500
-- "canceling statement due to lock timeout" (beta, 06:10 to 06:33 UTC: deliveries, webhooks, templates, signed.pdf, embed-session).
-- Last use is a note, not a guard: when another transaction holds the row, that transaction is recording the same use, so skip it.
-- The function belongs to auth_owner (0680), so it is replaced as auth_owner and the role is handed back the same way 0680 does it.
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.record_api_token_use(p_token_id text, p_ip text, p_agent text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.api_token
     SET last_used_at = now(), last_used_ip = COALESCE(NULLIF(p_ip, '')::inet, last_used_ip), last_used_agent = COALESCE(left(p_agent, 200), last_used_agent)
   WHERE id = (
     SELECT t.id FROM keystone_auth.api_token t
      WHERE t.token_id = p_token_id AND t.tenant_id = keystone.current_tenant_id()
        AND (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute' OR t.last_used_ip IS DISTINCT FROM NULLIF(p_ip, '')::inet OR t.last_used_agent IS DISTINCT FROM left(p_agent, 200))
      FOR UPDATE SKIP LOCKED)
$$;
REVOKE ALL ON FUNCTION keystone.record_api_token_use(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.record_api_token_use(text, text, text) TO app_rw;

SET ROLE app_owner;
