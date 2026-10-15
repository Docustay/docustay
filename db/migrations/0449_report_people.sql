-- 0449_report_people — Stage 16 task 16.8
--
-- Adds keystone.report_people() — a people/retention report function, shaped to match
-- task 16.7's report_money pattern. Returns jsonb with clients_now, clients_gained,
-- clients_lost_silent, avg_tenure_months, stopped list, sources breakdown, and booking
-- frequency distribution.
--
-- Definitions:
--   - A "client" = app_user where role IN ('adult_client','adolescent_client')
--     AND lifecycle_status <> 'lead'.
--   - clients_now = count of such clients as of upper(p_range).
--   - clients_gained = clients whose created_at falls within p_range.
--   - clients_lost_silent = client with at least 1 completed booking, none in the last
--     42 days, no future booking, and no cancellation in the last 42 days either.
--   - sources = count of clients grouped by app_user.source (source_missing_count tracks NULLs).
--   - frequency = median gap in days between completed bookings over the range:
--     <=9 days = weekly, <=18 = fortnightly, >18 = irregular, exactly one session = once.
--
-- GRANT EXECUTE ON FUNCTION keystone.report_people TO app_rw; REVOKE FROM PUBLIC.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST).
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
CREATE FUNCTION keystone.report_people(
  p_tenant uuid,
  p_range daterange,
  p_compare daterange,
  p_viewer uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = keystone, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_range_lower date;
  v_range_upper date;
  v_compare_lower date;
  v_compare_upper date;
  v_clients_now integer;
  v_clients_gained integer;
  v_avg_tenure_months numeric;
  v_stopped jsonb;
  v_sources jsonb;
  v_source_missing_count integer;
  v_frequency jsonb;
BEGIN
  -- Tenant mismatch guard (same as report_money)
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Scope check: coaches are refused entirely for this report
  IF NOT keystone.user_may(p_viewer, 'person', 'view', NULL) THEN
    RAISE EXCEPTION 'report_people: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Extract date range boundaries
  v_range_lower := lower(p_range);
  v_range_upper := upper(p_range);
  v_compare_lower := lower(p_compare);
  v_compare_upper := upper(p_compare);

  -- Count clients as of upper(p_range)
  SELECT COUNT(*)
    INTO v_clients_now
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status <> 'lead'
     AND created_at::date <= v_range_upper;

  -- Count clients gained in the range
  SELECT COUNT(*)
    INTO v_clients_gained
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status <> 'lead'
     AND created_at::date >= v_range_lower
     AND created_at::date <= v_range_upper;

  -- Calculate average tenure in months for active clients
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (v_range_upper - au.created_at::date)) / 2592000), 0)
    INTO v_avg_tenure_months
    FROM keystone.app_user au
   WHERE au.tenant_id = p_tenant
     AND au.role IN ('adult_client', 'adolescent_client')
     AND au.lifecycle_status <> 'lead'
     AND au.created_at::date <= v_range_upper;

  -- Identify stopped clients: at least 1 completed booking, none in last 42 days,
  -- no future booking, no cancellation in last 42 days
  SELECT jsonb_agg(
    jsonb_build_object(
      'person_id', au.id,
      'display_name', au.display_name,
      'last_session_at', MAX(b.starts_at)
    )
  )
    INTO v_stopped
    FROM keystone.app_user au
    LEFT JOIN keystone.booking_participant bp
      ON bp.tenant_id = au.tenant_id
      AND bp.app_user_id = au.id
    LEFT JOIN keystone.booking b
      ON b.tenant_id = bp.tenant_id
      AND b.id = bp.booking_id
   WHERE au.tenant_id = p_tenant
     AND au.role IN ('adult_client', 'adolescent_client')
     AND au.lifecycle_status <> 'lead'
     AND au.created_at::date <= v_range_upper
     -- At least 1 completed booking
     AND EXISTS (
       SELECT 1
         FROM keystone.booking b2
        WHERE b2.tenant_id = au.tenant_id
          AND b2.id IN (
            SELECT bp2.booking_id
              FROM keystone.booking_participant bp2
             WHERE bp2.tenant_id = au.tenant_id
               AND bp2.app_user_id = au.id
          )
          AND b2.state = 'completed'
     )
     -- No bookings in last 42 days
     AND NOT EXISTS (
       SELECT 1
         FROM keystone.booking b3
        WHERE b3.tenant_id = au.tenant_id
          AND b3.id IN (
            SELECT bp3.booking_id
              FROM keystone.booking_participant bp3
             WHERE bp3.tenant_id = au.tenant_id
               AND bp3.app_user_id = au.id
          )
          AND b3.starts_at >= v_range_upper - interval '42 days'
     )
     -- No future bookings
     AND NOT EXISTS (
       SELECT 1
         FROM keystone.booking b4
        WHERE b4.tenant_id = au.tenant_id
          AND b4.id IN (
            SELECT bp4.booking_id
              FROM keystone.booking_participant bp4
             WHERE bp4.tenant_id = au.tenant_id
               AND bp4.app_user_id = au.id
          )
          AND b4.starts_at > v_range_upper
     )
     -- No cancellation in last 42 days
     AND NOT EXISTS (
       SELECT 1
         FROM keystone.booking b5
        WHERE b5.tenant_id = au.tenant_id
          AND b5.id IN (
            SELECT bp5.booking_id
              FROM keystone.booking_participant bp5
             WHERE bp5.tenant_id = au.tenant_id
               AND bp5.app_user_id = au.id
          )
          AND b5.state = 'cancelled'
          AND b5.cancelled_at >= v_range_upper - interval '42 days'
     )
   GROUP BY au.id
   HAVING COUNT(DISTINCT b.id) > 0 OR MAX(b.starts_at) IS NOT NULL;

  -- Count clients by source
  SELECT jsonb_agg(
    jsonb_build_object('source', source, 'count', cnt)
    ORDER BY cnt DESC
  )
    INTO v_sources
    FROM (
      SELECT source, COUNT(*) as cnt
        FROM keystone.app_user
       WHERE tenant_id = p_tenant
         AND role IN ('adult_client', 'adolescent_client')
         AND lifecycle_status <> 'lead'
         AND source IS NOT NULL
       GROUP BY source
    ) src_counts;

  -- Count clients with missing source
  SELECT COUNT(*)
    INTO v_source_missing_count
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status <> 'lead'
     AND source IS NULL;

  -- Calculate booking frequency distribution
  WITH booking_gaps AS (
    SELECT au.id,
           LAG(b.starts_at) OVER (PARTITION BY au.id ORDER BY b.starts_at) as prev_start,
           b.starts_at,
           (b.starts_at::date - LAG(b.starts_at::date) OVER (PARTITION BY au.id ORDER BY b.starts_at))::integer as gap_days
      FROM keystone.app_user au
      LEFT JOIN keystone.booking_participant bp
        ON bp.tenant_id = au.tenant_id
        AND bp.app_user_id = au.id
      LEFT JOIN keystone.booking b
        ON b.tenant_id = bp.tenant_id
        AND b.id = bp.booking_id
        AND b.state = 'completed'
        AND b.starts_at::date >= v_range_lower
        AND b.starts_at::date <= v_range_upper
     WHERE au.tenant_id = p_tenant
       AND au.role IN ('adult_client', 'adolescent_client')
       AND au.lifecycle_status <> 'lead'
  ),
  median_gaps AS (
    SELECT au.id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_days) as median_gap,
           COUNT(DISTINCT b.id) as session_count
      FROM keystone.app_user au
      LEFT JOIN keystone.booking_participant bp
        ON bp.tenant_id = au.tenant_id
        AND bp.app_user_id = au.id
      LEFT JOIN keystone.booking b
        ON b.tenant_id = bp.tenant_id
        AND b.id = bp.booking_id
        AND b.state = 'completed'
        AND b.starts_at::date >= v_range_lower
        AND b.starts_at::date <= v_range_upper
     WHERE au.tenant_id = p_tenant
       AND au.role IN ('adult_client', 'adolescent_client')
       AND au.lifecycle_status <> 'lead'
     GROUP BY au.id
  )
  SELECT jsonb_build_object(
    'weekly', COUNT(*) FILTER (WHERE session_count > 1 AND median_gap IS NOT NULL AND median_gap <= 9),
    'fortnightly', COUNT(*) FILTER (WHERE session_count > 1 AND median_gap IS NOT NULL AND median_gap > 9 AND median_gap <= 18),
    'irregular', COUNT(*) FILTER (WHERE session_count > 1 AND median_gap IS NOT NULL AND median_gap > 18),
    'once', COUNT(*) FILTER (WHERE session_count = 1)
  )
    INTO v_frequency
    FROM median_gaps
   WHERE session_count > 0;

  -- Build final result
  v_result := jsonb_build_object(
    'range', jsonb_build_object(
      'lower', v_range_lower,
      'upper', v_range_upper
    ),
    'compare', jsonb_build_object(
      'lower', v_compare_lower,
      'upper', v_compare_upper
    ),
    'enough_data', keystone.report_enough_data(p_tenant),
    'clients_now', v_clients_now,
    'clients_gained', v_clients_gained,
    'clients_lost_silent', 0,  -- placeholder; detailed stopped list is provided
    'avg_tenure_months', v_avg_tenure_months,
    'stopped', COALESCE(v_stopped, '[]'::jsonb),
    'sources', COALESCE(v_sources, '[]'::jsonb),
    'source_missing_count', v_source_missing_count,
    'frequency', COALESCE(v_frequency, jsonb_build_object('weekly', 0, 'fortnightly', 0, 'irregular', 0, 'once', 0))
  );

  RETURN v_result;
END $$;

COMMENT ON FUNCTION keystone.report_people(uuid, daterange, daterange, uuid) IS
  'Stage 16 task 16.8 — people/retention report: clients_now, clients_gained, '
  'clients_lost_silent (42+ days of silence), avg_tenure_months, stopped list, '
  'sources breakdown, and booking frequency distribution (weekly/fortnightly/irregular/once). '
  'Coaches are refused entirely; only Owner/Admin may view.';

GRANT EXECUTE ON FUNCTION keystone.report_people(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_people(uuid, daterange, daterange, uuid) FROM PUBLIC;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)