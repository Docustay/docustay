-- 0171 — keystone.authorize_api_token: a bearer token's tenant, environment and scope, in ONE call that
-- can only ever hand an identifier back.  Stage 5 task 5.8 · CT-090 · built against CCR-6 · Q0-9, Q0-10.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ A NEW FUNCTION, NOT A WIDER `resolve_api_token`. 0045:150-166 argues that `RETURNS uuid` IS the
--     safety property — "there is no shape in which a token name, a hash, or another tenant's row can
--     travel back to app_rw" — and db/gates/catalog-conformance.mjs:668 enforces it as
--     `/\b(text|bytea|jsonb|json|varchar|char|name)\b/i` on a credential resolver's return type.
--     Returning `environment text` or `scopes text[]` would break that invariant, and the rule is not
--     to be weakened to fit a contract. So the SCOPE AND THE ENVIRONMENT GO IN, and only a tenant id
--     comes out: a yes/no question answered with an identifier.
--   ★ `keystone.resolve_api_token` is NOT touched by this file — no CREATE OR REPLACE, no ALTER, no
--     REVOKE, no GRANT. test/s5_token_authorization.test.mjs (f) asserts that its body is still 0045's.
--
-- ★★ EVERY FAILURE IS THE SAME ANSWER. Unknown token, wrong secret, revoked, expired, wrong class, a
--    live/test prefix that disagrees with the row, a test key on a practice that is not a sandbox, a
--    scope the key does not hold — all of them are "no row". A caller that could tell them apart could
--    enumerate which keys exist and what they hold.
--
-- ★★★ THE ENVIRONMENT IS LOAD-BEARING FROM HERE (Q0-10). `p_expect_live` is read by the application
--    from the presented string's own prefix (`gl_live_` = true, `gl_test_` = false). The row's
--    `environment` must agree with it, and a test key is refused outright on any practice whose
--    `sandbox_of` is NULL — so until Stage 9 gives sandboxes a way to be created, a test key opens
--    nothing at all. A LIVE key on a sandbox practice is allowed: it is that practice's own key.
--
-- ★★★ OWNERSHIP, AND WHY THIS FILE SAYS `SET LOCAL ROLE auth_owner` BEFORE THE CREATE.
--     The function must be OWNED by `auth_owner` — the credential store is in schema `keystone_auth`,
--     owned by auth_owner, and `app_owner` holds NO USAGE on that schema (0020:64-69 grants it to
--     auth_owner and app_rw only), so a function created by app_owner cannot even name
--     `keystone_auth.api_token` in its body. Creating it AS auth_owner is what 0045 and 0046 do.
--   ★★ And the REVOKE/GRANT must be issued by the OWNER. app_owner is NOINHERIT: once ownership
--      belongs to auth_owner and the session is back on app_owner, a REVOKE degrades to a WARNING
--      ("no privileges could be revoked") that psql does not treat as an error, and the function is
--      left EXECUTE-able by PUBLIC (0121:99-125, MEASURED). This file therefore stays as auth_owner
--      through the REVOKE, the GRANT and the COMMENT, and asserts the outcome before it ends.
--   ★ `keystone.tenant` is readable by auth_owner through `tenant_health_read` (0017:54-57, SELECT
--     only) — the same reason `keystone.resolve_login_branding_by_slug` and `platform_list_tenants`
--     work. This function only reads it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.authorize_api_token(
  p_token_id     text,
  p_secret_hash  bytea,
  p_scope        text,       -- NULL means "no scope required" (e.g. whoami)
  p_expect_live  boolean     -- from the presented prefix: gl_live_ = true, gl_test_ = false
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
     -- Q0-10: the environment in the presented prefix must match the row's…
     AND (t.environment = CASE WHEN p_expect_live THEN 'live' ELSE 'test' END)
     -- …and a test key is refused outright on a practice that is not a sandbox.
     AND (p_expect_live OR n.sandbox_of IS NOT NULL)
     AND (p_scope IS NULL OR p_scope = ANY (t.scopes))
$$;

ALTER FUNCTION keystone.authorize_api_token(text, bytea, text, boolean) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.authorize_api_token(text, bytea, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.authorize_api_token(text, bytea, text, boolean) TO app_rw;

COMMENT ON FUNCTION keystone.authorize_api_token(text, bytea, text, boolean) IS
  'Stage 5 / CT-090 — a bearer token''s tenant, environment and scope in one call. The scope and the '
  'live/test expectation travel IN; a tenant id (uuid) or NOTHING comes OUT, so the return type stays '
  'the safety argument (0045:150-154, catalog-conformance :668). Every failure — unknown, wrong '
  'secret, revoked, expired, wrong class, environment mismatch, a test key on a non-sandbox practice, '
  'a scope not held — is the same empty answer. resolve_api_token is deliberately left as it was.';

-- ★ Back to the role the runner established before this file. SET LOCAL, not RESET: RESET would land
--   on the connecting superuser (0121:129-135) and every later statement would create objects under it.
SET LOCAL ROLE app_owner;

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS. A REVOKE that degraded to a
--    warning, or an ACL rewritten by an owner change, applies "cleanly" and leaves a credential
--    resolver callable by every role in the cluster — including app_embed (P19.8).
DO $$
DECLARE
  v_sig constant text := 'keystone.authorize_api_token(text, bytea, text, boolean)';
  v_owner text;
  v_result text;
BEGIN
  SELECT pg_get_userbyid(p.proowner), pg_get_function_result(p.oid)
    INTO v_owner, v_result
    FROM pg_proc p
   WHERE p.oid = v_sig::regprocedure;

  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'authorize_api_token is owned by %, must be auth_owner (an app_owner-owned definer is still filtered by FORCE — 0008:8-16)', v_owner;
  END IF;
  IF v_result IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'authorize_api_token returns %, must be uuid — the return type IS the safety argument', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE authorize_api_token — every bearer request would fail';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE authorize_api_token — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
  IF has_function_privilege('app_embed', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_embed can EXECUTE authorize_api_token — the publishable-key role must not reach the secret-key resolver (P19.8)';
  END IF;
END $$;
