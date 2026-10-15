-- 0044_worker_tenant_lister
-- P18.6(e) — ★★★ A POLL CANNOT ENUMERATE TENANTS, AND "ZERO TENANTS" READS AS "NO WORK".
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ §D5, VERBATIM: *"`claim_events` filters on `current_tenant_id()`, so a worker must already know a
--     tenant before it can claim. But `keystone.tenant` is itself FORCE RLS — **`app_rw` with no context
--     sees ZERO tenants.** … there is no legal tenant-lister today. This is the same chicken-and-egg as
--     D2.1 and takes the same `keystone_auth` treatment."*
--
-- ★★ AND `db/gates/p18_queue_lease.mjs` MEASURED IT: with no tenant context a claim returns **0** events.
--    Zero is indistinguishable from "nothing to do", so a worker built on a poll would report healthy
--    forever while moving nothing. **That is this project's signature failure shape** and it is the
--    reason this function exists rather than a `WHERE true` somewhere.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ GATED BY A POSTGRES **GRANT**, NOT BY AN `if`. This is §P19.8's rule ("enforced with a POSTGRES
--     GRANT not an `if`") applied one phase early, because the hazard is identical: a SECURITY DEFINER
--     function that lists every tenant is the single most valuable thing in the database to call, and an
--     application-level check protecting it is one refactor from being skipped.
--   ★★ SO: a DEDICATED ROLE — `app_worker` — that may EXECUTE this and nothing else, and `app_rw` is
--      explicitly NOT granted it. The application cannot enumerate tenants even by accident, and a SQL
--      injection reaching `app_rw` gains nothing here.
--   ★ EXECUTE is revoked from PUBLIC first. In Postgres, functions are executable by PUBLIC by DEFAULT —
--     so creating a definer function and granting it to one role, without revoking, grants it to
--     everybody and looks locked down. That default is the trap this line exists for.

-- ── 1 · THE ROLE — A BOOTSTRAP, NOT A MIGRATION. FOLLOWING 0025's PRECEDENT. ────
-- ★★★ MY FIRST VERSION RAN `CREATE ROLE app_worker` HERE AND FAILED: `permission denied to create role`.
--     [MEASURED] `db/migrate.mjs` issues `SET ROLE app_owner`, and `app_owner` has no CREATEROLE — a
--     superuser connection loses the attribute the moment it assumes the role. So role creation cannot
--     live in the migration stream at all.
--   ★★ AND THE PROJECT ALREADY DECIDED THIS, at `0025_signup_boundary.sql:42-47`, which RAISEs with the
--      exact bootstrap command for `app_signup` and says why: *"it is part of the ROLE BOOTSTRAP
--      (HANDOFF.md D-12.0a), not of any migration."* ★ Following that precedent rather than inventing a
--      second mechanism — two ways to create a role is how one of them ends up forgotten on a new
--      database, and the failure would be a worker that silently cannot enumerate tenants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    RAISE EXCEPTION
      'role app_worker does not exist. It is part of the ROLE BOOTSTRAP, not of any migration, because '
      'migrations run as app_owner (no CREATEROLE). Create it as a SUPERUSER, then re-run: '
      'CREATE ROLE app_worker NOLOGIN; '
      'GRANT CONNECT ON DATABASE keystone TO app_worker; '
      '-- ★ NOLOGIN on purpose: the worker still connects as app_rw today, so nothing can reach this '
      'function yet. Granting LOGIN + a password is the deploy-time step that wires it.';
  END IF;
END $$;

-- ★★★ EVERYTHING BELOW RUNS AS `auth_owner`, FOLLOWING 0020's PRECEDENT (`0020:55-62`).
--     [EXECUTED] without it: `FATAL: permission denied for schema keystone_auth`. The schema was created
--     `AUTHORIZATION auth_owner`, so `app_owner` — which the migrator assumes — has no rights in it. That
--     is deliberate and load-bearing: 0020's own header says `app_rw` IS NOT A MEMBER of auth_owner and
--     holds NO privilege on anything in this schema, which is what keeps the credential store outside
--     the tenant RLS regime rather than merely beside it.
--   ★ `SET LOCAL` — scoped to this migration's transaction, so it cannot leak onto a pooled connection.
SET LOCAL ROLE auth_owner;

