-- 0175 — keystone.touch_session: a live session's `last_seen_at` finally gets written, at most once
-- a minute per session.  Stage 6 task 6.3 · CT-023 (renamed to schema `keystone` per X6-2).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ `last_seen_at` (0020:136, `keystone_auth.session`) was DECLARED AND NEVER WRITTEN BY ANYTHING.
--     MEASURED on production: 447 session rows, 0 with `last_seen_at` set. This function is the first
--     writer it ever gets.
--
-- ★★★ AT MOST ONE WRITE PER MINUTE PER SESSION. `last_seen_at` is read on every authenticated request
--     (6.14 calls this from inside `runTenantScoped`), so an unconditional UPDATE on every request
--     would make the busiest table in the product a row-level hot spot and fill the WAL with nothing.
--     The throttle predicate — `last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute'` —
--     is what keeps that to at most one write a minute, and the return value tells the caller whether
--     a write happened at all.
--
-- ★★ DELIBERATELY NO PRACTICE-STATUS GATE. `touch_session` only records that a request happened;
--    `keystone.resolve_session` (6.2) is what decides whether the request is allowed at all. Two
--    gates on one fact in two places is exactly what 0020:217-218 warns against for resolve_session's
--    own two-uuid return — the same reasoning applies here: one function, one job.
--
-- ★★ `RETURNS boolean` — an identifier-free scalar. It is not what catalog-conformance's credential-
--    resolver return-type rule is aimed at (no token_id, no secret_hash, no row content can travel
--    through it), but 6.7 adds `touch_session` to `CREDENTIAL_RESOLVERS` anyway because it reads the
--    credential store by (token_id, secret_hash); `boolean` passes that rule's return-type check
--    cleanly regardless.
--
-- ★★★ OWNERSHIP. `keystone_auth.session` is owned by `auth_owner`, and `app_owner` holds no USAGE on
--    schema `keystone_auth` (0020:46-48) — a function created by app_owner could not even name the
--    table in its body. This file therefore runs the CREATE, the REVOKE, the GRANT and the COMMENT as
--    `auth_owner`, exactly as 0020, 0045/0046 and 0171 do, because app_owner is NOINHERIT and a
--    REVOKE issued by the wrong role degrades to a silent warning rather than an error (0121:99-125).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.touch_session(p_token_id text, p_secret_hash bytea)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.session
       SET last_seen_at = now()
     WHERE token_id = p_token_id
       AND secret_hash = p_secret_hash
       AND revoked_at IS NULL
       AND expires_at > now()
       -- ★ AT MOST ONE WRITE PER MINUTE PER SESSION. A write on every request makes the busiest
       --   table in the product a row-level hot spot and fills the WAL with nothing.
       AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')
     RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM done)
$$;

ALTER FUNCTION keystone.touch_session(text, bytea) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.touch_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.touch_session(text, bytea) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.touch_session(text, bytea) IS
  'Stage 6 / CT-023 — sets last_seen_at = now() on a live session, at most once a minute per session '
  '(the throttle predicate is the whole point: a write on every authenticated request would make this '
  'the hottest row in the product). Returns whether a write happened; applies no practice-status gate '
  '— that is resolve_session''s job, not this one''s (0020:217-218). last_seen_at was declared and '
  'never written by anything until this function existed.';

-- ★ Back to the role the runner established before this file. SET LOCAL, not RESET: RESET would land
--   on the connecting superuser (0121:129-135) and every later statement would create objects under it.
SET LOCAL ROLE app_owner;

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS. A REVOKE that degraded to a
--    warning, or an ACL rewritten by an owner change, applies "cleanly" and leaves a credential
--    resolver callable by every role in the cluster.
DO $$
DECLARE
  v_sig constant text := 'keystone.touch_session(text, bytea)';
  v_owner text;
  v_result text;
BEGIN
  SELECT pg_get_userbyid(p.proowner), pg_get_function_result(p.oid)
    INTO v_owner, v_result
    FROM pg_proc p
   WHERE p.oid = v_sig::regprocedure;

  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'touch_session is owned by %, must be auth_owner (an app_owner-owned definer is still filtered by FORCE — 0008:8-16)', v_owner;
  END IF;
  IF v_result IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'touch_session returns %, must be boolean', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE touch_session — every authenticated request''s touch would fail';
  END IF;
  IF NOT has_function_privilege('app_owner', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_owner cannot EXECUTE touch_session';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE touch_session — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
END $$;
