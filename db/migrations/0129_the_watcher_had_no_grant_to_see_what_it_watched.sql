-- ★★★ F485 [MEASURED, production worker log 2026-09-17T19:44:27Z] — "outbox: this check could not
--     run: permission denied for table event" / "backup: ... permission denied for table backup_run".
--     `watch_system` runs `systemChecks(db)` on `helpers.withPgClient`, which is the graphile-worker
--     pool — **app_worker** — and p21a_role_matrix asserts, correctly, that app_worker holds ZERO
--     table privileges (0127's own comment: "it is a QUEUE identity, not a data identity"). The
--     outbox and backup checks read `keystone.event` and `keystone_meta.backup_run` directly, so
--     they have never worked in production. The queue check was silent about this because it reads
--     graphile's OWN tables, which app_worker does hold privileges on.
--
-- ★★ THE OBVIOUS FIX IS THE 0127/0128 SHAPE — A SECURITY DEFINER FUNCTION — AND FOR `backup_run` IT
--    IS THAT SIMPLE: `keystone_meta.backup_run` carries no RLS (0114: "NOT TENANT-SCOPED"), so a
--    definer owned by `app_owner` (the table's own owner) reads it exactly as the table query did.
--
-- ★★★ BUT `keystone.event` IS DIFFERENT, AND THIS IS 0008/0017's TRAP ARRIVING HERE.
--    [MEASURED while building this migration] a first version of `outbox_health()`, created under
--    the default `app_owner` role, returned `pending=0` while `keystone.event` held 303 unprocessed
--    rows: `keystone.event` is `ENABLE + FORCE ROW LEVEL SECURITY` under
--        CREATE POLICY tenant_isolation ON keystone.event USING (tenant_id = current_tenant_id())
--    (0016), owned by `app_owner` — and FORCE applies `tenant_isolation` TO THE OWNER TOO. A
--    `SECURITY DEFINER` function owned by the table's own owner is filtered exactly like any other
--    query with no tenant context: not an error, a silent, wrong ZERO. That is worse than the
--    permission-denied it replaces — a health check that always says "outbox: ok" because it can
--    see nothing is the F2 shape (a number that looks like a measurement and is the absence of one).
--
-- ★★ THE FIX IS 0017's OWN PATTERN, NOT A NEW ONE (`keystone.tenant_timezones_for_health()`, and
--    0018's `caller_is_platform()` family): own the function by a role that is **NOT** the table's
--    owner — `auth_owner`, NOLOGIN, NOBYPASSRLS, already used for exactly this class of read — and
--    add an explicit, SELECT-ONLY, unconditional policy admitting THAT ROLE ALONE. TWO SEPARATE
--    MECHANISMS, BOTH REQUIRED: the GRANT lets `auth_owner` touch the table at all (without it,
--    `permission denied for table event`); the POLICY is what actually lets it see every tenant's
--    rows instead of none (without it, silently zero — the trap above). Neither is optional.
--
-- ★ THE RETURN TYPE IS THE OTHER HALF OF THE SAFETY ARGUMENT (0007/0008's "too narrow to carry a
--   leak"): `outbox_health()` returns a count and an age, never an event id, a payload, or a
--   tenant_id. There is no shape in which one tenant's event content reaches another through it.
--
-- ★ app_worker gets EXECUTE on both functions and gets NO privilege on `keystone.event` or
--   `keystone_meta.backup_run` themselves — the zero-table-rights property in p21a_role_matrix is
--   unchanged, asserted directly by test/s1_health_checks_as_worker.test.mjs.
--
-- ★ `/api/platform/health` (src/routes/platform.mjs) calls the SAME `systemChecks` on `app_rw`, and
--   after this migration both checks go through these functions too — one code path for both
--   callers, per watch.mjs's own reasoning that a watcher with a second copy of the logic is a
--   second opinion that drifts. app_rw already had direct SELECT on both underlying tables (0114,
--   and ordinary tenant RLS for `keystone.event`), so it also gets EXECUTE here.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- OUTBOX. Owned by auth_owner + an explicit policy — see the trap explained above.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT ON keystone.event TO auth_owner;

CREATE POLICY event_health_read ON keystone.event
  FOR SELECT TO auth_owner USING (true);

COMMENT ON POLICY event_health_read ON keystone.event IS
  'F485/0129 — admits ONLY auth_owner, ONLY for SELECT, so keystone_meta.outbox_health() can see the outbox across every tenant. The health check runs from the worker with no tenant context, and FORCE RLS means even the table owner (app_owner) sees nothing without this. Never widen this to another role or another verb.';

-- ★ auth_owner already holds USAGE+CREATE on schema `keystone` (0017/0018's own functions live
--   there); it holds neither on `keystone_meta` yet because nothing has ever needed a
--   cross-tenant definer living in THIS schema before. Same standing grant, second schema — not a
--   one-off escalation, and auth_owner is NOLOGIN, reachable only by SET ROLE from app_owner,
--   which is itself NOLOGIN and reachable only from the migration connection.
GRANT USAGE, CREATE ON SCHEMA keystone_meta TO auth_owner;

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone_meta.outbox_health()
RETURNS TABLE (pending int, oldest_seconds int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::int                                                      AS pending,
         coalesce(max(extract(epoch FROM now() - e.created_at))::int, 0)    AS oldest_seconds
    FROM keystone.event e
   WHERE e.processed_at IS NULL
$$;

COMMENT ON FUNCTION keystone_meta.outbox_health() IS
  'F485/0129 — the outbox aggregate src/health/watch.mjs reads: how many events are unprocessed and how old the oldest one is, across every tenant. Owned by auth_owner so event_health_read applies instead of app_owner''s forced tenant_isolation. No event id, no payload, no tenant_id — an aggregate too narrow to carry a leak (0007/0008).';

SET LOCAL ROLE app_owner;

REVOKE ALL ON FUNCTION keystone_meta.outbox_health() FROM PUBLIC;
-- ★ app_owner is granted too ONLY so the positive control at the foot of this migration can call
--   it at all — same reasoning as 0017:79-83.
GRANT EXECUTE ON FUNCTION keystone_meta.outbox_health() TO app_worker, app_rw, app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKUP. `keystone_meta.backup_run` carries no RLS, so a definer owned by app_owner (its own
-- owner) is enough — the same query backupCheck() already runs, moved behind a function.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone_meta.backup_health()
RETURNS TABLE (finished_at timestamptz, verified boolean, destination text, dump_bytes bigint, age_seconds int)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, keystone_meta AS $$
  SELECT finished_at, verified, destination, dump_bytes,
         extract(epoch FROM now() - finished_at)::int AS age_seconds
    FROM keystone_meta.backup_run
   WHERE target = current_database() AND verified
   ORDER BY finished_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION keystone_meta.backup_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.backup_health() TO app_worker, app_rw;

-- ★ app_worker already has USAGE on keystone_meta from 0127; restated here so this migration does
--   not depend on 0127 having run for that one line to be true, the same defensiveness 0127/0128
--   already show toward re-issuing an idempotent GRANT.
GRANT USAGE ON SCHEMA keystone_meta TO app_worker;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE IT, IN THE MIGRATION, IN BOTH DIRECTIONS — 0017's own rule: a resolver created and
--    never called has shipped a hope.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n_direct integer; result record;
BEGIN
  -- NEGATIVE: app_owner — the table's own owner — still sees nothing directly. If this is ever
  -- non-zero, tenant_isolation on keystone.event has been broken, and outbox_health() would be
  -- masking that break rather than working around FORCE RLS's owner trap.
  SELECT count(*) INTO n_direct FROM keystone.event;
  IF n_direct <> 0 THEN
    RAISE EXCEPTION
      'tenant_isolation is not filtering app_owner on keystone.event: a direct read with no tenant context returned % row(s). outbox_health() would be masking a broken policy, not fixing the owner trap.', n_direct;
  END IF;

  -- POSITIVE CONTROL: the resolver actually runs, with no tenant context, and does not raise.
  SELECT * INTO result FROM keystone_meta.outbox_health();
  RAISE NOTICE 'outbox health: direct read sees % row(s) (correctly RLS-filtered); outbox_health() sees pending=%, oldest_seconds=% across every tenant, with no tenant context set', n_direct, result.pending, result.oldest_seconds;
END $$;
