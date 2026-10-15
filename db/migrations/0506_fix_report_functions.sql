-- 0506_fix_report_functions
--
-- F-report-500s — three report functions (0448 report_money, 0449 report_people,
-- 0450 report_sessions) return 500 on every call. 0448/0449/0450 are APPLIED and
-- IMMUTABLE; this migration CREATE OR REPLACE's the same three functions, matching
-- their current live signatures/SECURITY/search_path/grants exactly, changing ONLY
-- what each error requires:
--
--   report_money    — 'by_month' built SUM(amount_minor) and jsonb_agg(...) in the
--                      SAME query level ("aggregate function calls cannot be nested").
--                      Fixed by doing the per-month SUM in an inner GROUP BY subquery,
--                      then jsonb_agg-ing the already-aggregated rows in the outer query.
--                      Output shape unchanged: [{month, collected_minor}, ...].
--
--   report_people   — v_avg_tenure_months used EXTRACT(EPOCH FROM (date - date)); date
--                      minus date is already an INTEGER number of days in Postgres, not
--                      an interval, so EXTRACT(EPOCH FROM ...) has no matching function.
--                      Fixed by dividing the day count directly by 30.44 (days/month)
--                      instead of dividing epoch-seconds by 2592000 (seconds/month) —
--                      same unit out (avg_tenure_months, read by
--                      webui/src/lib/screens/reports/ReportPeople.svelte:142 as months),
--                      just reached without the invalid EXTRACT call.
--
--   report_sessions — six dynamic EXECUTE format() strings compared
--                      "starts_at::date <@ %L" where %L renders p_range/p_compare as an
--                      untyped text literal, so Postgres can't pick a <@ operator
--                      ("operator is not unique: date <@ unknown"). Fixed by adding an
--                      explicit ::daterange cast onto every such literal in the built
--                      SQL text. No other clause in these EXECUTE strings changed.
--
-- Nothing else about any of the three functions changes: same parameters, same
-- LANGUAGE/STABLE/SECURITY/search_path, same grants, same JSON keys, same scoping logic.
-- (Explicit BEGIN/COMMIT omitted — db/migrate.mjs wraps every file in its own transaction.)

DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0506: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'report_money' AND pronamespace = 'keystone'::regnamespace AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0506: keystone.report_money(uuid, daterange, daterange, uuid) does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'report_people' AND pronamespace = 'keystone'::regnamespace AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0506: keystone.report_people(uuid, daterange, daterange, uuid) does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'report_sessions' AND pronamespace = 'keystone'::regnamespace AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0506: keystone.report_sessions(uuid, daterange, daterange, uuid) does not exist';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § A · keystone.report_money — fix nested aggregate in by_month
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.report_money(
  p_tenant uuid,
  p_range daterange,
  p_compare daterange,
  p_viewer uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp
AS $$
DECLARE
  v_collected_minor bigint;
  v_collected_compare_minor bigint;
  v_still_owed_minor bigint;
  v_credits_liability_minor bigint;
  v_earned_minor bigint;
  v_owed_in_work_minor bigint;
  v_by_month jsonb;
  v_by_item jsonb;
  v_owed_by_person jsonb;
  v_enough_data jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT keystone.user_may(p_viewer, 'invoice', 'view', NULL) THEN
    RAISE EXCEPTION 'report_money: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0) INTO v_collected_minor
    FROM keystone.payment
   WHERE tenant_id = p_tenant
     AND status = 'succeeded'
     AND created_at::date <@ p_range;

  SELECT COALESCE(SUM(amount_minor), 0) INTO v_collected_compare_minor
    FROM keystone.payment
   WHERE tenant_id = p_tenant
     AND status = 'succeeded'
     AND created_at::date <@ p_compare;

  SELECT COALESCE(SUM(i.amount_minor), 0) INTO v_still_owed_minor
    FROM keystone.invoice i
   WHERE i.tenant_id = p_tenant
     AND i.status = 'open';

  WITH credit_values AS (
    SELECT ec.entitlement_id, e.line_item_id, e.total_credits,
           (li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0))::numeric / NULLIF(e.total_credits, 0) AS unit_value
      FROM keystone.entitlement_credit ec
      JOIN keystone.entitlement e ON e.id = ec.entitlement_id
      LEFT JOIN keystone.line_item li ON li.id = e.line_item_id
     WHERE e.tenant_id = p_tenant
       AND ec.status IN ('available', 'reserved')
       AND (e.expires_at IS NULL OR e.expires_at > now())
  )
  SELECT COALESCE(SUM((unit_value * 1)::bigint), 0) INTO v_owed_in_work_minor
    FROM credit_values;

  WITH credit_values AS (
    SELECT ec.entitlement_id, e.line_item_id, e.total_credits,
           (li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0))::numeric / NULLIF(e.total_credits, 0) AS unit_value
      FROM keystone.entitlement_credit ec
      JOIN keystone.entitlement e ON e.id = ec.entitlement_id
      LEFT JOIN keystone.line_item li ON li.id = e.line_item_id
     WHERE e.tenant_id = p_tenant
  )
  SELECT COALESCE(SUM(
    CASE
      WHEN ec.status = 'consumed' AND ec.consumed_at::date <@ p_range THEN (unit_value * 1)::bigint
      WHEN e.status = 'available' AND e.expires_at::date <@ p_range THEN (unit_value * 1)::bigint
      ELSE 0
    END
  ), 0) INTO v_earned_minor
    FROM credit_values cv
    JOIN keystone.entitlement_credit ec ON ec.entitlement_id = cv.entitlement_id
    JOIN keystone.entitlement e ON e.id = ec.entitlement_id;

  WITH credit_values AS (
    SELECT ec.entitlement_id, e.line_item_id, e.total_credits,
           (li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0))::numeric / NULLIF(e.total_credits, 0) AS unit_value
      FROM keystone.entitlement_credit ec
      JOIN keystone.entitlement e ON e.id = ec.entitlement_id
      LEFT JOIN keystone.line_item li ON li.id = e.line_item_id
     WHERE e.tenant_id = p_tenant
       AND ec.status IN ('available', 'reserved')
  )
  SELECT COALESCE(SUM((unit_value * 1)::bigint), 0) INTO v_credits_liability_minor
    FROM credit_values;

  -- ★ FIX (0506): SUM(amount_minor) moved into an inner GROUP BY subquery so jsonb_agg
  --   in the outer query aggregates already-collapsed rows instead of nesting with SUM.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', TO_CHAR(month_date, 'YYYY-MM'),
      'collected_minor', collected_minor
    )
    ORDER BY month_date
  ), '[]'::jsonb) INTO v_by_month
    FROM (
      SELECT DATE_TRUNC('month', p.created_at)::date AS month_date,
             COALESCE(SUM(p.amount_minor), 0) AS collected_minor
        FROM keystone.payment p
       WHERE p.tenant_id = p_tenant
         AND p.status = 'succeeded'
         AND p.created_at::date >= (upper(p_range) - INTERVAL '6 months')::date
         AND p.created_at::date < (upper(p_range))::date
       GROUP BY month_date
    ) grouped;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'item_name', item_name,
      'kind', item_kind,
      'count', item_count,
      'amount_minor', item_amount
    )
  ), '[]'::jsonb) INTO v_by_item
    FROM (
      SELECT
        COALESCE(li.name_snapshot, 'Unknown') AS item_name,
        CASE
          WHEN li.service_id IS NOT NULL THEN 'service'
          WHEN li.package_id IS NOT NULL THEN 'package'
          WHEN li.plan_id IS NOT NULL THEN 'plan'
          ELSE 'other'
        END AS item_kind,
        COUNT(*) AS item_count,
        COALESCE(SUM(li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0)), 0) AS item_amount
        FROM keystone.line_item li
        JOIN keystone.invoice i ON i.id = li.invoice_id
       WHERE i.tenant_id = p_tenant
         AND i.status IN ('open', 'paid')
         AND i.created_at::date <@ p_range
       GROUP BY item_name, item_kind
       ORDER BY item_amount DESC
    ) grouped;

  -- ★ FIX (0506): same nested-aggregate shape as by_month — SUM() and jsonb_agg() at the
  --   same query level, reached only once by_month above stopped raising first. Moved the
  --   GROUP BY SUM into an inner subquery so the outer jsonb_agg aggregates already-collapsed
  --   rows. Output shape unchanged: [{person_id, display_name, owed_minor}, ...] desc by owed.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'person_id', payer_user_id,
      'display_name', display_name,
      'owed_minor', owed_minor
    )
    ORDER BY owed_minor DESC
  ), '[]'::jsonb) INTO v_owed_by_person
    FROM (
      SELECT i.payer_user_id AS payer_user_id,
             au.display_name AS display_name,
             COALESCE(SUM(i.amount_minor), 0) AS owed_minor
        FROM keystone.invoice i
        LEFT JOIN keystone.app_user au ON au.id = i.payer_user_id
       WHERE i.tenant_id = p_tenant
         AND i.status = 'open'
       GROUP BY i.payer_user_id, au.display_name
    ) grouped;

  v_enough_data := keystone.report_enough_data(p_tenant);

  RETURN jsonb_build_object(
    'range', p_range::text,
    'compare', p_compare::text,
    'enough_data', v_enough_data,
    'collected_minor', v_collected_minor,
    'collected_compare_minor', v_collected_compare_minor,
    'by_month', v_by_month,
    'by_item', v_by_item,
    'costs', jsonb_build_object(
      'card_fees_minor', NULL,
      'bank_fees_minor', NULL,
      'ads_minor', NULL,
      'workbench_minor', NULL
    ),
    'still_owed_minor', v_still_owed_minor,
    'credits_liability_minor', v_credits_liability_minor,
    'earned_minor', v_earned_minor,
    'owed_in_work_minor', v_owed_in_work_minor,
    'owed_by_person', v_owed_by_person
  );
