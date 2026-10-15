-- 0046 — creating, revoking and LISTING an api_token. The write side of P19.3/P19.4.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ A CONSEQUENCE ADDENDUM 4 DOES NOT NAME, AND IT HAD TO BE SOLVED RATHER THAN ROUTED AROUND.
--     A4.1 specifies `keystone_auth.api_token` with **no GRANT to app_rw on any table**, and then
--     specifies four RESOLVERS. It does not specify an INSERT path. But a tenant admin creating a key
--     at `/settings/developer/api-keys` arrives as `app_rw` — which, correctly, cannot write this
--     table at all. **So without a definer write path the feature is unbuildable**, and the tempting
--     "fix" is a GRANT INSERT to app_rw, which would hand the credential store to the application
--     role and dissolve the whole argument for the schema existing.
--   ★ Therefore: the write path is SECURITY DEFINER too, and `tenant_id` is taken from
--     `keystone.current_tenant_id()` INSIDE the function — never from a parameter. A caller cannot
--     name the tenant it is writing for, so it cannot mint a key into somebody else's account.
--
-- ★★★ THE RETURN-TYPE RULE AND WHY LISTING IS ALLOWED TO BE WIDER — A DISTINCTION, NOT AN EXCEPTION.
--     The resolvers return a bare `uuid` because they run **BEFORE any tenant exists**: they are
--     handed attacker-controlled input and asked "whose is this?", so anything else in the return
--     shape is a channel out of the credential store.
--     `list_api_tokens` runs **AFTER `withTenant()` has opened.** It is filtered by
--     `current_tenant_id()` inside the function, and it returns **no secret material** — no
--     `secret_hash`, no `token_id`, only the name, the last four characters, the scopes and the
--     timestamps a human needs to manage keys.
--   ★★ THAT IS WHY IT IS NOT IN the catalog gate's CREDENTIAL_RESOLVERS set: that set names the
--      functions on the pre-tenant path, and the narrow-return rule is about them. Every OTHER rule
--      (pinned search_path, no EXECUTE to PUBLIC) still applies here and is still asserted.
--   ★ `secret_hash` and `token_id` are deliberately NOT returned. `token_id` is not secret, but
--     returning it would let a compromised app role enumerate lookup keys, and nothing on the
--     management screen needs it.
--
-- ★★ P19.4 — SHOWN ONCE, NEVER AGAIN. Nothing here can return the secret: the secret is generated in
--    the application, hashed there, and only the digest is passed in. **There is no function in this
--    database that can produce it**, which is a stronger statement than "the route does not return it".

SET LOCAL ROLE auth_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CREATE. Returns the row id and nothing else.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.create_api_token(
  p_environment text,
  p_class       text,
  p_token_id    text,
  p_secret_hash bytea,
  p_last_four   text,
  p_name        text,
  p_scopes      text[],
  p_created_by  uuid DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid;
  v_id     uuid;
BEGIN
  -- ★★★ THE TENANT COMES FROM THE SESSION, NEVER FROM A PARAMETER. This is the single line that
  --     stops one tenant minting a key into another's account, and it is why there is no
  --     `p_tenant_id` argument to get wrong at a call site.
  v_tenant := keystone.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'create_api_token requires tenant context — call it inside withTenant()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO keystone_auth.api_token
    (tenant_id, environment, class, prefix, token_id, secret_hash,
     last_four, name, scopes, created_by, expires_at)
  VALUES
    (v_tenant, p_environment, p_class, 'gl_' || p_environment || '_', p_token_id, p_secret_hash,
     p_last_four, p_name, p_scopes, p_created_by, p_expires_at)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION keystone.create_api_token(text,text,text,bytea,text,text,text[],uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.create_api_token(text,text,text,bytea,text,text,text[],uuid,timestamptz) TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- REVOKE. Idempotent, tenant-scoped, and it cannot un-revoke.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ `revoked_at IS NULL` in the predicate makes this idempotent AND makes un-revoking impossible:
--    a second call matches no row and changes nothing. A revocation that could be lifted by replaying
--    a request is not a revocation.
CREATE FUNCTION keystone.revoke_api_token(p_id uuid, p_revoked_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.api_token
     SET revoked_at = now(), revoked_by = p_revoked_by
   WHERE id = p_id
     AND tenant_id = keystone.current_tenant_id()
     AND revoked_at IS NULL
  RETURNING id
$$;
REVOKE ALL ON FUNCTION keystone.revoke_api_token(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_api_token(uuid, uuid) TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LIST. Post-context, tenant-scoped inside, and carries NO secret material.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.list_api_tokens()
RETURNS TABLE (
  id           uuid,
  environment  text,
  class        text,
  name         text,
  last_four    text,
  scopes       text[],
  created_at   timestamptz,
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, t.environment, t.class, t.name, t.last_four, t.scopes,
         t.created_at, t.expires_at, t.last_used_at, t.revoked_at
    FROM keystone_auth.api_token t
   WHERE t.tenant_id = keystone.current_tenant_id()
   ORDER BY t.created_at DESC
$$;
REVOKE ALL ON FUNCTION keystone.list_api_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.list_api_tokens() TO app_rw;

COMMENT ON FUNCTION keystone.list_api_tokens() IS
  'Lists the calling tenant''s API tokens for the management screen. SECURITY DEFINER because app_rw '
  'has no privilege on keystone_auth.api_token; tenant-scoped INSIDE the function via '
  'current_tenant_id(); returns NO secret material — not secret_hash, not token_id. Runs after '
  'withTenant() has opened, which is why its return type may be wider than a resolver''s: the '
  'narrow-return rule exists for functions on the PRE-tenant path.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The inbound routing table needs the same three, for the same reason.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.create_webhook_source(p_provider text, p_external_id text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid;
  v_id     uuid;
BEGIN
  v_tenant := keystone.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'create_webhook_source requires tenant context — call it inside withTenant()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO keystone_auth.webhook_source (tenant_id, provider, external_id)
  VALUES (v_tenant, p_provider, p_external_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION keystone.create_webhook_source(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.create_webhook_source(text, text) TO app_rw;

-- ★ RETIRE, not delete: the mapping is evidence about where a payload was routed. The partial unique
--   index keys on `WHERE retired_at IS NULL`, so retiring frees the vendor object to be re-claimed
--   without destroying the record that it once belonged to this tenant.
CREATE FUNCTION keystone.retire_webhook_source(p_id uuid)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.webhook_source
     SET retired_at = now()
   WHERE id = p_id AND tenant_id = keystone.current_tenant_id() AND retired_at IS NULL
  RETURNING id
$$;
REVOKE ALL ON FUNCTION keystone.retire_webhook_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.retire_webhook_source(uuid) TO app_rw;

CREATE FUNCTION keystone.list_webhook_sources()
RETURNS TABLE (id uuid, provider text, external_id text, created_at timestamptz, retired_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id, s.provider, s.external_id, s.created_at, s.retired_at
    FROM keystone_auth.webhook_source s
   WHERE s.tenant_id = keystone.current_tenant_id()
   ORDER BY s.created_at DESC
$$;
REVOKE ALL ON FUNCTION keystone.list_webhook_sources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.list_webhook_sources() TO app_rw;

RESET ROLE;
