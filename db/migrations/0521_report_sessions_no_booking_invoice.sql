-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0521 · the Sessions report stops reading booking.invoice_id (R1, RECONCILE 27 Sep 2026).
--
-- 0513 dropped keystone.booking.invoice_id. report_sessions (0508) still read it inside two EXECUTE
-- format(...) strings — dynamic SQL, so the DROP COLUMN could not see the dependency, and every call
-- after 0513 raised `column "invoice_id" does not exist`. A booking reaches its charge through 0512's
-- line_item.booking_id REFERENCE instead:
--   · no_show_charged_count — "a line on an invoice references this booking" (EXISTS, any status —
--     the same answer the old pointer gave, since voiding never cleared it).
--   · no_show_value_minor — the SUM over DISTINCT no-show invoices whose lines reference the range's
--     no-show bookings (IN, so an invoice with two lines for one booking is counted once).
-- Everything else is 0508's body, verbatim (pg_get_functiondef). CREATE OR REPLACE keeps the owner and
-- the grants. No BEGIN/COMMIT — db/migrate.mjs owns the transaction (R8).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.report_sessions(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'keystone', 'pg_temp'
AS $function$
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
  v_host_filter_b text;
BEGIN
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_all := keystone.user_may(p_viewer, 'engagement', 'view', NULL);

  v_host_filter := CASE WHEN v_all THEN '1=1' ELSE format('booking.host_id = %L', p_viewer) END;
  -- ★ F781 — the queries below that alias booking as `b` cannot name `booking.` (Postgres: "invalid reference to
  --   FROM-clause entry for table booking"), so every Team member's call was a 500. They get `b.host_id`.
  v_host_filter_b := CASE WHEN v_all THEN '1=1' ELSE format('b.host_id = %L', p_viewer) END;

  -- ★ FIX (0506): every "<@ %L" built from p_range/p_compare now casts the rendered
  --   literal to ::daterange explicitly — %L renders an untyped text literal, and
  --   Postgres cannot pick a <@ operator between date and unknown ("operator is not
  --   unique"). No other clause in these EXECUTE strings changed.
  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L::daterange AND %s',
    p_tenant, 'completed', p_range, v_host_filter
  ) INTO v_held;

  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L::daterange AND %s',
    p_tenant, 'completed', p_compare, v_host_filter
  ) INTO v_held_compare;

  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L::daterange AND %s',
    p_tenant, 'no_show', p_range, v_host_filter
  ) INTO v_no_shows;

  EXECUTE format(
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L::daterange ' ||
    'AND EXISTS (SELECT 1 FROM keystone.line_item li WHERE li.tenant_id = booking.tenant_id AND li.booking_id = booking.id AND li.invoice_id IS NOT NULL) AND %s',
    p_tenant, 'no_show', p_range, v_host_filter
  ) INTO v_no_show_charged_count;

  EXECUTE format(
    'SELECT COALESCE(SUM(i.amount_minor), 0) FROM keystone.invoice i WHERE i.tenant_id = %L AND i.source = %L AND i.id IN (' ||
    'SELECT li.invoice_id FROM keystone.line_item li JOIN keystone.booking b ON b.tenant_id = li.tenant_id AND b.id = li.booking_id ' ||
    'WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND %s)',
    p_tenant, 'no_show', p_tenant, 'no_show', p_range, v_host_filter_b
  ) INTO v_no_show_value_minor;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::bigint
    INTO v_booked_minutes
    FROM keystone.booking
   WHERE tenant_id = p_tenant
     AND state = 'completed'
     AND starts_at::date <@ p_range
     AND (v_all OR host_id = p_viewer);

  SELECT COALESCE(SUM(available), 0)::bigint INTO v_available_minutes
    FROM (
      SELECT (d::date - lower(p_range)::date + 1) * SUM(ar.end_minute - ar.start_minute) AS available
        FROM generate_series(lower(p_range)::date, upper(p_range)::date - INTERVAL '1 day'::interval, '1 day'::interval) d
        JOIN keystone.availability_rule ar ON ar.tenant_id = p_tenant
          AND ar.day_of_week = EXTRACT(DOW FROM d)::smallint
          AND ar.effective_from <= d::date
          AND (ar.effective_to IS NULL OR ar.effective_to >= d::date)
          AND (v_all OR ar.host_id = p_viewer)
       GROUP BY d
    ) daily;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::bigint
    INTO v_booked_minutes_compare
    FROM keystone.booking
   WHERE tenant_id = p_tenant
     AND state = 'completed'
     AND starts_at::date <@ p_compare
     AND (v_all OR host_id = p_viewer);

  SELECT COALESCE(SUM(available), 0)::bigint INTO v_available_minutes_compare
    FROM (
      SELECT (d::date - lower(p_compare)::date + 1) * SUM(ar.end_minute - ar.start_minute) AS available
        FROM generate_series(lower(p_compare)::date, upper(p_compare)::date - INTERVAL '1 day'::interval, '1 day'::interval) d
        JOIN keystone.availability_rule ar ON ar.tenant_id = p_tenant
          AND ar.day_of_week = EXTRACT(DOW FROM d)::smallint
          AND ar.effective_from <= d::date
          AND (ar.effective_to IS NULL OR ar.effective_to >= d::date)
          AND (v_all OR ar.host_id = p_viewer)
       GROUP BY d
    ) daily;

  v_booked_share_pct := CASE
    WHEN v_available_minutes = 0 THEN 0
    ELSE ROUND((v_booked_minutes::numeric / v_available_minutes * 100), 2)
  END;

  v_booked_share_compare_pct := CASE
    WHEN v_available_minutes_compare = 0 THEN 0
    ELSE ROUND((v_booked_minutes_compare::numeric / v_available_minutes_compare * 100), 2)
  END;

  -- ★ FIX (0506): all three of these (by_weekday/no_show_rows/by_location) had the same
  --   nested-aggregate shape as report_money/report_people above — jsonb_agg(jsonb_build_object(
  --   ..., COUNT(*))) at the same query level — reached only once the <@ unknown-cast bug
  --   above stopped raising first. Each now computes COUNT(*) in an inner GROUP BY subquery
  --   and jsonb_agg's the already-collapsed rows in the outer query, with ORDER BY moved onto
  --   jsonb_agg so the same row order is preserved. Output shape/keys unchanged.
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, dow, %L, cnt) ORDER BY dow), %L::jsonb) ' ||
    'FROM (SELECT EXTRACT(DOW FROM b.starts_at)::smallint AS dow, COUNT(*) AS cnt ' ||
    'FROM keystone.booking b WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND %s ' ||
    'GROUP BY EXTRACT(DOW FROM b.starts_at)) grouped',
    'dow', 'count', '[]', p_tenant, 'completed', p_range, v_host_filter_b
  ) INTO v_by_weekday;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, person_id, %L, display_name, %L, cnt) ORDER BY cnt DESC), %L::jsonb) ' ||
    'FROM (SELECT bp.app_user_id AS person_id, bp.display_name AS display_name, COUNT(*) AS cnt ' ||
    'FROM keystone.booking b JOIN keystone.booking_participant bp ON bp.tenant_id = b.tenant_id AND bp.booking_id = b.id ' ||
    -- ★ FIX (0506): keystone.booking_participant has no "role" column — it is "party"
    --   ("bp.role does not exist"), reached only once the <@ unknown-cast bug above stopped
    --   raising first. 'client' is a valid keystone.booking_participant_party_check value,
    --   same intent (no-show rows counted for the client party), just the correct column name.
    'WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND bp.party = %L AND %s ' ||
    'GROUP BY bp.app_user_id, bp.display_name) grouped',
    'person_id', 'display_name', 'count', '[]', p_tenant, 'no_show', p_range, 'client', v_host_filter_b
  ) INTO v_no_show_rows;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, location_kind, %L, cnt) ORDER BY cnt DESC), %L::jsonb) ' ||
    'FROM (SELECT b.location_kind AS location_kind, COUNT(*) AS cnt ' ||
    'FROM keystone.booking b WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND %s ' ||
    'GROUP BY b.location_kind) grouped',
    'location_kind', 'count', '[]', p_tenant, 'completed', p_range, v_host_filter_b
  ) INTO v_by_location;

  v_enough_data := keystone.report_enough_data(p_tenant);

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
$function$;