END
$$;

GRANT EXECUTE ON FUNCTION keystone.report_money(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_money(uuid, daterange, daterange, uuid) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § B · keystone.report_people — fix EXTRACT(EPOCH FROM (date - date))
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.report_people(
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
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT keystone.user_may(p_viewer, 'person', 'view', NULL) THEN
    RAISE EXCEPTION 'report_people: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_range_lower := lower(p_range);
  v_range_upper := upper(p_range);
  v_compare_lower := lower(p_compare);
  v_compare_upper := upper(p_compare);

  SELECT COUNT(*)
    INTO v_clients_now
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status <> 'lead'
     AND created_at::date <= v_range_upper;

  SELECT COUNT(*)
    INTO v_clients_gained
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status <> 'lead'
     AND created_at::date >= v_range_lower
     AND created_at::date <= v_range_upper;

  -- ★ FIX (0506): (date - date) is already an integer day-count in Postgres, not an
  --   interval, so EXTRACT(EPOCH FROM ...) had no matching function. Divide the day
  --   count directly by 30.44 (days/month) instead of dividing epoch-seconds by
  --   2592000 (seconds/month). Output unit is unchanged: avg_tenure_months, in months.
  SELECT COALESCE(AVG((v_range_upper - au.created_at::date)::numeric / 30.44), 0)
    INTO v_avg_tenure_months
    FROM keystone.app_user au
   WHERE au.tenant_id = p_tenant
     AND au.role IN ('adult_client', 'adolescent_client')
     AND au.lifecycle_status <> 'lead'
     AND au.created_at::date <= v_range_upper;

  -- ★ FIX (0506): same nested-aggregate shape as by_month/owed_by_person above — MAX() and
  --   jsonb_agg() at the same query level, reached only once the EXTRACT(EPOCH) bug above
  --   stopped raising first. Moved the GROUP BY/HAVING aggregation into an inner subquery
  --   so the outer jsonb_agg aggregates already-collapsed rows. Same "stopped" definition,
  --   same output shape: [{person_id, display_name, last_session_at}, ...].
  SELECT jsonb_agg(
    jsonb_build_object(
      'person_id', person_id,
      'display_name', display_name,
      'last_session_at', last_session_at
    )
  )
    INTO v_stopped
    FROM (
      SELECT au.id AS person_id, au.display_name AS display_name, MAX(b.starts_at) AS last_session_at
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
       GROUP BY au.id, au.display_name
      HAVING COUNT(DISTINCT b.id) > 0 OR MAX(b.starts_at) IS NOT NULL
    ) stopped_rows;

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

  SELECT COUNT(*)
    INTO v_source_missing_count
    FROM keystone.app_user
   WHERE tenant_id = p_tenant
     AND role IN ('adult_client', 'adolescent_client')
     AND lifecycle_status <> 'lead'
     AND source IS NULL;

  -- ★ FIX (0506): median_gaps referenced "gap_days" without ever joining booking_gaps —
  --   it re-queried app_user/booking directly and grouped, so "gap_days" (only defined in
  --   booking_gaps) did not exist in scope ("column gap_days does not exist"), a bug this
  --   query hit only once the report_people bugs above stopped raising first. Fixed by
  --   having median_gaps read FROM booking_gaps (carrying booking_id through for an exact
  --   session count) instead of re-deriving the same joins without the gap_days column.
  --   Same weekly/fortnightly/irregular/once thresholds and output shape, unchanged.
  WITH booking_gaps AS (
    SELECT au.id,
           b.id AS booking_id,
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
    SELECT id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_days) as median_gap,
           COUNT(DISTINCT booking_id) as session_count
      FROM booking_gaps
     GROUP BY id
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
    'clients_lost_silent', 0,
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
  'Coaches are refused entirely; only Owner/Admin may view. '
  '(0506: avg_tenure_months fixed to use plain day-count division instead of invalid EXTRACT(EPOCH).)';

GRANT EXECUTE ON FUNCTION keystone.report_people(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_people(uuid, daterange, daterange, uuid) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § C · keystone.report_sessions — fix "date <@ unknown" in dynamic SQL
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.report_sessions(
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
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_all := keystone.user_may(p_viewer, 'engagement', 'view', NULL);

  v_host_filter := CASE WHEN v_all THEN '1=1' ELSE format('booking.host_id = %L', p_viewer) END;

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
    'SELECT COALESCE(COUNT(*), 0) FROM keystone.booking WHERE tenant_id = %L AND state = %L AND starts_at::date <@ %L::daterange AND invoice_id IS NOT NULL AND %s',
    p_tenant, 'no_show', p_range, v_host_filter
  ) INTO v_no_show_charged_count;

  EXECUTE format(
    'SELECT COALESCE(SUM(i.amount_minor), 0) FROM keystone.booking b JOIN keystone.invoice i ON i.id = b.invoice_id WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND i.source = %L AND %s',
    p_tenant, 'no_show', p_range, 'no_show', v_host_filter
  ) INTO v_no_show_value_minor;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::bigint
    INTO v_booked_minutes
    FROM keystone.booking
   WHERE tenant_id = p_tenant
     AND state = 'completed'
     AND starts_at::date <@ p_range;

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

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::bigint
    INTO v_booked_minutes_compare
    FROM keystone.booking
   WHERE tenant_id = p_tenant
     AND state = 'completed'
     AND starts_at::date <@ p_compare;

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
    'dow', 'count', '[]', p_tenant, 'completed', p_range, v_host_filter
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
    'person_id', 'display_name', 'count', '[]', p_tenant, 'no_show', p_range, 'client', v_host_filter
  ) INTO v_no_show_rows;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(%L, location_kind, %L, cnt) ORDER BY cnt DESC), %L::jsonb) ' ||
    'FROM (SELECT b.location_kind AS location_kind, COUNT(*) AS cnt ' ||
    'FROM keystone.booking b WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND %s ' ||
    'GROUP BY b.location_kind) grouped',
    'location_kind', 'count', '[]', p_tenant, 'completed', p_range, v_host_filter
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
$$;

