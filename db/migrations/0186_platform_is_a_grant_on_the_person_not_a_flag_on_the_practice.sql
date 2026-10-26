-- 0186_platform_is_a_grant_on_the_person_not_a_flag_on_the_practice
-- Stage 7 task 7.6 — CLAUDE.md failure #1, by name: "a GUC three live policies read that nothing in
-- the application ever set" (CONTRACTS.md Q0-5). Today `keystone.caller_is_platform()` (0018:36-44)
-- reads `keystone.tenant.is_platform` — a fact about the PRACTICE, not the caller. This migration
-- moves the condition onto the IDENTITY: a live row in `keystone_auth.operator_grant` (0184), named
-- through a third, uuid-only GUC `keystone.operator_grant_id` that `src/db/index.mjs`'s `withTenant`
-- sets from the session resolver's own output — never from a header, never from a parameter a
-- request supplies directly.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THREE THINGS THIS FILE DOES, IN ONE TRANSACTION, IN THIS ORDER:
--   (0) `keystone.resolve_session` (0174) gains a third output column, `operator_grant_id uuid` —
--       looked up INSIDE the resolver's own body from the session's `firebase_uid`, which is never
--       itself returned. This runs first because nothing after it depends on it, and everything
--       after it depends on the bootstrap grant existing before `caller_is_platform()` changes.
--   (i) THE BOOTSTRAP GRANT (Q7-10, RULED by Ty, 21 Sep 2026) — runs BEFORE the function is
--       replaced, so there is never an instant where the new condition is live and no identity
--       satisfies it. Three branches, not two (critic K2-7-1): zero platform-identity candidates on
--       this database → NOTICE and skip (every freshly migrated database, always — MEASURED,
--       STAGE-7-PLAN.md §11 task 7.6 field 6); exactly one → seed (production's shape); more than
--       one → RAISE EXCEPTION, because an ambiguous identity is a case for stopping the deploy, not
--       for the migration to guess.
--   (ii) `keystone.caller_is_platform()` gets a new body reading the GUC.
--   (iii) A self-check: the function is still SECURITY DEFINER with an empty search_path, and — if
--        any platform identity exists on this database — the bootstrap left at least one live grant.
--
-- ★★★ NO UID TEXT ANYWHERE IN THIS FILE OUTLIVES THE STATEMENT THAT READS IT. Not in a GUC, not in
--     a log line, not in a column any caller can see. The credential-resolver rule
--     (`db/gates/catalog-conformance.mjs:638-668`) is why: a credential resolver's return type IS
--     its safety argument, and `resolve_session` is named in `CREDENTIAL_RESOLVERS`. The third
--     column is a **uuid** — the grant's id — and nothing else.
--
-- ★ WHAT DOES NOT CHANGE: `caller_is_platform()`'s name, argument list and return type (13 existing
--   migration call sites and 2 gates keep working unedited — STAGE-7-PLAN.md §11 task 7.6 field 5).
--   `tenant.is_platform` stays as a column (practice metadata, spec 05 §8). `operator_grant_active`
--   is NOT called from here — naming it would put uid text back on the hot path; it stays for
--   `scripts/operator-grant.mjs` and the tests (7.4 field 4), a knowing baseline orphan.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- (0) resolve_session gains operator_grant_id uuid. Same owner, same two original columns,
--     unchanged signature and privileges — a CREATE OR REPLACE of the 0174 version.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★ CREATE OR REPLACE cannot add a THIRD output column to a TABLE-returning function — Postgres
--   refuses that as a return-type change ("cannot change return type of existing function").
--   0174's replace only changed the body, never the signature, so it could stay OR REPLACE; this
--   one adds operator_grant_id, so the 0174 function is dropped and recreated instead. Recreating
--   loses the ACL 0020/0174 built up (a fresh function defaults to EXECUTE granted to PUBLIC), so
--   the REVOKE/GRANT pair below is restated explicitly rather than assumed to survive.
DROP FUNCTION keystone.resolve_session(text, bytea);

