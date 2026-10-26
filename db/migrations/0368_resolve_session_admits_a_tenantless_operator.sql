-- 0368_resolve_session_admits_a_tenantless_operator
--
-- REAL BUG, found during the F1-F4 harness build (24 Sep 2026), NOT a harness artifact.
--
-- keystone.resolve_session (0020, unchanged in this respect through 0174/0186/0208/0228/0250) has
-- always carried `JOIN keystone.tenant t ON t.id = s.tenant_id`. An operator session is minted by
-- `openPlatformSession` (src/auth/operatorSession.mjs) with `tenantId: null` — an operator is not
-- inside any one practice. A plain JOIN on `t.id = s.tenant_id` never matches a NULL, so
-- resolve_session returns ZERO ROWS for every operator session that has ever existed.
--
-- `openPlatformSession` re-resolves the session it just minted as its own self-check (the same
-- file, ~line 123: "resolved = await resolveSession(session.token)") and throws
-- "the session was minted but no operator grant id resolved for it" when that comes back empty —
-- which, given the bug above, it ALWAYS does. openPlatformSession therefore cannot successfully
-- return a session to ANY caller, for ANY operator, ever.
--
-- MEASURED against the deployed DB, 24 Sep 2026: a real operator session (kind='operator',
-- tenant_id=NULL, firebase_uid = the one active operator_grant's own uid) was minted, and a direct
-- reproduction of resolve_session's JOIN against that exact session row returned 0 rows. This is not
-- a harness-only failure; it is the mechanism the whole Platform console depends on, and the JOIN
-- has had this shape since operator sessions were introduced (0208) — so it is unlikely this path
-- has ever completed successfully in production.
--
-- THE FIX: LEFT JOIN, so a tenant-less session is not excluded, and the practice-suspended check is
-- skipped (not failed) when there is no tenant to check — `t.id IS NULL OR t.status NOT IN (...)`.
-- Every other column, predicate and output shape is unchanged from 0250's version.

-- ★ resolve_session is owned by auth_owner (same as its 0250 definer), not app_owner — this
--   migration runs as app_owner by default, so it must switch role first, exactly as 0250 does.
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid, viewing_as_app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
             AND g.approved_at IS NOT NULL
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id,
         CASE WHEN s.viewing_as_expires_at > now() THEN s.viewing_as_app_user_id ELSE NULL END
           AS viewing_as_app_user_id
    FROM keystone_auth.session s
    -- ★ FIX (0368) — LEFT JOIN, was JOIN. An operator session's tenant_id is NULL by design
    --   (an operator is not inside any one practice); a plain JOIN excluded every such row.
    LEFT JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.kind <> 'partial'
     -- ★ FIX (0368) — `t.id IS NULL OR ...`: with no tenant to check (an operator session), the
     --   suspended/closed predicate has nothing to say and must not silently exclude the row via a
     --   NULL comparison (`NULL NOT IN (...)` is NULL, which WHERE treats as false).
     AND (t.id IS NULL OR t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

COMMENT ON FUNCTION keystone.resolve_session(text, bytea) IS
  '0368: LEFT JOIN keystone.tenant (was JOIN) so a tenant-less operator session resolves — a plain '
  'JOIN excluded every operator session ever minted, since 0208, because openPlatformSession mints '
  'them with tenant_id=NULL by design. Same four output columns and every other predicate as 0250.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- SELF-CHECK — reproduce the exact defect against a real row shape and confirm it is gone.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $resolve_session_operator_check$
DECLARE
  v_count integer;
BEGIN
  -- A tenant-less session (tenant_id NULL) must now be reachable by the JOIN — simulate with a
  -- correlated NULL the same way an operator session's tenant_id actually is NULL.
  SELECT count(*) INTO v_count
    FROM (SELECT NULL::uuid AS tenant_id) s
    LEFT JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE (t.id IS NULL OR t.status NOT IN ('suspended','closed'));
  IF v_count <> 1 THEN
    RAISE EXCEPTION '0368: a NULL-tenant row must pass the LEFT JOIN + NULL-safe status check, got % rows', v_count;
  END IF;

  RAISE NOTICE '0368: resolve_session now admits a tenant-less (operator) session.';
END $resolve_session_operator_check$;

-- ★ Hand the role back — the migration runner's own bookkeeping (schema_migrations) needs
--   app_owner, same as every other migration; 0250 ends the same way for the same reason.
SET LOCAL ROLE app_owner;
