-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P6.81 CORRECTED — I GAVE `app_rw` THE QUEUE SCHEMA TO BUILD A SCREEN. THAT WAS THE WRONG FIX.
--
-- ★★★ WHAT 0104/0105 DID AND WHY IT IS WRONG. `/platform/jobs` showed only the OUTBOX
--     (`keystone.event`, 100% processed and permanently reassuring) while `graphile_worker.jobs`
--     held 97 failing jobs nobody could see. To let the list read the second table, 0105 granted
--     `app_rw` USAGE on `graphile_worker` and SELECT on `graphile_worker.jobs`.
--
--   ★★★ `db/gates/p21a_role_matrix.mjs:174` ASSERTS, IN TERMS, THAT `app_rw` MUST HAVE NEITHER:
--       *"app_rw can do NEITHER — so the queue identity is a real boundary, not a formality"*,
--       and it fails with *"the split is decorative"*. It went red the moment 0105 applied.
--     ★★ THIS IS THE STANDING RULE ARRIVING FROM THE UNGUARDED DIRECTION. "Never weaken an
--        assertion to make something pass" is usually about editing a test. **I did not edit the
--        test — I widened the SYSTEM until the test's subject stopped being true.** That is the
--        same defect and it is harder to see, because every gate stays green except the one that
--        was guarding the thing I changed. The two-identity split (`app_rw` serves requests,
--        `app_worker` runs the queue) is a real containment boundary: it means a request-path SQL
--        injection cannot read or rewrite the job queue.
--
-- ★★★ THE CORRECT SHAPE WAS ALREADY IN THIS CODEBASE AND I EVEN CITED IT. `platform_list_tenants()`
--     is `SECURITY DEFINER`, owned by `auth_owner`, `SET search_path TO ''`, and gated INSIDE the
--     function on `keystone.caller_is_platform()` — a predicate the database evaluates on every
--     call, not an `if` in a route. `src/routes/platform.mjs`'s own header points at it as the
--     pattern for exactly this problem. I read that, wrote it down, and then granted a table.
--
-- ★ SO: the grants are REVOKED, and the screen reads through a function that crosses the boundary
--   ONCE, under a check the caller cannot forge. A non-platform caller gets zero rows, silently and
--   correctly — never an error that leaks the existence of the queue.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RAISE NOTICE 'graphile_worker schema absent — nothing to revoke and nothing to expose';
    RETURN;
  END IF;

  RESET ROLE;   -- ★ the connecting role, whoever it is — 0105's lesson: ownership is environment state
  REVOKE SELECT ON graphile_worker.jobs  FROM app_rw;
  REVOKE USAGE  ON SCHEMA graphile_worker FROM app_rw;

  -- ★★★ THE POST-CONDITION, THE SAME WAY 0105 LEARNED TO ASSERT ONE. A revoke that quietly did
  --     nothing would leave the boundary open while this file reports success.
  IF has_schema_privilege('app_rw', 'graphile_worker', 'USAGE')
     OR has_table_privilege('app_rw', 'graphile_worker.jobs', 'SELECT') THEN
    RAISE EXCEPTION 'REVOKE did not take effect: app_rw can still reach the worker queue';
  END IF;
  RAISE NOTICE 'app_rw no longer reaches graphile_worker — the two-identity split is intact';
END $$;

-- ★★ OWNED BY `auth_owner`, like `platform_list_tenants`. SECURITY DEFINER runs as the OWNER, so the
--    owner is what must be able to read the queue — never the caller.
CREATE OR REPLACE FUNCTION keystone.platform_list_worker_jobs()
RETURNS TABLE(id text, topic text, attempts int, max_attempts int, last_error text, run_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT j.id::text, j.task_identifier::text, j.attempts, j.max_attempts,
         -- ★ TRUNCATED HERE, not in the renderer. A stack trace in a table cell is unreadable AND it
         --   can carry values lifted out of a payload — another tenant's data reaching a platform
         --   screen. The first line names the failure, which is what an operator needs.
         left(j.last_error, 180),
         j.run_at
    FROM graphile_worker.jobs j
   -- ★★★ THE GATE, evaluated by the database on every call. A non-platform context yields zero rows.
   WHERE keystone.caller_is_platform()
   ORDER BY j.attempts DESC, j.run_at
$function$;

DO $$
BEGIN
  -- ★ The function must be OWNED by a role that can actually read the queue, or SECURITY DEFINER
  --   buys nothing. `auth_owner` owns `platform_list_tenants` for the same reason.
  EXECUTE 'ALTER FUNCTION keystone.platform_list_worker_jobs() OWNER TO auth_owner';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'could not set owner to auth_owner (%) — leaving the connecting role as owner', SQLERRM;
END $$;

REVOKE ALL ON FUNCTION keystone.platform_list_worker_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_worker_jobs() TO app_rw;
