-- 0639 · PART 30 item 8 — a `gl_test_` key works on a Docustay workspace.
-- 0171 refused a test key on every practice that is not a sandbox (`sandbox_of IS NULL`), which was right for the CRM and meant a Docustay customer's test key could never authenticate:
-- the route layer already makes a test key's send a practice run (is_test), and Docustay workspaces have no separate sandbox tenant. A Docustay workspace is the tenant row's `product = 'docustay'`.
-- Everything else is unchanged: same arguments, returns only a tenant id, every failure the same empty answer, a test key on a plain Mainstay practice still refused.
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.authorize_api_token(
  p_token_id     text,
  p_secret_hash  bytea,
  p_scope        text,
  p_expect_live  boolean
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.tenant_id
    FROM keystone_auth.api_token t
    JOIN keystone.tenant n ON n.id = t.tenant_id
   WHERE t.token_id   = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.class       = 'secret'
     AND t.revoked_at  IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND (t.environment = CASE WHEN p_expect_live THEN 'live' ELSE 'test' END)
     AND (p_expect_live OR n.sandbox_of IS NOT NULL OR n.product = 'docustay')
     AND (p_scope IS NULL OR p_scope = ANY (t.scopes))
$$;

DO $$
DECLARE
  v_sig constant text := 'keystone.authorize_api_token(text, bytea, text, boolean)';
BEGIN
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_sig::regprocedure)) IS DISTINCT FROM 'auth_owner' THEN RAISE EXCEPTION 'authorize_api_token must stay owned by auth_owner'; END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'app_rw lost EXECUTE on authorize_api_token'; END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can EXECUTE authorize_api_token'; END IF;
  IF has_function_privilege('app_embed', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'app_embed can EXECUTE authorize_api_token'; END IF;
END $$;

SET LOCAL ROLE app_owner;
