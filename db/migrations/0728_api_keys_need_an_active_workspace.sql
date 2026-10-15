-- 0728 — an API key opens only a workspace that is ACTIVE.  (Run 9 Part 5 — found by the S3 sweep: the sweep's keys worked on a workspace whose status was `suspended`.)
--
-- `keystone.authorize_api_token` (0171, widened by 0639) joined `keystone.tenant` for the sandbox test but never read `tenant.status`; `keystone.resolve_publishable_key` (0045) did not join the
-- tenant at all. So a SUSPENDED workspace (a platform action) and a CLOSED one (the Owner cancelled: `settings.mjs` sets `status = 'closed'`, "read-only for 90 days") kept every secret and
-- publishable key it had: a cancelled customer's integration could still send documents and mail, and a suspended workspace stayed fully reachable from outside by key, while sign-in already
-- refused both ("this account has no workspace yet"). Both functions now answer "no row" unless the workspace is `active` — the same single empty answer as every other refusal (an unknown key, a
-- revoked one, a wrong scope are indistinguishable from a closed workspace, so this adds no oracle).
-- Same bodies as before otherwise; CREATE OR REPLACE keeps the owner (auth_owner) and every grant (app_rw on the first, app_embed on the second), and the checks below prove it before commit.

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
     AND n.status = 'active'
$$;

CREATE OR REPLACE FUNCTION keystone.resolve_publishable_key(p_token_id text, p_secret_hash bytea)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.tenant_id FROM keystone_auth.api_token t
    JOIN keystone.tenant n ON n.id = t.tenant_id
   WHERE t.token_id = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.class = 'publishable'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND n.status = 'active'
$$;

DO $$
DECLARE
  a constant text := 'keystone.authorize_api_token(text, bytea, text, boolean)';
  p constant text := 'keystone.resolve_publishable_key(text, bytea)';
BEGIN
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = a::regprocedure)) IS DISTINCT FROM 'auth_owner' THEN RAISE EXCEPTION 'authorize_api_token must stay owned by auth_owner'; END IF;
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = p::regprocedure)) IS DISTINCT FROM 'auth_owner' THEN RAISE EXCEPTION 'resolve_publishable_key must stay owned by auth_owner'; END IF;
  IF NOT has_function_privilege('app_rw', a, 'EXECUTE') THEN RAISE EXCEPTION 'app_rw lost EXECUTE on authorize_api_token'; END IF;
  IF has_function_privilege('public', a, 'EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can EXECUTE authorize_api_token'; END IF;
  IF has_function_privilege('app_embed', a, 'EXECUTE') THEN RAISE EXCEPTION 'app_embed can EXECUTE authorize_api_token'; END IF;
  IF NOT has_function_privilege('app_embed', p, 'EXECUTE') THEN RAISE EXCEPTION 'app_embed lost EXECUTE on resolve_publishable_key — every embed would fail'; END IF;
  IF has_function_privilege('public', p, 'EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can EXECUTE resolve_publishable_key'; END IF;
END $$;

SET LOCAL ROLE app_owner;
