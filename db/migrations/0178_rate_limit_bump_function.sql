-- 0178_rate_limit_bump_function
-- Stage 6 task 6.18 · R-5-9 / F563.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT. `checkTenantLimit` ran its upsert on the SAME connection, INSIDE the SAME
--     transaction, as the rest of the request. The counter row's lock was therefore held from the
--     upsert until the request's COMMIT — so every request for the same practice and the same
--     bucket serialised behind whichever one was slowest, and a request that failed rolled its own
--     count back, making a flood of errors unlimited.
--
-- ★★★ THIS FUNCTION IS DELIBERATELY **SECURITY INVOKER**, NOT DEFINER. It runs as whatever role
--     calls it — `app_rw`, on the limiter's own short-lived connection (`withLimiterConnection`,
--     `src/db/index.mjs`) — so FORCE ROW LEVEL SECURITY still applies to the upsert exactly as it
--     does today. A DEFINER here would bypass RLS for no reason: nothing about "count this
--     tenant's requests" needs elevated privilege, and `app_rw` already holds
--     `INSERT, UPDATE ... ON keystone.rate_limit_window` (0003).
--
-- ★★★ THE GUARD IS THE WHOLE POINT. `IF coalesce(current_setting('keystone.tenant_id', true), '')
--     <> '' THEN RAISE EXCEPTION` refuses to run if a tenant GUC is already set on the calling
--     connection — which means it is being called from INSIDE a tenant transaction, the exact
--     mistake this migration exists to make impossible to repeat. WHO SUPPLIES THE CONDITION THE
--     GUARD CHECKS: the application. `withTenant` (`src/db/index.mjs:111`) sets this GUC on every
--     tenant transaction; `withLimiterConnection` hands out a connection nothing has ever set it
--     on. A future call from the wrong place gets a loud RAISE EXCEPTION instead of silently
--     re-taking the lock this migration exists to release.
--
-- ★ `set_config('keystone.tenant_id', p_tenant_id::text, true)` — `true` is `is_local`, so on the
--   limiter's own implicit single-statement transaction it evaporates the instant the statement
--   ends. It exists only so the upsert's own RLS predicate (`tenant_id = current_tenant_id()`,
--   0003) is satisfied by the SAME mechanism every other write in the system uses, rather than a
--   second code path with its own rules.
--
-- ★ NO ALTER TABLE, NO BACKFILL, NO NEW COLUMN, NO FK. MEASURED on production 21 Sep 2026:
--   `keystone.rate_limit_window` holds 0 rows, so there is nothing to migrate and the zero-row-
--   backfill trap (F143/F490) does not arise.
--
-- ★ NOT REVERSIBLE AS A ROLLBACK. Dropping this function restores today's behaviour only if
--   `src/http/rateLimit.mjs` and `src/db/index.mjs` are also reverted to call the request's own
--   `db` again — this file does not pretend otherwise.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION keystone.bump_rate_limit_window(
  p_tenant_id    uuid,
  p_bucket       text,
  p_window_start timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  -- ★★★ THE GUARD — see the header note above. `search_path = ''` means every catalog function
  -- below must be schema-qualified.
  IF coalesce(pg_catalog.current_setting('keystone.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION
      'keystone.bump_rate_limit_window must run on a limiter connection (withLimiterConnection), '
      'never inside a tenant transaction (withTenant) — that is the row lock it exists to avoid '
      'holding for the whole request (F563).'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM pg_catalog.set_config('keystone.tenant_id', p_tenant_id::text, true);

  INSERT INTO keystone.rate_limit_window (tenant_id, bucket, window_start, count)
  VALUES (p_tenant_id, p_bucket, p_window_start, 1)
  ON CONFLICT (tenant_id, bucket, window_start)
  DO UPDATE SET count = keystone.rate_limit_window.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION keystone.bump_rate_limit_window(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.bump_rate_limit_window(uuid, text, timestamptz) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.bump_rate_limit_window(uuid, text, timestamptz) IS
  'Stage 6 / R-5-9 / F563. SECURITY INVOKER, on purpose — runs as app_rw under FORCE RLS, on its '
  'own short-lived limiter connection (src/db/index.mjs withLimiterConnection), so the counter '
  'row''s lock is released at once instead of being held until the request commits. Refuses '
  '(RAISE EXCEPTION) if keystone.tenant_id is already set, which means it is being called inside '
  'a tenant transaction — the mistake it exists to make impossible to repeat.';

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS — a REVOKE that degraded
--    to a warning, or a grant that never landed, applies "cleanly" and leaves either a function
--    nobody can call or one PUBLIC can call.
DO $$
DECLARE
  v_sig constant text := 'keystone.bump_rate_limit_window(uuid, text, timestamptz)';
  v_owner text;
  v_result text;
  v_security text;
BEGIN
  SELECT pg_get_userbyid(p.proowner), pg_get_function_result(p.oid),
         CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END
    INTO v_owner, v_result, v_security
    FROM pg_proc p
   WHERE p.oid = v_sig::regprocedure;

  IF v_security IS DISTINCT FROM 'INVOKER' THEN
    RAISE EXCEPTION 'bump_rate_limit_window is SECURITY %, must be INVOKER — it must run as the caller (app_rw) under FORCE RLS, not bypass it', v_security;
  END IF;
  IF v_result IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'bump_rate_limit_window returns %, must be integer', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE bump_rate_limit_window — every limiter call would fail';
  END IF;
  IF NOT has_function_privilege('app_owner', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'app_owner cannot EXECUTE bump_rate_limit_window';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE bump_rate_limit_window — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
END $$;
