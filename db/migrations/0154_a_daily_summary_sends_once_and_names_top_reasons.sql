-- 0154_a_daily_summary_sends_once_and_names_top_reasons
-- Stage 4 Task 13 · spec 07 §6 ("7 am summary … of everything else plus trials ending, near-limit
-- practices, gave-up jobs") · src/health/dailySummary.mjs.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- TWO THINGS, BOTH READ/WRITTEN AS app_worker (the daily_summary job runs on the same connection
-- watch_system does), NEITHER touching a table any application role holds a grant on — the 0129/
-- 0138/0145/0147/0149 shape, repeated because it is the shape that already works:
--
--   1 · keystone_meta.job_failure_summary() — a READ. The daily summary needs "count + top reasons"
--       for unacknowledged gave-up jobs (07 §6); job_failure_health() (0145/0147) only ever returns
--       aggregate counts against a supplied list of dead graphile ids, which the summary has no
--       reason to compute (it does not need to distinguish "unacknowledged" from "unrecorded" the
--       way the queue check does — every ledger row it reports is, by definition, in the ledger).
--       Grouped by task_identifier (the job's own name — JOB_POLICY's label, applied in JS) rather
--       than by the free-text reason: two jobs failing for genuinely the same cause rarely share
--       byte-identical detail (a tenant id, a timestamp, a provider's own wording differ), while the
--       task name is exactly the "what kind of job" a person reads the summary to find out.
--       ★ Returns exactly one row always (a LEFT JOIN against a constant-true row), so `total = 0`
--         is a real answer rather than "zero rows, and total is nowhere to be found" — a caller that
--         only wants the count never has to special-case an empty result.
--
--   2 · keystone_meta.daily_summary_sent + keystone_meta.claim_daily_summary(date) — a WRITE. "One
--       send per day even if the job runs twice" (the brief's own words) cannot rest on the graphile
--       job_key alone: a job_key stops one ROW from duplicating, but says nothing about a second
--       worker racing the first, or a job created any other way under a different key for the same
--       date. A one-row-per-date table with `summary_date` as its PRIMARY KEY, claimed with
--       `INSERT … ON CONFLICT DO NOTHING`, makes Postgres itself the arbiter: two concurrent claims
--       for the same date serialise on the same page, and only one INSERT survives. The claim is
--       taken INSIDE the same transaction as the send attempt (src/health/dailySummary.mjs) so a
--       thrown send rolls the claim back with it — the exact shape alerts.mjs's per-check
--       transaction already uses for the same reason.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ───────────────────────────────────────────────────────────────────────────
DO $precondition$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0154: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
  IF to_regclass('keystone_meta.job_failure') IS NULL THEN
    RAISE EXCEPTION '0154: keystone_meta.job_failure does not exist — 0145 must be applied first';
  END IF;
  IF to_regclass('keystone_meta.daily_summary_sent') IS NOT NULL THEN
    RAISE EXCEPTION '0154: keystone_meta.daily_summary_sent already exists — changed by hand? refusing to guess';
  END IF;
  IF has_table_privilege('app_worker', 'keystone_meta.job_failure', 'SELECT') THEN
    -- ★ 0145 already asserts app_worker holds zero rights on this table; refusing here rather than
    --   silently widening it further is the same "changed by hand? refusing to guess" posture.
    RAISE EXCEPTION '0154: app_worker already holds SELECT on keystone_meta.job_failure — 0145''s guarantee has already eroded; fix that before adding to this table';
  END IF;
END
$precondition$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · job_failure_summary() — READ, aggregates only, grouped by task, top 5.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone_meta.job_failure_summary()
RETURNS TABLE (total int, task_identifier text, occurrences int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, keystone_meta
AS $$
  WITH t AS (
    SELECT pg_catalog.count(*)::int AS total
      FROM keystone_meta.job_failure f
     WHERE f.acknowledged_at IS NULL
  ), g AS (
    SELECT f.task_identifier, pg_catalog.count(*)::int AS occurrences
      FROM keystone_meta.job_failure f
     WHERE f.acknowledged_at IS NULL
     GROUP BY f.task_identifier
     ORDER BY occurrences DESC, f.task_identifier
     LIMIT 5
  )
  SELECT t.total, g.task_identifier, g.occurrences
    FROM t LEFT JOIN g ON true
$$;
REVOKE ALL ON FUNCTION keystone_meta.job_failure_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.job_failure_summary() TO app_worker;

COMMENT ON FUNCTION keystone_meta.job_failure_summary() IS
  'Stage 4 Task 13 (0154) — the 7am summary''s read of unacknowledged gave-up jobs: the total, and up to 5 task_identifiers by occurrence. Always returns exactly one row even when total is 0. EXECUTE to app_worker only; no application role holds any grant on keystone_meta.job_failure itself.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · daily_summary_sent + claim_daily_summary(date) — WRITE, one row per Pacific calendar date.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone_meta.daily_summary_sent (
  summary_date date        PRIMARY KEY,
  sent_at      timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON keystone_meta.daily_summary_sent FROM PUBLIC;

COMMENT ON TABLE keystone_meta.daily_summary_sent IS
  'Stage 4 Task 13 (0154) — one row per Pacific calendar date the 7am summary has been sent for. Written only through keystone_meta.claim_daily_summary(), which is the send-once guard: a second claim for the same date is refused by the primary key, inside the SAME transaction as the send attempt (src/health/dailySummary.mjs), so a worker restart or two workers racing cannot double-send. No application role holds any grant on this table.';

CREATE FUNCTION keystone_meta.claim_daily_summary(p_date date)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, keystone_meta
AS $$
  WITH ins AS (
    INSERT INTO keystone_meta.daily_summary_sent (summary_date)
    VALUES (p_date)
    ON CONFLICT (summary_date) DO NOTHING
    RETURNING summary_date
  )
  SELECT EXISTS (SELECT 1 FROM ins)
$$;
REVOKE ALL ON FUNCTION keystone_meta.claim_daily_summary(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.claim_daily_summary(date) TO app_worker;

COMMENT ON FUNCTION keystone_meta.claim_daily_summary(date) IS
  'Stage 4 Task 13 (0154) — true the FIRST time this Pacific date is claimed, false every time after (already sent). The one send-once guard for the 7am summary; called inside the same transaction as the send attempt so a failed send rolls the claim back. EXECUTE to app_worker only.';

GRANT USAGE ON SCHEMA keystone_meta TO app_worker;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141) — in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; c text; f text; bad text[] := '{}'; probe record; claim1 boolean; claim2 boolean;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0154 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  -- NEGATIVE: no application role holds any table privilege on either table.
  FOREACH r IN ARRAY ARRAY['app_rw','app_worker','app_embed','app_signup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'keystone_meta.job_failure', c) THEN bad := bad || ('job_failure:' || r || ':' || c); END IF;
      IF has_table_privilege(r, 'keystone_meta.daily_summary_sent', c) THEN bad := bad || ('daily_summary_sent:' || r || ':' || c); END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION '0154: reachable directly: % — app_worker must hold zero table rights', bad;
  END IF;

  -- PUBLIC / other roles no, app_worker YES.
  FOREACH f IN ARRAY ARRAY[
      'keystone_meta.job_failure_summary()',
      'keystone_meta.claim_daily_summary(date)'] LOOP
    IF has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0154: % is executable by PUBLIC', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['app_rw','app_embed','app_signup'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '0154: % can execute %', r, f;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('app_worker', f, 'EXECUTE') THEN
      RAISE EXCEPTION '0154: app_worker cannot execute % — the daily summary would break', f;
    END IF;
  END LOOP;

  -- POSITIVE CONTROL 1 · job_failure_summary(): always one row; a planted unacknowledged failure is counted and named.
  SELECT * INTO probe FROM keystone_meta.job_failure_summary();
  IF probe IS NULL THEN
    RAISE EXCEPTION '0154: job_failure_summary() returned no row at all — it must always return exactly one';
  END IF;
  INSERT INTO keystone_meta.job_failure (job_id, task_identifier, job_created_at, tenant_id, reason)
  VALUES (-987654321, 'm0154_probe_task', now(), NULL, 'planted by migration 0154''s self-test');
  SELECT * INTO probe FROM keystone_meta.job_failure_summary();
  IF probe.total < 1 THEN
    RAISE EXCEPTION '0154: job_failure_summary() did not count the planted unacknowledged failure (got %)', probe.total;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM keystone_meta.job_failure_summary() s WHERE s.task_identifier = 'm0154_probe_task' AND s.occurrences >= 1
  ) THEN
    RAISE EXCEPTION '0154: job_failure_summary() did not name the planted task in its top reasons';
  END IF;
  DELETE FROM keystone_meta.job_failure WHERE job_id = -987654321;

  -- NEGATIVE CONTROL, same test: once acknowledged, it must not be counted.
  INSERT INTO keystone_meta.job_failure (job_id, task_identifier, job_created_at, tenant_id, reason, acknowledged_at, acknowledged_by, acknowledge_reason)
  VALUES (-987654322, 'm0154_probe_task_acked', now(), NULL, 'planted acknowledged', now(), 'system', 'probe cleanup');
  SELECT * INTO probe FROM keystone_meta.job_failure_summary();
  IF EXISTS (SELECT 1 FROM keystone_meta.job_failure_summary() s WHERE s.task_identifier = 'm0154_probe_task_acked') THEN
    RAISE EXCEPTION '0154: job_failure_summary() counted an ACKNOWLEDGED failure';
  END IF;
  DELETE FROM keystone_meta.job_failure WHERE job_id = -987654322;

  -- POSITIVE CONTROL 2 · claim_daily_summary(): first claim for a date wins, second is refused.
  SELECT keystone_meta.claim_daily_summary('2000-01-01'::date) INTO claim1;
  SELECT keystone_meta.claim_daily_summary('2000-01-01'::date) INTO claim2;
  IF claim1 IS DISTINCT FROM true OR claim2 IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0154: claim_daily_summary did not send-once (first=%, second=%)', claim1, claim2;
  END IF;
  -- A different date is its own claim, unaffected by the first.
  IF keystone_meta.claim_daily_summary('2000-01-02'::date) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0154: claim_daily_summary refused a DIFFERENT date';
  END IF;
  DELETE FROM keystone_meta.daily_summary_sent WHERE summary_date IN ('2000-01-01', '2000-01-02');
END $$;
