-- 0152_the_watcher_gets_the_rest_of_its_eyes
-- Stage 4 Task 11 — spec 07 §5's health-check table, and §6's IMMEDIATE list, built the rest of the
-- way. `src/health/watch.mjs` (P8.10, F485) checked three things (queue, outbox, backup); 07 §5 lists
-- fourteen rows. This migration is the read side for six of the new ones — worker-safe, the F485 way:
-- every check `systemChecks()` runs must work identically from `app_worker` (watch_system, ZERO table
-- rights by design — p21a_role_matrix) and from `app_rw` (the /platform/health route). A raw table
-- read that only happens to work for one of the two callers is exactly how F485 shipped.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ §0 — F520 [MEASURED locally, 2026-09-18]: TWO GRANTS EXIST ON THIS DATABASE THAT NO MIGRATION
--     EVER MADE. `\dp keystone_meta.schema_migrations` shows `app_rw=r`; `\dn+ keystone_meta` shows
--     `app_rw=U`. `src/health/probes.mjs`'s `checkMigrations()` (readyz) has depended on both since
--     P12.6 and has apparently worked in every environment measured — but neither grant appears in
--     ANY file under db/migrations/, and `scripts/bootstrap-roles.mjs` does not issue them either.
--     A database bootstrapped fresh from this repository today (`scripts/prepare-fresh-database.mjs`,
--     the same path test/s1_bootstrap_fresh_database.test.mjs runs) would NOT have them, and readyz's
--     migration check would fail closed with "permission denied" the first time it ran on such a
--     database. Re-issued here, TRACKED, and idempotent (a repeated GRANT is a no-op) — this closes
--     the gap going forward regardless of how it opened. Filed as FINDINGS F520.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT USAGE ON SCHEMA keystone_meta TO app_rw;
GRANT SELECT ON keystone_meta.schema_migrations TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · DATABASE MIGRATIONS (07 §5 row 1) — `keystone_meta.schema_migrations` carries no RLS (it is
--     not tenant data), so a definer owned by its own owner (app_owner) is enough — the backup_health
--     shape, not the outbox_health one. Comparison against the files on disk still happens in Node
--     (`src/health/probes.mjs`'s `computeMigrationDrift`, shared with `checkMigrations()` so the two
--     never disagree about what "drift" means) — a database cannot see the migrations/ directory.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.schema_migrations_health()
RETURNS TABLE (id text, checksum text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id, checksum FROM keystone_meta.schema_migrations
$$;
REVOKE ALL ON FUNCTION keystone_meta.schema_migrations_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.schema_migrations_health() TO app_worker, app_rw;

COMMENT ON FUNCTION keystone_meta.schema_migrations_health() IS
  'Stage 4 Task 11 / 07 §5 — every applied migration id and checksum, worker-safe (app_worker holds zero table rights). The on-disk comparison happens in Node; this is the read half only.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · WORKER HEARTBEAT (07 §5 row "Worker heartbeat") — `keystone_meta.worker_heartbeat` (0127)
--     carries no RLS either; 0127 granted app_rw SELECT directly but never gave app_worker a reader
--     (only `worker_beat()`, the writer). Same shape as §1.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.worker_heartbeat_health()
RETURNS TABLE (age_seconds int, ever boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT extract(epoch FROM now() - max(beat_at))::int, count(*) > 0 FROM keystone_meta.worker_heartbeat
$$;
REVOKE ALL ON FUNCTION keystone_meta.worker_heartbeat_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.worker_heartbeat_health() TO app_worker, app_rw;

COMMENT ON FUNCTION keystone_meta.worker_heartbeat_health() IS
  'Stage 4 Task 11 / 07 §5 — how old the newest heartbeat row is, and whether one has ever been written, worker-safe. ★ This is a DISPLAY row for Platform Health only — the ALERTING for a stale worker is Stage 4 Task 3''s dedicated path (keystone_meta.worker_alert_transition, migration 0146, key ''worker''); the JS caller deliberately gives this check a DIFFERENT key (''worker_heartbeat'') so watch_system''s generic notifyTransitions() never alerts on it a second time.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · RESTORE TEST (07 §5 row "Restore test") — `keystone_meta.backup_run` (0114) already carries
--     no RLS (P8.10's own comment: "NOT TENANT-SCOPED") and backup_health (0129) already reads it
--     as app_owner. The weekly restore test writes its OWN row into the SAME table
--     (`infra/backup/backup-offsite.sh`'s target `<database> (weekly restore test)`, not a separate
--     column — there is no `weekly_restore_test` column anywhere in the schema; the brief's phrase
--     names the CONVENTION, not a column) — so this reads the latest one for this database.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.restore_test_health()
RETURNS TABLE (finished_at timestamptz, verified boolean, age_seconds int)
-- ★ Controller review round 1: `SET search_path = ''`, like the other four — everything below is
--   already schema-qualified (`keystone_meta.backup_run`), and `current_database()` resolves via
--   pg_catalog, which Postgres always searches first regardless of search_path.
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT finished_at, verified, extract(epoch FROM now() - finished_at)::int
    FROM keystone_meta.backup_run
   WHERE target = current_database() || ' (weekly restore test)'
   ORDER BY finished_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION keystone_meta.restore_test_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.restore_test_health() TO app_worker, app_rw;

COMMENT ON FUNCTION keystone_meta.restore_test_health() IS
  'Stage 4 Task 11 / 07 §5 — the latest weekly-restore-test row for THIS database (target = current_database() || '' (weekly restore test)'', written by infra/backup/backup-offsite.sh), worker-safe. Zero rows means never run.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · EMAIL / RESEND (07 §5 row "Email (Resend)") — `keystone.notification_delivery` (0016) IS
--     tenant-scoped and FORCE RLS, so this is the 0129 outbox_health TRAP shape, not the backup_health
--     one: a definer owned by app_owner (the table's own owner) would be filtered to nothing by its
--     own `tenant_isolation` policy. Owned by auth_owner instead, with an explicit SELECT-only,
--     unconditional policy admitting auth_owner alone — exactly `event_health_read`'s shape.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT ON keystone.notification_delivery TO auth_owner;

CREATE POLICY notification_delivery_health_read ON keystone.notification_delivery
  FOR SELECT TO auth_owner USING (true);

COMMENT ON POLICY notification_delivery_health_read ON keystone.notification_delivery IS
  'Stage 4 Task 11 / 07 §5 — admits ONLY auth_owner, ONLY for SELECT, so keystone_meta.email_health() can see every tenant''s email deliveries. FORCE RLS means even the table owner (app_owner) sees nothing without this (0129''s trap, restated). Never widen this to another role or another verb.';

SET LOCAL ROLE auth_owner;

-- ★ `recent_*` is the 15-minute window 07 §5 tests the error rate against; `day_total` is the 24-hour
--   window that decides `unknown` ("no sends in 24 h") from `ok` ("quiet, nothing recent"). Both a
--   `failed` send (the provider refused it) and a `skipped` one (no RESEND_API_KEY at all — the
--   deployment cannot send) count as bad: from an operator's chair "email did not go out" is the
--   fact, whichever of the two caused it. Only rows with `completed_at IS NOT NULL` are counted — an
--   `attempted` row still in flight or in doubt is neither a success nor a failure yet.
CREATE FUNCTION keystone_meta.email_health()
RETURNS TABLE (recent_total int, recent_bad int, day_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    count(*) FILTER (WHERE completed_at >= now() - interval '15 minutes')::int,
    count(*) FILTER (WHERE completed_at >= now() - interval '15 minutes'
                       AND status IN ('failed', 'skipped'))::int,
    count(*) FILTER (WHERE completed_at >= now() - interval '24 hours')::int
  FROM keystone.notification_delivery
  WHERE channel = 'email' AND completed_at IS NOT NULL
$$;
-- ★★★ 0141's OWN TRAP, AVOIDED: this function is owned by auth_owner (created under SET LOCAL ROLE
--     auth_owner above), so its REVOKE/GRANT must ALSO run as auth_owner — issued as app_owner
--     (which holds no grant option here, being NOINHERIT) they would WARN and silently change
--     nothing, exactly how F499 shipped. Handed back to app_owner only AFTER.
REVOKE ALL ON FUNCTION keystone_meta.email_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.email_health() TO app_worker, app_rw;
-- ★ COMMENT ON, LIKEWISE, WHILE STILL THE OWNER — unlike GRANT/REVOKE (which warn and no-op for a
--   non-owner), COMMENT ON THROWS ("must be owner of function") for one, so this would have failed
--   the migration outright rather than shipping silently wrong — but it belongs here regardless.
COMMENT ON FUNCTION keystone_meta.email_health() IS
  'Stage 4 Task 11 / 07 §5 — cross-tenant email delivery counts for the 15-minute error-rate window and the 24-hour "any sends at all" window. Aggregates only — no notification id, no recipient, no tenant_id.';
SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §5 · CALENDAR SYNC, CROSS-TENANT (07 §5 row "Calendar sync") — moved from the /platform/health
--     ROUTE (which read `calendarHealth()` inside the CALLING tenant's own RLS scope — one practice's
--     connections only) into `systemChecks()`, across every practice. `keystone.calendar_connection`
--     (0013) is tenant-scoped and FORCE RLS — the same outbox_health/notification_delivery trap.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT ON keystone.calendar_connection TO auth_owner;

CREATE POLICY calendar_connection_health_read ON keystone.calendar_connection
  FOR SELECT TO auth_owner USING (true);

COMMENT ON POLICY calendar_connection_health_read ON keystone.calendar_connection IS
  'Stage 4 Task 11 / 07 §5 — admits ONLY auth_owner, ONLY for SELECT, so keystone_meta.calendar_health() can see every tenant''s calendar connections, not just the calling session''s own tenant. FORCE RLS means even the table owner (app_owner) sees nothing without this. Never widen this to another role or another verb.';

SET LOCAL ROLE auth_owner;

-- ★ The same three problem kinds `src/booking/calendarSync.mjs`'s `calendarHealth()` already computes
--   per-tenant (expired-but-active, renewal_failed, sweep overdue past 6h) — counted across every
--   tenant instead of one. Aggregates only: no connection id, no host id, no provider account name.
CREATE FUNCTION keystone_meta.calendar_health()
RETURNS TABLE (total int, expired_active int, renewal_failed int, sweep_overdue int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE channel_expires_at IS NOT NULL AND channel_expires_at < now()
                       AND status = 'active')::int,
    count(*) FILTER (WHERE status = 'renewal_failed')::int,
    count(*) FILTER (WHERE status = 'active'
                       AND (last_swept_at IS NULL OR last_swept_at < now() - interval '6 hours'))::int
  FROM keystone.calendar_connection
$$;
-- ★★★ SAME 0141 TRAP, SAME AVOIDANCE: owned by auth_owner, so the REVOKE/GRANT run as auth_owner too.
REVOKE ALL ON FUNCTION keystone_meta.calendar_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.calendar_health() TO app_worker, app_rw;
COMMENT ON FUNCTION keystone_meta.calendar_health() IS
  'Stage 4 Task 11 / 07 §5 — cross-tenant calendar connection counts: total, expired-but-active (silently broken), renewal_failed, and sweep-overdue (>6h). Aggregates only.';
SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ PROVE IT, IN BOTH DIRECTIONS (0129/0141/0145's own rule) — one block per function: PUBLIC and
--     the public-facing roles refused, app_worker and app_rw admitted, and the function actually
--     returns a row rather than raising.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fn   text;
  r    text;
  probe record;
  fns  text[] := ARRAY[
    'keystone_meta.schema_migrations_health()',
    'keystone_meta.worker_heartbeat_health()',
    'keystone_meta.restore_test_health()',
    'keystone_meta.email_health()',
    'keystone_meta.calendar_health()'
  ];
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0152 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  FOREACH fn IN ARRAY fns LOOP
    -- NEGATIVE: PUBLIC and the two public-facing roles cannot execute it.
    IF has_function_privilege('public', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0152: % is executable by PUBLIC (acl %)', fn, (SELECT proacl FROM pg_proc WHERE oid = fn::regprocedure);
    END IF;
    FOREACH r IN ARRAY ARRAY['app_signup', 'app_embed'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, fn, 'EXECUTE') THEN
        RAISE EXCEPTION '0152: % can execute %', r, fn;
      END IF;
    END LOOP;
    -- POSITIVE: the two real callers can.
    FOREACH r IN ARRAY ARRAY['app_worker', 'app_rw'] LOOP
      IF NOT has_function_privilege(r, fn, 'EXECUTE') THEN
        RAISE EXCEPTION '0152: % lost EXECUTE on % — the health check would break', r, fn;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE '0152: all 5 new health functions — PUBLIC/app_signup/app_embed refused, app_worker/app_rw admitted';
END $$;

-- ★ Functional positive controls, as the two roles that will actually call these in production.
--   app_owner cannot EXECUTE its own two auth_owner-owned functions (NOINHERIT, no grant to itself) —
--   the two below run as auth_owner; the three owned by app_owner run as app_owner itself.
DO $$
DECLARE result record;
BEGIN
  SELECT * INTO result FROM keystone_meta.schema_migrations_health() LIMIT 1;
  -- ★ Not asserting a row exists (a database with zero applied migrations is a contradiction — this
  --   migration itself would not be running — but the assertion below is about the CALL succeeding,
  --   not about cardinality).
  PERFORM 1;
  SELECT * INTO result FROM keystone_meta.worker_heartbeat_health();
  IF result.ever IS NULL THEN
    RAISE EXCEPTION '0152: worker_heartbeat_health() returned no row at all';
  END IF;
  SELECT * INTO result FROM keystone_meta.restore_test_health();
  -- ★ Zero rows is a legitimate, expected answer (no restore test has ever run) — the call
  --   succeeding without raising is what this proves.
  PERFORM 1;
END $$;

SET LOCAL ROLE auth_owner;
DO $$
DECLARE email_result record; cal_result record;
BEGIN
  SELECT * INTO email_result FROM keystone_meta.email_health();
  IF email_result.recent_total IS NULL THEN
    RAISE EXCEPTION '0152: email_health() returned no row';
  END IF;
  SELECT * INTO cal_result FROM keystone_meta.calendar_health();
  IF cal_result.total IS NULL THEN
    RAISE EXCEPTION '0152: calendar_health() returned no row';
  END IF;
  RAISE NOTICE '0152: email_health() and calendar_health() both run as auth_owner and return a row (recent_total=%, calendar total=%)',
    email_result.recent_total, cal_result.total;
END $$;
SET LOCAL ROLE app_owner;

-- ★★ AND THE FORCE-RLS OWNER TRAP, NAMED AND CHECKED (0129's own negative control, twice over): the
--    two tables' OWNER (app_owner) must still see NOTHING with no tenant context — if this is ever
--    non-zero, tenant_isolation has been broken and the two new definers above would be masking that
--    break rather than reading around it honestly.
DO $$
DECLARE n_notif bigint; n_cal bigint;
BEGIN
  SELECT count(*) INTO n_notif FROM keystone.notification_delivery;
  SELECT count(*) INTO n_cal FROM keystone.calendar_connection;
  IF n_notif <> 0 OR n_cal <> 0 THEN
    RAISE EXCEPTION '0152: tenant_isolation is not filtering app_owner (notification_delivery=%, calendar_connection=%) — email_health()/calendar_health() would be masking a broken policy',
      n_notif, n_cal;
  END IF;
END $$;
