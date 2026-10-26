-- 0177 — keystone.sessions_for_user: the device list's one read. Stage 6 task 6.5 · CT-026
-- (renamed to schema `keystone` per X6-2).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THERE IS NO LISTER OVER keystone_auth.session TODAY. MEASURED: the table is reached only by
--     resolve_session, create_session and revoke_sessions_for_uid (0020:221,238,255), and app_rw
--     holds zero privileges on it (0020:180-185, asserted by
--     db/gates/catalog-conformance.mjs:606-618). This function is the first read.
--
-- ★★★ IT RETURNS `text` AND `inet`, AND THAT IS DELIBERATE. db/gates/catalog-conformance.mjs's
--     credential-resolver return-type rule (:667-677) would reject this shape — and the answer is
--     NOT to weaken that rule. Task 6.7 adds a new named rule set, SESSION_LISTERS, following the
--     precedent the gate already records at :664-666 for tenant_timezones_for_health and the two
--     platform listers. This function is policed by that new rule set, not by the credential-
--     resolver rule.
--
-- ★★★ NO COLUMN IN THIS RESULT CAN CARRY A CREDENTIAL. token_id, secret_hash, hash_alg and
--     firebase_uid are absent from the SELECT list by construction — they are never named. `id` is
--     the session row's own primary key, not a bearer token, and cannot be presented back to
--     resolve_session, touch_session or revoke_session (those all key on token_id + secret_hash).
--     `is_current` is computed from a token_id the caller already holds (it was presented on this
--     very request to reach this route), so it reveals nothing the caller did not already supply.
--
-- ★ LIVE SESSIONS ONLY: `revoked_at IS NULL AND expires_at > now()`. Production carries 447
--   keystone_auth.session rows, 399 of them orphaned and all of them expired (Q6-6, STAGE-6-PLAN.md
--   §1) — none of those can ever appear through this function.
--
-- ★ SAME TENANT GUARD AS 6.2/6.3/6.4, SAME SUPPLIER: the application's set_config at
--   src/db/index.mjs:111, checked here as `p_tenant_id::text = current_setting('keystone.tenant_id',
--   true)` so a caller cannot list another tenant's rows by passing its uuid even if it somehow held
--   one — the WHERE clause on tenant_id alone is not a substitute for this check, because it is the
--   caller-supplied p_tenant_id being trusted, not a session-scoped fact, without it.
--
-- ★★★ OWNERSHIP. keystone_auth.session is owned by auth_owner, and app_owner holds no USAGE on
--    schema keystone_auth (0020:46-48). This file therefore runs the CREATE, the REVOKE, the GRANT
--    and the COMMENT as auth_owner, exactly as 0020, 0171 and 0175 do, because app_owner is
--    NOINHERIT and a REVOKE issued by the wrong role degrades to a silent warning rather than an
--    error (0121:99-125).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.sessions_for_user(
  p_tenant_id uuid, p_app_user_id uuid, p_current_token_id text)
RETURNS TABLE (
  id            uuid,
  kind          text,
  created_at    timestamptz,
  last_seen_at  timestamptz,
  expires_at    timestamptz,
  user_agent    text,
  ip_first_seen inet,
  is_current    boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.id, s.kind, s.created_at, s.last_seen_at, s.expires_at,
         s.user_agent, s.ip_first_seen,
         (s.token_id = p_current_token_id) AS is_current
    FROM keystone_auth.session s
   WHERE s.tenant_id = p_tenant_id
     AND s.app_user_id = p_app_user_id
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     -- ★ SAME GUARD AS 6.4, SAME SUPPLIER: the application's set_config, src/db/index.mjs:111.
     AND p_tenant_id::text = current_setting('keystone.tenant_id', true)
   ORDER BY coalesce(s.last_seen_at, s.created_at) DESC
$$;

ALTER FUNCTION keystone.sessions_for_user(uuid, uuid, text) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.sessions_for_user(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.sessions_for_user(uuid, uuid, text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.sessions_for_user(uuid, uuid, text) IS
  'Stage 6 / CT-026 — the device list''s one read: a person''s own LIVE sessions in one practice, '
  'newest-active first, the browser asking flagged via is_current. Policed by the SESSION_LISTERS '
  'rule set (6.7), not the credential-resolver rule, because it deliberately returns text/inet for '
  'display — but no column here can carry a credential: token_id, secret_hash, hash_alg and '
  'firebase_uid are never named, and is_current is computed from a token the caller already holds.';

-- ★ Back to the role the runner established before this file. SET LOCAL, not RESET: RESET would land
--   on the connecting superuser (0121:129-135) and every later statement would create objects under it.
SET LOCAL ROLE app_owner;

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS. A REVOKE that degraded to a
--    warning, an owner mismatch, or a result shape that grew a credential column would each apply
--    "cleanly" and leave the device list leaking something it must not.
DO $$
DECLARE
  v_sig constant text := 'keystone.sessions_for_user(uuid, uuid, text)';
  v_owner  text;
  v_result text;
BEGIN
  SELECT pg_get_userbyid(p.proowner), pg_get_function_result(p.oid)
    INTO v_owner, v_result
    FROM pg_proc p
   WHERE p.oid = v_sig::regprocedure;

  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'sessions_for_user is owned by %, must be auth_owner (an app_owner-owned definer is still filtered by FORCE — 0008:8-16)', v_owner;
  END IF;
  IF v_result ~* '(secret|hash|token_id|pepper|firebase)' THEN
    RAISE EXCEPTION 'sessions_for_user''s result shape (%) names a credential-shaped column — the device list must never carry one', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE sessions_for_user — the device list route would fail';
  END IF;
  IF NOT has_function_privilege('app_owner', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_owner cannot EXECUTE sessions_for_user';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE sessions_for_user — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
END $$;