CREATE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         -- ★ The uid is read and discarded INSIDE this SECURITY DEFINER, in the same statement —
         --   it is never a column of the result, so catalog-conformance.mjs:668 is satisfied by
         --   construction rather than by an exception.
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id
    FROM keystone_auth.session s
    JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND (t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

-- ★ Restated explicitly (see note above) — same grant shape as 0020:234-235.
REVOKE ALL ON FUNCTION keystone.resolve_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_session(text, bytea) TO app_rw, app_owner;

-- ★ Ownership, signature-shape and privilege self-check — the same discipline 0174 applied to its
--   own CREATE OR REPLACE of this function, extended to the new third column.
DO $$
DECLARE
  v_sig constant text := 'keystone.resolve_session(text, bytea)';
  v_owner  text;
  v_result text;
BEGIN
  SELECT pg_get_userbyid(p.proowner), pg_get_function_result(p.oid)
    INTO v_owner, v_result
    FROM pg_proc p
   WHERE p.oid = v_sig::regprocedure;

  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'resolve_session is owned by %, must stay auth_owner (an app_owner-owned definer is still filtered by FORCE — 0008:8-16)', v_owner;
  END IF;
  IF v_result NOT LIKE '%tenant_id uuid%' OR v_result NOT LIKE '%app_user_id uuid%' OR v_result NOT LIKE '%operator_grant_id uuid%' THEN
    RAISE EXCEPTION 'resolve_session returns %, expected tenant_id uuid, app_user_id uuid AND operator_grant_id uuid — the three-uuid return is the safety argument (Q0-16 / catalog-conformance.mjs:668)', v_result;
  END IF;
  IF v_result LIKE '%text%' OR v_result LIKE '%timestamptz%' OR v_result LIKE '%bytea%' THEN
    RAISE EXCEPTION 'resolve_session returns %, which now contains a forbidden type — a credential resolver''s return type IS its safety argument (catalog-conformance.mjs:667-681)', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE resolve_session — every session-bearing request would fail';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE resolve_session — the original REVOKE (0020:236) was lost by the replace';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- (i) THE BOOTSTRAP GRANT — Q7-10, RULED by Ty, 21 Sep 2026. Runs BEFORE part (ii) replaces
--     caller_is_platform(), so there is never an instant where the new condition is live and no
--     identity satisfies it. No uid is typed here, passed as a parameter, or printed.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n int; BEGIN
  IF EXISTS (SELECT 1 FROM keystone_auth.operator_grant) THEN RETURN; END IF;  -- idempotent
  SELECT count(*) INTO n
    FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id
   WHERE u.firebase_uid IS NOT NULL AND t.is_platform;
  IF n = 0 THEN
    -- A fresh database: no platform identity exists yet, so there is no operator to lock out and
    -- no Platform data to reach. Skip, do not abort (critic K2-7-1) — every freshly migrated
    -- database (dev, CI, restore) hits this branch, always.
    RAISE NOTICE 'bootstrap operator grant: no platform identity carries a firebase_uid on this '
                 'database (fresh install). No bootstrap grant created; issue one with '
                 'scripts/operator-grant.mjs when an identity exists.';
    RETURN;
  END IF;
  IF n > 1 THEN
    RAISE EXCEPTION
      'bootstrap operator grant: expected exactly 1 platform identity with a firebase_uid, found %. '
      'Run scripts/operator-grant.mjs grant against the intended identity, then re-run the migration.',
      n;
  END IF;
  PERFORM keystone.grant_operator(
    (SELECT u.firebase_uid FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id
      WHERE u.firebase_uid IS NOT NULL AND t.is_platform),
    'bootstrap:migration-0186', 'first operator, Stage 7 deploy', now() + interval '1 year');
END $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- (ii) caller_is_platform() — DEFINER and SET search_path = '' PRESERVED (CCR-1), every reference
--      schema-qualified. Name, argument list and return type are UNCHANGED (13 existing migration
--      call sites and 2 gates keep working unedited).
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION keystone.caller_is_platform()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone_auth.operator_grant g
     WHERE g.id = nullif(
                    pg_catalog.current_setting('keystone.operator_grant_id', true), '')::pg_catalog.uuid
       AND g.revoked_at IS NULL
       AND g.expires_at > pg_catalog.now()
  )
$$;

-- ★ The REVOKE/GRANT EXECUTE from 0018 survive a CREATE OR REPLACE and are re-stated anyway so the
--   file reads completely.
REVOKE ALL ON FUNCTION keystone.caller_is_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.caller_is_platform() TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.caller_is_platform() IS
  'CT-039 / Stage 7 task 7.6 — reads keystone.operator_grant_id (a uuid GUC), never keystone.tenant.is_platform. The condition is supplied by src/db/index.mjs''s withTenant, third set_config, from keystone.resolve_session''s own output — never from a header or a request parameter. Re-checks revoked_at/expires_at on every call, so a revoke lands at the next statement, not at session expiry. db/gates/s7_the_application_sets_the_gucs.mjs (task 7.20) proves a real HTTP request supplies it. An empty or malformed GUC fails closed: NULL::uuid or a cast error, never true.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- (iii) SELF-CHECK — shape, then (conditioned exactly as part (i) is, K2-7-1) that the bootstrap
--       left the database reachable if it had anyone to leave reachable.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_sig constant text := 'keystone.caller_is_platform()';
  v_owner    text;
  v_prosecdef boolean;
  v_proconfig text[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_prosecdef, v_proconfig
    FROM pg_proc p
   WHERE p.oid = v_sig::regprocedure;

  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'caller_is_platform is owned by %, must stay auth_owner', v_owner;
  END IF;
  IF NOT v_prosecdef THEN
    RAISE EXCEPTION 'caller_is_platform lost SECURITY DEFINER — every 13 call sites assume it';
  END IF;
  IF v_proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'caller_is_platform proconfig is %, expected search_path="" only', v_proconfig;
  END IF;
END $$;

DO $$
BEGIN
  -- ★ Conditioned exactly as part (i) is (K2-7-1): an unconditional version would abort every
  --   fresh database for the second time in one migration, the same defect wearing a different hat.
  IF EXISTS (SELECT 1 FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id
              WHERE u.firebase_uid IS NOT NULL AND t.is_platform)
     AND NOT EXISTS (SELECT 1 FROM keystone_auth.operator_grant
                      WHERE revoked_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'migration 0186 left zero live operator grants on a database that has a platform '
                    'identity — Platform is now unreachable. Refusing to report success.';
  END IF;
END $$;

SET LOCAL ROLE app_owner;
