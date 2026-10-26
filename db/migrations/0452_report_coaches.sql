-- 0452_report_coaches
--
-- Stage 16 task 16.11 — the coaches report: staff with role='staff' who host bookings, with
-- own-row-only scope for coaches and optional earned_minor based on 'invoice' 'view' permission.
--
-- One function: keystone.report_coaches(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
-- RETURNS jsonb. LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0452: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  -- Verify source tables exist
  IF to_regclass('keystone.app_user') IS NULL THEN
    RAISE EXCEPTION '0452: keystone.app_user does not exist';
  END IF;
  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0452: keystone.booking does not exist';
  END IF;
  IF to_regclass('keystone.availability_rule') IS NULL THEN
    RAISE EXCEPTION '0452: keystone.availability_rule does not exist';
  END IF;
  IF to_regclass('keystone.payment') IS NULL THEN
    RAISE EXCEPTION '0452: keystone.payment does not exist';
  END IF;
  IF to_regclass('keystone.invoice') IS NULL THEN
    RAISE EXCEPTION '0452: keystone.invoice does not exist';
  END IF;
  IF to_regclass('keystone.line_item') IS NULL THEN
    RAISE EXCEPTION '0452: keystone.line_item does not exist';
  END IF;

  -- Verify keystone.user_may exists with correct signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'user_may' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0452: keystone.user_may(uuid, text, text, uuid) does not exist';
  END IF;

  -- Verify keystone.report_enough_data exists (defined in migration 0448)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'report_enough_data' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 1
  ) THEN
    RAISE EXCEPTION '0452: keystone.report_enough_data(uuid) does not exist';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § A · keystone.report_coaches(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
--       RETURNS jsonb
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.report_coaches(
  p_tenant uuid,
  p_range daterange,
  p_compare daterange,
  p_viewer uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp
AS $$
DECLARE
  v_money boolean;
  v_all boolean;
  v_enough_data jsonb;
  v_rows jsonb;
BEGIN
  -- ★ Tenant mismatch guard: first statement after function entry.
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Compute scope checks
  v_money := keystone.user_may(p_viewer, 'invoice', 'view', NULL);
  v_all := keystone.user_may(p_viewer, 'engagement', 'view', NULL);

  -- Get enough_data from helper
  v_enough_data := keystone.report_enough_data(p_tenant);

  -- Build rows: coaches (staff who host bookings) with stats
  -- If v_all is false, filter to only p_viewer's row
  -- If v_money is false, omit earned_minor from each row
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN v_money THEN jsonb_build_object(
        'coach_id', coach_id,
        'display_name', display_name,
        'sessions', sessions,
        'hours_booked', hours_booked,
        'available_hours', available_hours,
        'utilisation_pct', utilisation_pct,
        'no_shows', no_shows,
        'earned_minor', earned_minor
      )
      ELSE jsonb_build_object(
        'coach_id', coach_id,
        'display_name', display_name,
        'sessions', sessions,
        'hours_booked', hours_booked,
        'available_hours', available_hours,
        'utilisation_pct', utilisation_pct,
        'no_shows', no_shows
      )
    END
  ), '[]'::jsonb) INTO v_rows
  FROM (
    -- Main query: coaches with their statistics
    WITH coach_bookings AS (
      SELECT
        au.id AS coach_id,
        au.display_name,
        COUNT(DISTINCT b.id) FILTER (WHERE b.state = 'completed' AND b.starts_at::date <@ p_range) AS sessions,
        EXTRACT(EPOCH FROM SUM(b.ends_at - b.starts_at) FILTER (WHERE b.state = 'completed' AND b.starts_at::date <@ p_range)) / 3600.0 AS hours_booked,  -- REHEARSAL FIX: FILTER binds to the aggregate, not the division
        COUNT(*) FILTER (WHERE b.state = 'no_show' AND b.starts_at::date <@ p_range) AS no_shows
      FROM keystone.app_user au
      LEFT JOIN keystone.booking b ON b.tenant_id = au.tenant_id AND b.host_id = au.id
      WHERE au.tenant_id = p_tenant
        AND au.role = 'staff'
        AND (EXISTS (SELECT 1 FROM keystone.booking WHERE keystone.booking.tenant_id = p_tenant AND keystone.booking.host_id = au.id)
          OR EXISTS (SELECT 1 FROM keystone.availability_rule WHERE keystone.availability_rule.tenant_id = p_tenant AND keystone.availability_rule.host_id = au.id))
        AND (v_all OR au.id = p_viewer)
      GROUP BY au.id, au.display_name
    ),
    coach_availability AS (
      SELECT
        ar.host_id AS coach_id,
        SUM((ar.end_minute - ar.start_minute)::numeric) / 60.0 AS available_hours
      FROM keystone.availability_rule ar
      WHERE ar.tenant_id = p_tenant
        AND ar.effective_from::date <= upper(p_range)
        AND (ar.effective_to IS NULL OR ar.effective_to::date >= lower(p_range))
      GROUP BY ar.host_id
    ),
    coach_earnings AS (
      SELECT
        b.host_id AS coach_id,
        COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status = 'succeeded'), 0) AS earned_minor
      FROM keystone.booking b
      JOIN keystone.line_item li ON li.tenant_id = b.tenant_id AND li.booking_id = b.id
      JOIN keystone.invoice i ON i.tenant_id = b.tenant_id AND i.id = li.invoice_id
      JOIN keystone.payment p ON p.tenant_id = b.tenant_id AND p.invoice_id = i.id
      WHERE b.tenant_id = p_tenant
      GROUP BY b.host_id
    )
    SELECT
      cb.coach_id,
      cb.display_name,
      COALESCE(cb.sessions, 0) AS sessions,
      COALESCE(cb.hours_booked, 0.0)::numeric AS hours_booked,
      COALESCE(ca.available_hours, 0.0)::numeric AS available_hours,
      CASE
        WHEN COALESCE(ca.available_hours, 0.0) = 0 THEN 0.0
        ELSE (COALESCE(cb.hours_booked, 0.0) / COALESCE(ca.available_hours, 0.0)) * 100.0
      END::numeric AS utilisation_pct,
      COALESCE(cb.no_shows, 0) AS no_shows,
      COALESCE(ce.earned_minor, 0) AS earned_minor
    FROM coach_bookings cb
    LEFT JOIN coach_availability ca ON ca.coach_id = cb.coach_id
    LEFT JOIN coach_earnings ce ON ce.coach_id = cb.coach_id
    ORDER BY cb.display_name
  ) coach_stats;

  -- Return the complete report object
  RETURN jsonb_build_object(
    'range', p_range::text,
    'compare', p_compare::text,
    'enough_data', v_enough_data,
    'rows', v_rows
  );
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § B · GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION keystone.report_coaches(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_coaches(uuid, daterange, daterange, uuid) FROM PUBLIC;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)
-- Written, not applied.
