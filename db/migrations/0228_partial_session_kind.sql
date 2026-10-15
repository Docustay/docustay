-- 0228_partial_session_kind
-- Stage 8 task 8.14 / F634 — the "partial session" POST /api/auth/two-step/verify needs, and the
-- upgrade path off it.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE SHAPE, IN ONE PARAGRAPH. login() (src/auth/login.mjs, this migration's companion JS change,
-- field 4 §1) mints kind='partial' instead of kind='app' when the identity holds a confirmed TOTP
-- factor (task 8.8's hasConfirmedFactor). keystone.resolve_session — the ONE function every
-- authenticated route resolves its principal through (src/http/app.mjs:693, loadPerson) — is
-- CREATE OR REPLACE'd to refuse kind='partial' outright, so a partial session is a 401 on every
-- ordinary route BY CONSTRUCTION, never by a check some other file has to remember to add. The ONE
-- route allowed to see a partial session, POST /api/auth/two-step/verify (task 8.14,
-- src/auth/install.mjs), reads it through a SEPARATE, narrower resolver,
-- keystone.resolve_partial_session, that returns the OPPOSITE of resolve_session's new filter: only
-- kind='partial' rows, nothing else. Once the code checks out (src/auth/totp.mjs's verifyTotp,
-- UNCHANGED by this migration or this task), keystone.upgrade_session flips that SAME row's kind to
-- 'app' in place — no new token is minted, no new secret crosses the wire, the browser's existing
-- ks_session cookie is simply now backed by a full session.
--
-- ★★★ WHY IN PLACE, NOT REVOKE-AND-REMINT (the two-function shape login.mjs's own header calls "the
--     same verify-then-act idiom verifyEmailCode + signInWithCode already use"). A remint would need
--     a SECOND presented secret to reach the browser some way other than the Set-Cookie header
--     POST /api/auth/login already sent — and P0.7/F109 is the standing rule against handing a
--     session secret back in a JSON body a second time. An in-place UPDATE, keyed on the SAME
--     token_id/secret_hash the caller already holds, needs no new secret at all.
--
-- ★★★ WHY resolve_partial_session RETURNS UUIDS ONLY, NEVER firebase_uid (CONTRACTS §0 C-1 / Q0-16).
--     C-1 already refused exactly this shape once, for resolve_session's own operator lookup —
--     "no uid text ever leaves the resolver". The two-step/verify route gets its firebase_uid the
--     SAME way login.mjs's own person lookup and 8.14's other six routes already do: an ordinary,
--     RLS'd SELECT against keystone.app_user, keyed on the app_user_id this resolver hands back, run
--     inside withTenant(tenantId) — not a second definer, not a text column leaving a SECURITY
--     DEFINER function.
--
-- ★ Same ownership idiom as 0173/0186/0208/0209 (this file's own precedent): keystone_auth.session
--   is owned by auth_owner; db/migrate.mjs runs each file as app_owner, a NOINHERIT member of
--   auth_owner, so the role is switched for every ALTER/CREATE below and put back explicitly — never
--   a bare RESET ROLE (F482).
--
-- ★★ FUNCTION RULE 2 (CONTRACTS §0): every new SECURITY DEFINER below gets an explicit
--    REVOKE ALL ... FROM PUBLIC then the GRANT EXECUTE it needs — Postgres's own default ACL on a
--    new function is EXECUTE TO PUBLIC, and db/gates/catalog-conformance.mjs sweeps EVERY prosecdef
--    function in schema keystone for this, by a name-free scan, regardless of CREDENTIAL_RESOLVERS
--    membership (see this migration's closing note on why these two are deliberately NOT added to
--    that named set).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE auth_owner;

-- ─── 1 · WIDEN THE CHECK, found by catalog lookup rather than assumed by name (this run has hit
--        migration-number AND constraint-name collisions before) — never invalidates an existing
--        row: every value the old set admitted, the new set still admits; no backfill, no rewrite.
DO $$
DECLARE v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'kind'
   WHERE n.nspname = 'keystone_auth' AND t.relname = 'session'
     AND c.contype = 'c' AND a.attnum = ANY(c.conkey) AND array_length(c.conkey, 1) = 1;
  IF v_conname IS NULL THEN
    RAISE EXCEPTION '0228: no single-column CHECK constraint found on keystone_auth.session.kind — the 0173 shape has changed and this migration''s assumption no longer holds';
  END IF;
  EXECUTE format('ALTER TABLE keystone_auth.session DROP CONSTRAINT %I', v_conname);
END $$;

ALTER TABLE keystone_auth.session ADD CONSTRAINT session_kind_check
  CHECK (kind IN ('app','operator','client','partial'));

-- ─── 2 · resolve_session (0186, CREATE OR REPLACE'd once already by 0208) REFUSES 'partial'. ───
-- Signature, return type, owner, SECURITY DEFINER, empty search_path and ACL are UNCHANGED —
-- CREATE OR REPLACE preserves ACL (CONTRACTS "FUNCTION RULE 2"; 0208 already relied on this for the
-- same function). The ONLY behavioural change: a kind='partial' row is now invisible to this
-- resolver, so loadPerson (src/http/app.mjs:689-698) finds no person and every ordinary
-- authenticated route 401s on a partial session — exactly test (i)'s positive control.
CREATE OR REPLACE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
             AND g.approved_at IS NOT NULL
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id
    FROM keystone_auth.session s
    JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.kind <> 'partial'
     AND (t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

-- ─── 3 · resolve_partial_session — the ONLY reader that CAN see a kind='partial' row. STABLE, two
--         uuids out, nothing else (C-1). ─────────────────────────────────────────────────────────
CREATE FUNCTION keystone.resolve_partial_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id
    FROM keystone_auth.session s
    JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.kind = 'partial'
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND t.status NOT IN ('suspended','closed')
$$;
REVOKE ALL ON FUNCTION keystone.resolve_partial_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_partial_session(text, bytea) TO app_rw, app_owner;

-- ─── 4 · upgrade_session — the WRITE side. One UPDATE, guarded on kind='partial' so a second call
--         (or a call racing the row's own expiry) touches nothing and returns zero rows; the
--         partial row IS the row that becomes the app session — nothing is inserted or revoked. ───
CREATE FUNCTION keystone.upgrade_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE keystone_auth.session
     SET kind = 'app', expires_at = now() + interval '12 hours'
   WHERE token_id = p_token_id
     AND secret_hash = p_secret_hash
     AND kind = 'partial'
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING tenant_id, app_user_id
$$;
REVOKE ALL ON FUNCTION keystone.upgrade_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.upgrade_session(text, bytea) TO app_rw, app_owner;

-- ─── SELF-CHECK 1 — resolve_session kept its exact shape (0208's own pattern, same function). ───
DO $$
DECLARE v_owner text; v_prosecdef boolean; v_proconfig text[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_prosecdef, v_proconfig
    FROM pg_proc p WHERE p.oid = 'keystone.resolve_session(text,bytea)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0228: keystone.resolve_session is owned by %, must stay auth_owner', v_owner;
  END IF;
  IF NOT v_prosecdef THEN
    RAISE EXCEPTION '0228: keystone.resolve_session lost SECURITY DEFINER';
  END IF;
  IF v_proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '0228: keystone.resolve_session proconfig is %, expected search_path="" only', v_proconfig;
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.resolve_session(text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION '0228: app_rw lost EXECUTE on keystone.resolve_session';
  END IF;
END $$;

-- ─── SELF-CHECK 2 — the widened CHECK really admits 'partial', proven, not assumed. ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'keystone_auth' AND t.relname = 'session' AND c.conname = 'session_kind_check'
       AND pg_get_constraintdef(c.oid) LIKE '%''partial''%'
  ) THEN
    RAISE EXCEPTION '0228: session_kind_check does not mention ''partial'' after the widen — the DROP/ADD above did not take effect as expected';
  END IF;
END $$;

SET LOCAL ROLE app_owner;
