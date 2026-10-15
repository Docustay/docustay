-- 0450_report_sessions
--
-- Stage 16 task 16.9 — sessions report function with in-function coach scoping.
--
-- One function: keystone.report_sessions(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
-- RETURNS jsonb. LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp.
-- Scope computed IN the function: v_all = keystone.user_may(p_viewer,'engagement','view',NULL).
-- When false, aggregates filter to booking.host_id = p_viewer and the no_show_value_minor field is omitted.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0450: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  -- Verify source tables exist
  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0450: keystone.booking does not exist';
  END IF;
  IF to_regclass('keystone.booking_participant') IS NULL THEN
    RAISE EXCEPTION '0450: keystone.booking_participant does not exist';
  END IF;
  IF to_regclass('keystone.availability_rule') IS NULL THEN
    RAISE EXCEPTION '0450: keystone.availability_rule does not exist';
  END IF;
  IF to_regclass('keystone.app_user') IS NULL THEN
    RAISE EXCEPTION '0450: keystone.app_user does not exist';
  END IF;

  -- Verify keystone.user_may exists with correct signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'user_may' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0450: keystone.user_may(uuid, text, text, uuid) does not exist';
  END IF;

  -- Verify report_enough_data exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'report_enough_data' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 1
  ) THEN
    RAISE EXCEPTION '0450: keystone.report_enough_data(uuid) does not exist';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § A · keystone.report_sessions
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.report_sessions(
  p_tenant uuid,
  p_range daterange,
  p_compare daterange,
  p_viewer uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp
AS $$
DECLARE
  v_all boolean;
  v_held bigint;
  v_held_compare bigint;
  v_no_shows bigint;
  v_no_show_charged_count bigint;
  v_no_show_value_minor bigint;
  v_booked_minutes bigint;
  v_available_minutes bigint;
  v_booked_minutes_compare bigint;
  v_available_minutes_compare bigint;
  v_booked_share_pct numeric;
  v_booked_share_compare_pct numeric;
  v_by_weekday jsonb;
  v_no_show_rows jsonb;
  v_by_location jsonb;
  v_enough_data jsonb;
  v_host_filter text;
BEGIN
  -- ★ Tenant mismatch guard: first statement after function entry.
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ★ Scope check: determine if viewer can see all engagements or only their own
  v_all := keystone.user_may(p_viewer, 'engagement', 'view', NULL);

  -- ★ Build the host_id filter condition for use in aggregates when not v_all
  v_host_filter := CASE WHEN v_all THEN '1=1' ELSE format('booking.host_id = %L', p_viewer) END;

  -- ─ Held (completed) bookings in range
  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L AND %s',
    p_tenant, 'completed', p_range, v_host_filter
  ) INTO v_held;

  -- ─ Held (completed) bookings in compare range
  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L AND %s',
    p_tenant, 'completed', p_compare, v_host_filter
  ) INTO v_held_compare;

  -- ─ No-show bookings in range
  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L AND %s',
    p_tenant, 'no_show', p_range, v_host_filter
  ) INTO v_no_shows;

  -- ─ No-show bookings that resulted in a charge (have invoice_id set)
  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L AND invoice_id IS NOT NULL AND %s',
    p_tenant, 'no_show', p_range, v_host_filter
  ) INTO v_no_show_charged_count;

  -- ─ No-show value (sum of invoice amounts for charged no-shows in range)
  EXECUTE format(
    'SELECT COALESCE(SUM(i.amount_minor), 0) FROM keystone.booking b JOIN keystone.invoice i ON i.id = b.invoice_id WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L AND i.source = %L AND %s',
    p_tenant, 'no_show', p_range, 'no_show', v_host_filter
  ) INTO v_no_show_value_minor;

  -- ─ Booked minutes in range: sum of (booking duration in minutes)
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::bigint
    INTO v_booked_minutes
    FROM keystone.booking
   WHERE tenant_id = p_tenant
     AND state = 'completed'
     AND starts_at::date <@ p_range;

  -- ─ Available minutes in range from availability_rule over the date range
  -- For each day in the range, find the rule(s) that apply and sum available minutes
  SELECT COALESCE(SUM(available), 0)::bigint INTO v_available_minutes
    FROM (
      SELECT (d::date - lower(p_range)::date + 1) * SUM(ar.end_minute - ar.start_minute) AS available
        FROM generate_series(lower(p_range)::date, upper(p_range)::date - INTERVAL '1 day'::interval, '1 day'::interval) d
        JOIN keystone.availability_rule ar ON ar.tenant_id = p_tenant
          AND ar.day_of_week = EXTRACT(DOW FROM d)::smallint
          AND ar.effective_from <= d::date
          AND (ar.effective_to IS NULL OR ar.effective_to >= d::date)
       GROUP BY d
    ) daily;

  -- ─ Booked minutes in compare range
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::bigint
    INTO v_booked_minutes_compare
    FROM keystone.booking
   WHERE tenant_id = p_tenant
     AND state = 'completed'
     AND starts_at::date <@ p_compare;

  -- ─ Available minutes in compare range
  SELECT COALESCE(SUM(available), 0)::bigint INTO v_available_minutes_compare
    FROM (
      SELECT (d::date - lower(p_compare)::date + 1) * SUM(ar.end_minute - ar.start_minute) AS available
        FROM generate_series(lower(p_compare)::date, upper(p_compare)::date - INTERVAL '1 day'::interval, '1 day'::interval) d
        JOIN keystone.availability_rule ar ON ar.tenant_id = p_tenant
          AND ar.day_of_week = EXTRACT(DOW FROM d)::smallint
          AND ar.effective_from <= d::date
          AND (ar.effective_to IS NULL OR ar.effective_to >= d::date)
       GROUP BY d
    ) daily;

  -- ─ Calculate booked share percentages
  v_booked_share_pct := CASE
    WHEN v_available_minutes = 0 THEN 0
    ELSE ROUND((v_booked_minutes::numeric / v_available_minutes * 100), 2)
  END;

  v_booked_share_compare_pct := CASE
    WHEN v_available_minutes_compare = 0 THEN 0
    ELSE ROUND((v_booked_minutes_compare::numeric / v_available_minutes_compare * 100), 2)
  END;

  -- ─ By weekday: count of completed bookings per day of week
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, EXTRACT(DOW FROM b.starts_at)::smallint, %L, COUNT(*))), %L::jsonb) ' ||
    'FROM keystone.booking b WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L AND %s ' ||
    'GROUP BY EXTRACT(DOW FROM b.starts_at) ORDER BY EXTRACT(DOW FROM b.starts_at)',
    'dow', 'count', '[]', p_tenant, 'completed', p_range, v_host_filter
  ) INTO v_by_weekday;

  -- ─ No-show rows: count of no-shows per person
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, bp.app_user_id, %L, bp.display_name, %L, COUNT(*))), %L::jsonb) ' ||
    'FROM keystone.booking b JOIN keystone.booking_participant bp ON bp.tenant_id = b.tenant_id AND bp.booking_id = b.id ' ||
    'WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L AND bp.role = %L AND %s ' ||
    'GROUP BY bp.app_user_id, bp.display_name ORDER BY COUNT(*) DESC',
    'person_id', 'display_name', 'count', '[]', p_tenant, 'no_show', p_range, 'client', v_host_filter
  ) INTO v_no_show_rows;

  -- ─ By location: count of completed bookings per location kind
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, b.location_kind, %L, COUNT(*))), %L::jsonb) ' ||
    'FROM keystone.booking b WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L AND %s ' ||
    'GROUP BY b.location_kind ORDER BY COUNT(*) DESC',
    'location_kind', 'count', '[]', p_tenant, 'completed', p_range, v_host_filter
  ) INTO v_by_location;

  -- Get enough_data from helper
  v_enough_data := keystone.report_enough_data(p_tenant);

  -- ★★★ Build response object, conditionally including no_show_value_minor only if v_all is true
  -- (when v_all is false, the field is completely omitted from the JSON object)
  IF v_all THEN
    RETURN jsonb_build_object(
      'range', p_range::text,
      'compare', p_compare::text,
      'enough_data', v_enough_data,
      'held', v_held,
      'held_compare', v_held_compare,
      'no_shows', v_no_shows,
      'no_show_value_minor', v_no_show_value_minor,
      'no_show_charged_count', v_no_show_charged_count,
      'booked_share_pct', v_booked_share_pct,
      'booked_share_compare_pct', v_booked_share_compare_pct,
      'by_weekday', v_by_weekday,
      'no_show_rows', v_no_show_rows,
      'by_location', v_by_location
    );
  ELSE
    RETURN jsonb_build_object(
      'range', p_range::text,
      'compare', p_compare::text,
      'enough_data', v_enough_data,
      'held', v_held,
      'held_compare', v_held_compare,
      'no_shows', v_no_shows,
      'no_show_charged_count', v_no_show_charged_count,
      'booked_share_pct', v_booked_share_pct,
      'booked_share_compare_pct', v_booked_share_compare_pct,
      'by_weekday', v_by_weekday,
      'no_show_rows', v_no_show_rows,
      'by_location', v_by_location
    );
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § B · GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION keystone.report_sessions(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_sessions(uuid, daterange, daterange, uuid) FROM PUBLIC;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)
-- Written, not applied.
