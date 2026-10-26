-- 0174_resolve_session_practice_status
-- Stage 6 task 6.2 — a session on a suspended or closed practice resolves to nothing.
--
-- ★★★ `keystone.resolve_session` (0020:221-235) never looked at `keystone.tenant.status` at all.
--     A staff member holding a valid, unexpired session cookie kept a working session through a
--     suspension or a closure. This file adds the status gate, live-read at resolve time — it does
--     NOT revoke anything, so setting the practice back to `active` makes the session work again
--     with no re-sign-in required.
--
-- ★★ THE ASYMMETRY (spec 04 §3 default 4, Q6-4): suspending a practice ends STAFF sessions but the
--    client app stays readable. The gate is therefore `t.status NOT IN ('suspended','closed') OR
--    s.kind = 'client'` — a client session (6.1's `kind` column) is exempt from the status check
--    entirely. `provisioning` is not in the refused set, so it resolves (Q6-4).
--
-- ★★★ X6-3 — SIGNATURE AND RETURN TYPE ARE UNCHANGED. CT-022 asks for `kind text` and
--    `last_seen_at timestamptz` to be added to the return row; doing that here would fail
--    db/gates/catalog-conformance.mjs:667-677, which forbids a credential resolver's return type
--    from containing `text` (or any of the other listed types) at all — the return type IS the
--    safety argument (0045:150-166). Nothing in Stage 6 reads those two columns from this function.
--    This is a CREATE OR REPLACE of the same `RETURNS TABLE (tenant_id uuid, app_user_id uuid)`.
--
-- ★ Two facts this file leans on and does not re-derive:
--   - `auth_owner` can already read `keystone.tenant.status` with no tenant context: 0017:54-57
--     grants `SELECT ON keystone.tenant TO auth_owner` and policy `tenant_health_read` is
--     `FOR SELECT TO auth_owner USING (true)`. Without that grant this join would silently return
--     zero rows and refuse EVERY session, not just the suspended/closed ones.
--   - Staff-vs-client comes from `session.kind` (6.1, 0173), not from `app_user.role` — `auth_owner`
--     holds only `SELECT (firebase_uid, tenant_id)` on `keystone.app_user` (0097:41-45) and cannot
--     read `role`.
--
-- ★★ OWNERSHIP: `keystone.resolve_session` is owned by `auth_owner` (created inside the
--    `SET LOCAL ROLE auth_owner` block at 0020:62-269). A `CREATE OR REPLACE` by the same owner
--    preserves the owner, the existing `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO
--    app_rw, app_owner` (0020:236-237) unchanged — they are NOT re-issued here. This file runs as
--    app_owner (db/migrate.mjs per-file `SET ROLE app_owner`), a NOINHERIT member of auth_owner
--    (0132 header), so the role is switched exactly as 0171 and 0173 do, and put back explicitly —
--    NOT `RESET ROLE` (F482, db/migrate.mjs:301-316).
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id
    FROM keystone_auth.session s
    JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND (t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

SET LOCAL ROLE app_owner;

-- ★★ ASSERT THE PART THAT FAILS QUIETLY. A join that silently returns zero rows for everyone would
--    still "apply cleanly" — this proves the function still resolves an ordinary active-practice
--    session before the migration commits, and that ownership/signature were not disturbed by the
--    replace.
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
  -- ★ Not an exact string match on pg_get_function_result's formatting (0125:127-130 avoids that
  --   for the same reason) — the checks that matter are the two columns still being there, unchanged,
  --   and X6-3's refusal: no `text` (or `timestamptz`) sneaking into the return row.
  IF v_result NOT LIKE '%tenant_id uuid%' OR v_result NOT LIKE '%app_user_id uuid%' THEN
    RAISE EXCEPTION 'resolve_session returns %, expected both tenant_id uuid and app_user_id uuid — the two-uuid return is the safety argument (0020:217-218)', v_result;
  END IF;
  IF v_result LIKE '%text%' OR v_result LIKE '%timestamptz%' THEN
    RAISE EXCEPTION 'resolve_session returns %, which now contains text or timestamptz — X6-3: catalog-conformance.mjs:667-677 forbids a credential resolver from returning those types', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE resolve_session — every session-bearing request would fail';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE resolve_session — the original REVOKE (0020:236) was lost by the replace';
  END IF;
END $$;