GRANT EXECUTE ON FUNCTION keystone.report_sessions(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_sessions(uuid, daterange, daterange, uuid) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § D · SELF-CHECK — calls all three functions for the first tenant found; fails the
--   migration if any of them still errors.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $selfcheck$
DECLARE
  v_tenant uuid;
  v_viewer uuid;
  v_range daterange := daterange((now() - interval '30 days')::date, now()::date, '[)');
  v_compare daterange := daterange((now() - interval '60 days')::date, (now() - interval '30 days')::date, '[)');
  v_result jsonb;
BEGIN
  -- ★ app_owner has no BYPASSRLS and keystone.tenant/app_user are FORCE RLS, so with no
  --   tenant GUC set yet a plain SELECT as app_owner sees zero rows. Borrow the connecting
  --   superuser's privileges (session_user — the runner's own SET ROLE app_owner leaves
  --   session_user unchanged) just long enough to find a real tenant + owner, then return
  --   to app_owner before calling the functions under test.
  EXECUTE format('SET LOCAL ROLE %I', session_user);
  SELECT au.tenant_id, au.id
    INTO v_tenant, v_viewer
    FROM keystone.app_user au
   WHERE au.role = 'staff' AND au.staff_role = 'owner'
   ORDER BY au.created_at
   LIMIT 1;
  EXECUTE 'SET LOCAL ROLE app_owner';

  IF v_tenant IS NULL OR v_viewer IS NULL THEN
    RAISE NOTICE '0506: no tenant with an owner found, skipping self-check';
    RETURN;
  END IF;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  PERFORM set_config('keystone.user_id', v_viewer::text, true);

  v_result := keystone.report_money(v_tenant, v_range, v_compare, v_viewer);
  IF v_result IS NULL THEN
    RAISE EXCEPTION '0506: report_money self-check returned NULL';
  END IF;

  v_result := keystone.report_people(v_tenant, v_range, v_compare, v_viewer);
  IF v_result IS NULL THEN
    RAISE EXCEPTION '0506: report_people self-check returned NULL';
  END IF;

  v_result := keystone.report_sessions(v_tenant, v_range, v_compare, v_viewer);
  IF v_result IS NULL THEN
    RAISE EXCEPTION '0506: report_sessions self-check returned NULL';
  END IF;

  RAISE NOTICE '0506: self-check passed for tenant %', v_tenant;
END
$selfcheck$;
-- (Explicit COMMIT omitted — the runner commits.)
-- Written, applying locally only.
