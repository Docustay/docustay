-- 0250_viewing_as_session_claim.sql — Task 1.4 (01-team-and-roles.md §3, CT-112, spec 01's half).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE SHAPE. Two nullable columns on `keystone_auth.session` carry a live "viewing as" claim:
-- `viewing_as_app_user_id` (the staff colleague being previewed) and `viewing_as_expires_at` (a
-- fixed 30-minute TTL, the sole auto-expiry mechanism — spec §3: "no separate 'clear on refused
-- write' side effect"). `keystone.resolve_session` — the ONE function every authenticated route
-- resolves its principal through (src/http/app.mjs:674-683, loadPerson) — additionally returns
-- `viewing_as_app_user_id`, NULLED when `viewing_as_expires_at <= now()`, so an expired claim reads
-- as no claim by construction, the same "expired reads as absent" discipline 0228 already applies
-- to the session row itself. Two new SECURITY DEFINER functions, `enter_viewing_as`/
-- `exit_viewing_as`, are the write side — same REVOKE-ALL-then-GRANT-EXECUTE-to-app_rw shape as
-- `upgrade_session` (0228). No new table: per CT-112, "spec 01's TeamSeeAs is same-practice only
-- ... and needs no new table — just the session claim + the new audit action" (0249).
--
-- ★★★ CREATE OR REPLACE CANNOT ADD A THIRD/FOURTH OUTPUT COLUMN TO A TABLE-RETURNING FUNCTION —
--     Postgres refuses that as a return-type change ("cannot change return type of existing
--     function"). This is the SAME constraint 0186 hit adding `operator_grant_id` to this exact
--     function (0186:46-51, verbatim: "0174's replace only changed the body, never the signature,
--     so it could stay OR REPLACE; this one adds operator_grant_id, so the 0174 function is dropped
--     and recreated instead"). Spec 01 §3's own prose says "CREATE OR REPLACE" for this step; that
--     is a description of the OUTCOME (same signature/owner/DEFINER/search_path, one column added),
--     not the literal verb — 0186 and 0208 already establish DROP FUNCTION + CREATE FUNCTION +
--     explicit REVOKE/GRANT as this codebase's actual mechanism for exactly this situation, because
--     recreating loses the ACL a plain CREATE OR REPLACE would have preserved. Followed here, not
--     invented here.
--
-- ★ Same ownership idiom as 0173/0186/0208/0209/0228 (this table's own precedent):
--   keystone_auth.session is owned by auth_owner; db/migrate.mjs runs each file as app_owner, a
--   NOINHERIT member of auth_owner, so the role is switched for every ALTER/CREATE touching
--   keystone_auth or keystone.resolve_session below and put back explicitly — never a bare RESET
--   ROLE (F482).
-- ★★ THE ONE STATEMENT THAT RUNS AS app_owner, NOT auth_owner: `GRANT SELECT (id, role) ON
--    keystone.app_user TO auth_owner`. A GRANT on a table is issued by the table's owner (or a role
--    holding GRANT OPTION) — `keystone.app_user` is owned by app_owner, matching 0031's own
--    `GRANT SELECT (firebase_uid, tenant_id) ON keystone.app_user TO auth_owner`, which likewise
--    runs with no role switch at all. `enter_viewing_as`'s target-validation query needs `id` (to
--    match `p_target_app_user_id`) and `role` (to require `'staff'`) — 0031's existing grant covers
--    neither. This is a DELIBERATE, NECESSARY widening of the credential path's read of app_user,
--    narrower than 0124's own rejected option (a): still SELECT-only, still no `email`/
--    `display_name`/`staff_role`, and the existing RLS policy `credential_uid_lookup` (0031: "FOR
--    SELECT TO auth_owner USING (firebase_uid IS NOT NULL)") still applies — auth_owner still can't
--    see a row with no firebase_uid, id or not. Migration 0124's own guard
--    (`db/migrations/0124_...sql:126-130`) is a WARNING, not an exception, if `auth_owner` gains
--    SELECT on `app_user.id` — expected to fire here, non-fatal, and this comment is the "find out
--    what and why" the warning asks for.
--
-- ★★ FUNCTION RULE 2 (CONTRACTS §0): every new SECURITY DEFINER below gets an explicit
--    REVOKE ALL ... FROM PUBLIC then the GRANT EXECUTE it needs — db/gates/catalog-conformance.mjs
--    sweeps EVERY prosecdef function in schema keystone for this, regardless of CREDENTIAL_RESOLVERS
--    membership. `enter_viewing_as`/`exit_viewing_as` are deliberately NOT added to that named set
--    (same reasoning 0228 gives for resolve_partial_session/upgrade_session): they do not resolve a
--    credential to an identity, they mutate a claim on an already-authenticated session.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ─── 0 · THE GRANT (runs as app_owner, the owner of keystone.app_user — see note above). ───
GRANT SELECT (id, role) ON keystone.app_user TO auth_owner;

SET LOCAL ROLE auth_owner;

-- ─── 1 · THE TWO COLUMNS + SHAPE CHECK, exact SQL from spec §3. ───
ALTER TABLE keystone_auth.session
  ADD COLUMN viewing_as_app_user_id uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  ADD COLUMN viewing_as_expires_at  timestamptz;

ALTER TABLE keystone_auth.session ADD CONSTRAINT session_viewing_as_shape
  CHECK ((viewing_as_app_user_id IS NULL) = (viewing_as_expires_at IS NULL));

-- ─── 2 · resolve_session gains viewing_as_app_user_id, NULLED when expired. Same owner, same ───
--        four original output columns, DROP+CREATE per the header note above. ───
DROP FUNCTION keystone.resolve_session(text, bytea);

CREATE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid, viewing_as_app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
             AND g.approved_at IS NOT NULL
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id,
         -- ★ Expired reads as absent, exactly the discipline the session row itself already gets
         --   (expires_at > now() in the WHERE below) — a caller never has to remember to check the
         --   claim's own expiry a second time.
         CASE WHEN s.viewing_as_expires_at > now() THEN s.viewing_as_app_user_id ELSE NULL END
           AS viewing_as_app_user_id
    FROM keystone_auth.session s
    JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.kind <> 'partial'
     AND (t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

REVOKE ALL ON FUNCTION keystone.resolve_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_session(text, bytea) TO app_rw, app_owner;

-- ─── 3 · enter_viewing_as — the WRITE side of entering preview. UPDATEs the caller's own live ───
--        'app' session row; refuses (zero rows) unless the target is role='staff' in the SAME
--        tenant_id as the session and is not the caller. 30-minute TTL, per spec §3. ───
CREATE FUNCTION keystone.enter_viewing_as(p_token_id text, p_secret_hash bytea, p_target_app_user_id uuid)
RETURNS TABLE (tenant_id uuid, viewing_as_app_user_id uuid, expires_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE keystone_auth.session s
     SET viewing_as_app_user_id = p_target_app_user_id,
         viewing_as_expires_at  = now() + interval '30 minutes'
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.kind = 'app'
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND p_target_app_user_id IS DISTINCT FROM s.app_user_id
     AND EXISTS (
       SELECT 1 FROM keystone.app_user u
        WHERE u.id = p_target_app_user_id
          AND u.role = 'staff'
          AND u.tenant_id = s.tenant_id
     )
  RETURNING s.tenant_id, s.viewing_as_app_user_id, s.viewing_as_expires_at AS expires_at
$$;
REVOKE ALL ON FUNCTION keystone.enter_viewing_as(text, bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.enter_viewing_as(text, bytea, uuid) TO app_rw;

-- ─── 4 · exit_viewing_as — clears both columns on the matching live 'app' session row. ───
--        Idempotent: clearing an already-NULL pair still matches and returns the row (spec §3,
--        matching revokeInvite's own "already revoked is not an error" idiom). ───
CREATE FUNCTION keystone.exit_viewing_as(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE keystone_auth.session
     SET viewing_as_app_user_id = NULL, viewing_as_expires_at = NULL
   WHERE token_id = p_token_id
     AND secret_hash = p_secret_hash
     AND kind = 'app'
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING tenant_id
$$;
REVOKE ALL ON FUNCTION keystone.exit_viewing_as(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.exit_viewing_as(text, bytea) TO app_rw;

-- ─── SELF-CHECK 1 — resolve_session: owner, result shape, no forbidden type, ACL. Same discipline ───
--     0186's own self-check applies, extended to the fourth column. ───
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
    RAISE EXCEPTION '0250: resolve_session is owned by %, must stay auth_owner', v_owner;
  END IF;
  IF v_result NOT LIKE '%tenant_id uuid%' OR v_result NOT LIKE '%app_user_id uuid%'
     OR v_result NOT LIKE '%operator_grant_id uuid%' OR v_result NOT LIKE '%viewing_as_app_user_id uuid%' THEN
    RAISE EXCEPTION '0250: resolve_session returns %, expected all four uuid columns', v_result;
  END IF;
  IF v_result LIKE '%text%' OR v_result LIKE '%timestamptz%' OR v_result LIKE '%bytea%' THEN
    RAISE EXCEPTION '0250: resolve_session returns %, which now contains a forbidden type — a credential resolver''s return type IS its safety argument', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION '0250: app_rw cannot EXECUTE resolve_session — every session-bearing request would fail';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION '0250: PUBLIC can EXECUTE resolve_session — the REVOKE above did not take';
  END IF;
END $$;

-- ─── SELF-CHECK 2 — the shape CHECK really admits the (NULL,NULL)/(set,set) pairing, proven. ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'keystone_auth' AND t.relname = 'session' AND c.conname = 'session_viewing_as_shape'
  ) THEN
    RAISE EXCEPTION '0250: session_viewing_as_shape constraint is missing after the ADD CONSTRAINT above';
  END IF;
END $$;

-- ─── SELF-CHECK 3 — the necessary app_user column widening actually took, narrowly. ───
DO $$
BEGIN
  IF NOT has_column_privilege('auth_owner', 'keystone.app_user', 'id', 'SELECT')
     OR NOT has_column_privilege('auth_owner', 'keystone.app_user', 'role', 'SELECT') THEN
    RAISE EXCEPTION '0250: auth_owner is missing SELECT on app_user.(id, role) — enter_viewing_as cannot validate its target';
  END IF;
  -- ★ Still narrow: no display_name/email/staff_role grant was added by this migration.
  IF has_column_privilege('auth_owner', 'keystone.app_user', 'email', 'SELECT') THEN
    RAISE EXCEPTION '0250: auth_owner unexpectedly holds SELECT on app_user.email — this migration never grants it';
  END IF;
END $$;

SET LOCAL ROLE app_owner;
