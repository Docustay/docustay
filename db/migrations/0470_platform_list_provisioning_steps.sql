-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 18.15 — Platform Provisioning Steps Lister
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.platform_list_provisioning_steps(p_run_id uuid)
  RETURNS TABLE (
    name text,
    ordinal int,
    state text,
    attempts int,
    max_attempts int,
    started_at timestamptz,
    completed_at timestamptz,
    retryable boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  SELECT
    ps.name,
    ps.ordinal,
    ps.state,
    ps.attempts,
    ps.max_attempts,
    ps.started_at,
    ps.completed_at,
    ps.last_error_retryable
  FROM keystone.provisioning_step ps
  WHERE ps.run_id = p_run_id
    AND keystone.caller_is_platform()
  ORDER BY ps.ordinal;
$$;

REVOKE ALL ON FUNCTION keystone.platform_list_provisioning_steps(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_provisioning_steps(uuid) TO app_rw;

SET LOCAL ROLE app_owner;

-- ★★ Self-check: the function exists, is security-definer, has search_path set, and has proper grants.
DO $$
DECLARE
  v_owner text;
  v_secdef boolean;
  v_search_path text[];
  v_proacl aclitem[];
BEGIN
  SELECT proowner::regrole::text, prosecdef, proconfig, proacl
    INTO v_owner, v_secdef, v_search_path, v_proacl
    FROM pg_proc
    WHERE pronamespace = 'keystone'::regnamespace
      AND proname = 'platform_list_provisioning_steps'
      AND pronargs = 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Function platform_list_provisioning_steps/1 not found';
  END IF;

  IF v_owner != 'auth_owner' THEN
    RAISE EXCEPTION 'Function owner is %, not auth_owner', v_owner;
  END IF;

  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Function is not SECURITY DEFINER';
  END IF;

  -- ★ REHEARSAL FIX: pg_proc.proconfig stores the setting as 'search_path=""', never as ''.
  IF v_search_path IS NULL OR NOT ('search_path=""' = ANY (v_search_path)) THEN
    RAISE EXCEPTION 'Function search_path not set to empty string';
  END IF;

  IF v_proacl IS NULL THEN
    RAISE EXCEPTION 'Function has no ACL grants';
  END IF;
END;
$$;
