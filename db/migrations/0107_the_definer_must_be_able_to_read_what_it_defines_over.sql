-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P6.81 — A `SECURITY DEFINER` FUNCTION IS ONLY A BRIDGE IF ITS OWNER CAN STAND ON BOTH BANKS.
--
-- ★★★ 0106 CREATED `keystone.platform_list_worker_jobs()` AS `SECURITY DEFINER` OWNED BY
--     `auth_owner`, and it FAILED with `permission denied for schema graphile_worker` — because
--     **`auth_owner` cannot read that schema either.** SECURITY DEFINER runs as the OWNER; it does
--     not confer anything the owner does not already hold. `platform_list_tenants()` works because
--     `auth_owner` can read `keystone.tenant`. I copied the pattern without checking the one
--     precondition that makes the pattern work.
--
-- ★★ SO THE GRANT MOVES TO THE DEFINER, AND THAT IS THE WHOLE POINT RATHER THAN A TECHNICALITY:
--      · `app_rw` — the role that serves every HTTP request — still has NOTHING on the queue.
--        `p21a_role_matrix` keeps asserting exactly that, and a request-path injection still cannot
--        reach `graphile_worker`.
--      · `auth_owner` — a role NO REQUEST EVER RUNS AS — can read it, and the only way to that
--        reading is one function whose body gates on `keystone.caller_is_platform()`.
--    ★ That is a narrow, auditable crossing instead of a schema handed to the request path.
--
-- ★ 0105's lesson applies again and is why nothing here names the queue's owner: OWNERSHIP IS
--   ENVIRONMENT STATE (`graphile_worker` is owned by `app_worker` on deployed and by
--   `keystone_admin` locally). This resets to the connecting role, which is a superuser on both.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RAISE NOTICE 'graphile_worker schema absent — nothing to grant';
    RETURN;
  END IF;

  RESET ROLE;
  GRANT USAGE  ON SCHEMA graphile_worker TO auth_owner;
  GRANT SELECT ON graphile_worker.jobs  TO auth_owner;

  -- ★★★ BOTH HALVES ASSERTED, because this migration is only correct if BOTH are true: the definer
  --     gained the read AND the request role still has not. Checking one would let the boundary
  --     reopen silently — which is exactly how 0105 shipped a grant that did nothing.
  IF NOT has_schema_privilege('auth_owner', 'graphile_worker', 'USAGE')
     OR NOT has_table_privilege('auth_owner', 'graphile_worker.jobs', 'SELECT') THEN
    RAISE EXCEPTION 'auth_owner still cannot read graphile_worker — the definer function is a bridge to nowhere';
  END IF;
  IF has_schema_privilege('app_rw', 'graphile_worker', 'USAGE')
     OR has_table_privilege('app_rw', 'graphile_worker.jobs', 'SELECT') THEN
    RAISE EXCEPTION 'app_rw reached the queue again — 0106 revoked this and something put it back';
  END IF;
  RAISE NOTICE 'auth_owner reads the queue; app_rw does not; the crossing is one gated function';
END $$;
