-- 0176_revoke_session
-- Stage 6 task 6.4 — CT-025 (plus X6-5's by-id variant): three ways to end a session, each scoped
-- to who is asking.
--
-- The one revoke that exists today, keystone.revoke_sessions_for_uid (0020:255-267), is by
-- firebase_uid and therefore across every practice; its only live caller is
-- src/records/archive.mjs:157. It is UNCHANGED and stays granted, stays called. This migration adds
-- three functions beside it, all returning integer (the count of rows revoked), identifier-free like
-- the existing revoke:
--   * keystone.revoke_session_by_token — LOGOUT. By token, because that is what the browser
--     presents; revokes exactly one row.
--   * keystone.revoke_session_by_id — "remove this device". By session id, scoped to the asking
--     person and the transaction's tenant.
--   * keystone.revoke_sessions_for_user — "sign out everywhere", PRACTICE-SCOPED (spec 04 §3
--     default 5). p_except_token_id lets the screen keep the session that asked.
--
-- ★★★ THE TENANT GUARD, AND WHO SUPPLIES IT. revoke_session_by_id and revoke_sessions_for_user take
--     a p_tenant_id and refuse unless it equals the transaction's tenant GUC. That GUC is issued by
--     the application on every browser request — src/db/index.mjs:111,
--     set_config('keystone.tenant_id', $1, true) — so the condition has an application supplier, not
--     a test one.
-- ★ The user argument is deliberately NOT checked against current_setting('keystone.user_id'):
--   Stage 7's role change revokes a target's sessions with an actor's context, so actor <> target is
--   a legitimate shape. The route-level check that a caller may only act on themselves lives in 6.12.
--
-- ★ Every new function sets revoked_at and revoked_reason together, which is what the
--   session_revocation_shape CHECK (0020:143-145) requires. The reasons these functions will be
--   called with — logout, device_removed, admin, role_changed — all exist only because 0173 widened
--   the revoked_reason CHECK; 0176 runs after 0173 by number.
-- ★ keystone_auth.session is OWNED BY auth_owner (0020:53, `SET LOCAL ROLE auth_owner` before the
--   CREATE TABLE), and this file runs as app_owner (db/migrate.mjs per-file `SET ROLE app_owner`), a
--   NOINHERIT member of auth_owner (0132 header). CREATE FUNCTION needs ownership, so the role is
--   switched exactly as 0167/0173 do and put back explicitly — NOT `RESET ROLE`, the session-level
--   reset that caused F482 (db/migrate.mjs:301-316).
SET LOCAL ROLE auth_owner;

-- ★ LOGOUT. By token, because that is what the browser presents, and it revokes exactly one row.
CREATE FUNCTION keystone.revoke_session_by_token(p_token_id text, p_secret_hash bytea, p_reason text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.session
       SET revoked_at = now(), revoked_reason = p_reason
     WHERE token_id = p_token_id AND secret_hash = p_secret_hash AND revoked_at IS NULL
     RETURNING 1)
  SELECT count(*)::integer FROM done
$$;
REVOKE ALL ON FUNCTION keystone.revoke_session_by_token(text, bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_session_by_token(text, bytea, text) TO app_rw, app_owner;

-- ★ "REMOVE THIS DEVICE". By session id, and the id alone is not enough: the row must belong to
--   the asking person, in the tenant the transaction is actually scoped to.
CREATE FUNCTION keystone.revoke_session_by_id(
  p_tenant_id uuid, p_app_user_id uuid, p_session_id uuid, p_reason text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.session
       SET revoked_at = now(), revoked_reason = p_reason
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id
       AND app_user_id = p_app_user_id
       AND revoked_at IS NULL
       AND p_tenant_id::text = current_setting('keystone.tenant_id', true)
     RETURNING 1)
  SELECT count(*)::integer FROM done
$$;
REVOKE ALL ON FUNCTION keystone.revoke_session_by_id(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_session_by_id(uuid, uuid, uuid, text) TO app_rw, app_owner;

-- ★ "SIGN OUT EVERYWHERE", PRACTICE-SCOPED — spec 04 §3 default 5. p_except_token_id lets the
--   screen keep the session that asked, which is what "sign out my other devices" means.
CREATE FUNCTION keystone.revoke_sessions_for_user(
  p_tenant_id uuid, p_app_user_id uuid, p_reason text, p_except_token_id text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.session
       SET revoked_at = now(), revoked_reason = p_reason
     WHERE tenant_id = p_tenant_id
       AND app_user_id = p_app_user_id
       AND revoked_at IS NULL
       AND (p_except_token_id IS NULL OR token_id <> p_except_token_id)
       AND p_tenant_id::text = current_setting('keystone.tenant_id', true)
     RETURNING 1)
  SELECT count(*)::integer FROM done
$$;
REVOKE ALL ON FUNCTION keystone.revoke_sessions_for_user(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_sessions_for_user(uuid, uuid, text, text) TO app_rw, app_owner;

SET LOCAL ROLE app_owner;
