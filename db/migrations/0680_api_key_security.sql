-- 0680 · API key security (Final Push FP-F2/F3/F4, 7 Oct 2026). Additive.
--   · ip_allowlist: optional CIDR ranges a key may be used from (empty/NULL = anywhere)
--   · last_used_agent: the caller's user agent on the key's most recent use (last_used_at and last_used_ip already existed; nothing ever wrote them)
--   · warned_14_at / warned_3_at: when the expiry warning emails went out, so each goes once
-- Every function is tenant-scoped INSIDE (current_tenant_id()), SECURITY DEFINER because app_rw has no privilege on keystone_auth.api_token, and returns nothing secret.
-- Role handling as in 0046/0201: the table and every definer over it belong to auth_owner; the role is handed back explicitly (never RESET ROLE).
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.api_token
  ADD COLUMN IF NOT EXISTS ip_allowlist    text[]      NULL CHECK (ip_allowlist IS NULL OR cardinality(ip_allowlist) <= 20),
  ADD COLUMN IF NOT EXISTS last_used_agent text        NULL CHECK (last_used_agent IS NULL OR char_length(last_used_agent) <= 200),
  ADD COLUMN IF NOT EXISTS warned_14_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS warned_3_at     timestamptz NULL;

CREATE FUNCTION keystone.list_api_token_details()
RETURNS TABLE (id uuid, token_id text, last_used_ip text, last_used_agent text, ip_allowlist text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, t.token_id, host(t.last_used_ip), t.last_used_agent, t.ip_allowlist
    FROM keystone_auth.api_token t WHERE t.tenant_id = keystone.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION keystone.list_api_token_details() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.list_api_token_details() TO app_rw;

CREATE FUNCTION keystone.set_api_token_allowlist(p_id uuid, p_list text[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH u AS (UPDATE keystone_auth.api_token SET ip_allowlist = NULLIF(p_list, '{}') WHERE id = p_id AND tenant_id = keystone.current_tenant_id() RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
REVOKE ALL ON FUNCTION keystone.set_api_token_allowlist(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.set_api_token_allowlist(uuid, text[]) TO app_rw;

-- Read at the moment a key is used: the ranges it may be used from, and when it expires (for the warning).
CREATE FUNCTION keystone.api_token_gate(p_token_id text)
RETURNS TABLE (id uuid, name text, ip_allowlist text[], expires_at timestamptz, created_by uuid, warned_14_at timestamptz, warned_3_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, t.name, t.ip_allowlist, t.expires_at, t.created_by, t.warned_14_at, t.warned_3_at
    FROM keystone_auth.api_token t WHERE t.token_id = p_token_id AND t.tenant_id = keystone.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION keystone.api_token_gate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.api_token_gate(text) TO app_rw;

-- Note a use. Throttled to one write a minute per key unless the address or agent changed, so a busy key does not turn every call into a write.
CREATE FUNCTION keystone.record_api_token_use(p_token_id text, p_ip text, p_agent text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.api_token
     SET last_used_at = now(), last_used_ip = COALESCE(NULLIF(p_ip, '')::inet, last_used_ip), last_used_agent = COALESCE(left(p_agent, 200), last_used_agent)
   WHERE token_id = p_token_id AND tenant_id = keystone.current_tenant_id()
     AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute' OR last_used_ip IS DISTINCT FROM NULLIF(p_ip, '')::inet OR last_used_agent IS DISTINCT FROM left(p_agent, 200))
$$;
REVOKE ALL ON FUNCTION keystone.record_api_token_use(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.record_api_token_use(text, text, text) TO app_rw;

CREATE FUNCTION keystone.mark_api_token_warned(p_id uuid, p_stage integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.api_token
     SET warned_14_at = CASE WHEN p_stage = 14 THEN now() ELSE warned_14_at END, warned_3_at = CASE WHEN p_stage = 3 THEN now() ELSE warned_3_at END
   WHERE id = p_id AND tenant_id = keystone.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION keystone.mark_api_token_warned(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.mark_api_token_warned(uuid, integer) TO app_rw;

SET ROLE app_owner;
