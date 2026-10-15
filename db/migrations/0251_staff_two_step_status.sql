-- 0251_staff_two_step_status
-- Spec 01 (Team and roles) §3, task 1.2 — TeamList's "Sign-in" column needs to know, for the WHOLE
-- roster in one round trip, which identities hold a CONFIRMED TOTP factor.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [MEASURED] `keystone_auth.totp_factor` (0206:31-52) carries a single `deny_all` policy with NO
-- GRANT to `app_rw` and no `tenant_id` column at all (one identity, one factor, shared across every
-- practice that identity belongs to) — reached only through a SECURITY DEFINER function owned by
-- `auth_owner`, per that file's own stated rule (0206's header: "reached only through SECURITY
-- DEFINER functions owned by auth_owner"). `hasConfirmedFactor(firebaseUid)` (src/auth/totp.mjs:333)
-- already answers this one identity at a time; TeamList needs the roster's status in one call.
--
-- ★★ SAME SHAPE AS `keystone.account_seat_counts` (0007/0008) — "adopt nothing, just read across a
--    boundary the caller cannot reach directly, and return the minimum shape needed." Structurally
--    incapable of returning anything but a SUBSET of the uids already passed in: never a superset,
--    never a secret, never a name.
--
-- ★ SAME OWNERSHIP IDIOM AS 0228 (`keystone.resolve_session`/`keystone.upgrade_session`) — a
--   function that LIVES in schema `keystone` but READS a `keystone_auth`-owned, deny-all table must
--   itself be OWNED BY `auth_owner`, or the deny_all policy refuses it exactly as it refuses
--   everyone else. `db/migrate.mjs` runs this file as `app_owner`, a NOINHERIT member of
--   `auth_owner`, so the role is switched for the CREATE and put back explicitly afterwards — never
--   a bare `RESET ROLE` (F482).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.confirmed_totp_uids(p_firebase_uids text[])
RETURNS TABLE (firebase_uid text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT f.firebase_uid
    FROM keystone_auth.totp_factor f
   WHERE f.firebase_uid = ANY(p_firebase_uids) AND f.confirmed_at IS NOT NULL
$$;

COMMENT ON FUNCTION keystone.confirmed_totp_uids(text[]) IS
  'Task 1.2 (spec 01 §3) — TeamList''s two-step column, for the whole roster at once. Returns only '
  'the CONFIRMED subset of the uids passed in: structurally incapable of returning a superset, a '
  'secret or a name, the same argument 0008''s own comment makes for account_seat_counts.';

REVOKE ALL ON FUNCTION keystone.confirmed_totp_uids(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.confirmed_totp_uids(text[]) TO app_rw;

-- ─── SELF-CHECK — owner, SECURITY DEFINER, empty search_path and the app_rw grant all landed as
--     written, same discipline 0228's own self-check applies to resolve_session/upgrade_session. ───
DO $$
DECLARE v_owner text; v_prosecdef boolean; v_proconfig text[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_prosecdef, v_proconfig
    FROM pg_proc p WHERE p.oid = 'keystone.confirmed_totp_uids(text[])'::regprocedure;
  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0251: keystone.confirmed_totp_uids is owned by %, must be auth_owner', v_owner;
  END IF;
  IF NOT v_prosecdef THEN
    RAISE EXCEPTION '0251: keystone.confirmed_totp_uids lost SECURITY DEFINER';
  END IF;
  IF v_proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '0251: keystone.confirmed_totp_uids proconfig is %, expected search_path="" only', v_proconfig;
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.confirmed_totp_uids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '0251: app_rw lacks EXECUTE on keystone.confirmed_totp_uids';
  END IF;
END $$;

SET LOCAL ROLE app_owner;