GRANT USAGE ON SCHEMA keystone_auth TO app_worker;

-- ── 2 · THE LISTER ─────────────────────────────────────────────────────────────
-- ★★ IT LIVES IN `keystone_auth`, NOT `keystone`, and that placement is the point: `keystone_auth` is the
--    schema that sits OUTSIDE the tenant RLS regime by design (§Y2/§D2.1). A cross-tenant question cannot
--    be answered from inside a per-tenant schema without punching a hole in it.
-- ★★★ `search_path` IS PINNED TO '' AND EVERY NAME IS SCHEMA-QUALIFIED. A SECURITY DEFINER function with
--     a mutable search_path is a privilege-escalation primitive: a caller sets `search_path` to a schema
--     they control, puts their own `tenant` table in it, and the definer body reads theirs instead of
--     ours. P21A.6 audits this across every definer function; it is not optional here.
CREATE OR REPLACE FUNCTION keystone_auth.list_active_tenant_ids()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  -- ★ ACTIVE ONLY. A suspended or deleted tenant must not have work done on its behalf — a reminder
  --   email to a practice that has left is a support incident and possibly a data-protection one.
  SELECT t.id FROM keystone.tenant t
   WHERE t.status = 'active'
   ORDER BY t.id;
$$;

-- ★★★ THE ORDER OF THESE TWO LINES IS LOAD-BEARING. REVOKE FIRST.
REVOKE ALL ON FUNCTION keystone_auth.list_active_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_active_tenant_ids() TO app_worker;

COMMENT ON FUNCTION keystone_auth.list_active_tenant_ids() IS
  'P18.6(e) — the ONLY legal way to enumerate tenants. SECURITY DEFINER because keystone.tenant is '
  'FORCE RLS and app_rw with no context sees zero rows, which reads as "no work". Gated by GRANT to '
  'app_worker ONLY — app_rw is deliberately not granted it, so the application cannot enumerate tenants.';

-- ── 3 · ★★★ AND A WORKER MUST BE ABLE TO SAY WHETHER A NAMED TENANT IS REAL ────
-- ★★ U26 / §D5's enqueue hazard: *"`handleQueueJob` reads `job.tenantId` off a caller-supplied object
--    with NO VERIFICATION WHATSOEVER. The moment something enqueues, 'write a row, name a tenant, get
--    that tenant's data' becomes reachable — and graphile's `add_job` is a SQL function callable by
--    anything with `app_rw`'s DML grants."*
--   ★ This does not make `add_job` safe — nothing at the database level can, while `app_rw` may call it.
--     What it does is give the worker a way to refuse a job naming a tenant that does not exist or is not
--     active, so a forged `tenantId` cannot even start work. The rest of the mitigation is a DESIGN rule
--     enforced in the worker and asserted by its gate: **a job payload may not carry a recipient address
--     or a URL**, so naming a tenant cannot redirect that tenant's data anywhere.
CREATE OR REPLACE FUNCTION keystone_auth.tenant_is_active(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone.tenant t WHERE t.id = p_tenant_id AND t.status = 'active');
$$;

REVOKE ALL ON FUNCTION keystone_auth.tenant_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.tenant_is_active(uuid) TO app_worker;

COMMENT ON FUNCTION keystone_auth.tenant_is_active(uuid) IS
  'P18.6(e)/U26 — lets a worker REFUSE a job whose tenantId is forged or belongs to a suspended tenant. '
  'Not a substitute for authorising the enqueue: app_rw can still call add_job. The complementary rule '
  'is that a job payload may not carry a recipient or a URL, so naming a tenant cannot redirect data.';

-- ★ Back to the migrator's own role, so anything after this migration is unaffected.
RESET ROLE;
