-- 0576_report_functions_off_the_mirror
--
-- specs/STRIPE-MIRROR.md §4 stage (e) — reports read money from STRIPE (via the 0574 effective views),
-- never from Mainstay's own duplicated copy. CLAUDE.md: "Stripe is the single source of truth for money."
--
-- Re-states, with IDENTICAL signature / return type / language / STABLE / SECURITY INVOKER (not definer) /
-- `SET search_path = keystone, pg_temp` / grants (EXECUTE to app_rw, none to PUBLIC), the money readers
-- as they are live today (measured with pg_get_functiondef — newest definitions are 0506/0508/0521/
-- 0452/0453), changing ONLY the money-fact reads:
--
--   report_enough_data   payment            -> payment_effective
--   report_money         payment            -> payment_effective            (collected, by_month)
--                        open-invoice sums  -> person_owes                  (still_owed, owed_by_person)
--                        invoice.status     -> invoice_effective.status     (by_item: open|paid only)
--   report_coaches       invoice + payment  -> invoice_effective + payment_effective   (earned)
--   report_sessions      invoice.amount     -> invoice_effective.amount, void/draft excluded (no-show value)
--   report_accountant    invoice + payment  -> invoice_effective (amount, paid; void/draft excluded)
--                                              + payment_effective (collected)
--   VIEW report_revenue_by_month (feeds the Home strip + chart) -> invoice_effective; same columns/types.
--
-- ★ "collected" = payment_effective.status IN ('succeeded','partially_refunded'): a charge Stripe has
--   partly refunded is still money collected (the refund is reported separately via refund_effective);
--   the mirror reports such a charge as 'partially_refunded', so `= 'succeeded'` alone would drop it.
-- ★ Voided / draft invoices never count in any total. Stripe-only invoices (no keystone.invoice row) count
--   in owes (person_owes) but not in month-bucketed invoiced totals: the view has no created_at, and the
--   month is Mainstay's invoice.created_at. Reported, not guessed.
-- ★ Behaviour fix that falls out: report_accountant and report_revenue_by_month used to LEFT JOIN payment
--   and SUM invoice.amount_minor over the joined rows, multiplying an invoice's amount by its payment count.
--   paid is now Stripe's amount_paid on the invoice itself; no join, no multiplication.
-- ★ Function bodies are NOT SECURITY DEFINER, so the caller's RLS (and the security_invoker views' viewer
--   scope) applies exactly as before.
--
-- Additive in effect: CREATE OR REPLACE only; needs 0574. No data change.

DO $pre$
BEGIN
  IF to_regclass('keystone.payment_effective') IS NULL OR to_regclass('keystone.invoice_effective') IS NULL
     OR to_regclass('keystone.person_owes') IS NULL THEN
    RAISE EXCEPTION '0576: 0574 effective views are missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'keystone'::regnamespace
        AND proname IN ('report_enough_data','report_money','report_coaches','report_sessions','report_accountant')) <> 5 THEN
    RAISE EXCEPTION '0576: expected the 5 report functions to exist';
  END IF;
END
$pre$;

-- ── keystone.report_enough_data
CREATE OR REPLACE FUNCTION keystone.report_enough_data(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'keystone', 'pg_temp'
AS $function$
DECLARE
  v_earliest_date timestamptz;
  v_days_going integer;
  v_payments integer;
BEGIN
  -- ★ Tenant mismatch guard: first statement after function entry.
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Find the earliest of: first succeeded payment, first booking, or first client
  SELECT MIN(earliest) INTO v_earliest_date FROM (
    SELECT MIN(created_at) AS earliest FROM keystone.payment_effective
      WHERE tenant_id = p_tenant AND status IN ('succeeded', 'partially_refunded')
    UNION ALL
    SELECT MIN(starts_at) FROM keystone.booking
      WHERE tenant_id = p_tenant
    UNION ALL
    SELECT MIN(created_at) FROM keystone.app_user
      WHERE tenant_id = p_tenant AND role IN ('adult_client', 'adolescent_client')
  ) AS dates;

  -- If no data found, default to today
  IF v_earliest_date IS NULL THEN
    v_earliest_date := now();
  END IF;

  v_days_going := (now()::date - v_earliest_date::date);

  -- Count succeeded payments for this tenant
  SELECT COUNT(*) INTO v_payments FROM keystone.payment_effective
    WHERE tenant_id = p_tenant AND status IN ('succeeded', 'partially_refunded');

  RETURN jsonb_build_object(
    'enough', v_days_going >= 30,
    'days_going', GREATEST(v_days_going, 0),
    'payments', COALESCE(v_payments, 0)
  );
END
$function$;

-- ── keystone.report_money
CREATE OR REPLACE FUNCTION keystone.report_money(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'keystone', 'pg_temp'
AS $function$
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
    FROM keystone.payment_effective
   WHERE tenant_id = p_tenant
     AND status IN ('succeeded', 'partially_refunded')
     AND created_at::date <@ p_range;

  SELECT COALESCE(SUM(amount_minor), 0) INTO v_collected_compare_minor
    FROM keystone.payment_effective
   WHERE tenant_id = p_tenant
     AND status IN ('succeeded', 'partially_refunded')
     AND created_at::date <@ p_compare;

  -- ★ 0576: still-owed is the ONE owes computation (keystone.person_owes = Stripe's amount_remaining over
  --   invoices Stripe says are open). Void/draft/paid/uncollectible never count.
  SELECT COALESCE(SUM(po.owes_minor), 0) INTO v_still_owed_minor
    FROM keystone.person_owes po
   WHERE po.tenant_id = p_tenant;

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
        FROM keystone.payment_effective p
       WHERE p.tenant_id = p_tenant
         AND p.status IN ('succeeded', 'partially_refunded')
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
        JOIN keystone.invoice_effective ie ON ie.id = i.id
       WHERE i.tenant_id = p_tenant
         AND ie.status IN ('open', 'paid')
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
      SELECT po.person_id AS payer_user_id,
             au.display_name AS display_name,
             COALESCE(SUM(po.owes_minor), 0) AS owed_minor
        FROM keystone.person_owes po
        LEFT JOIN keystone.app_user au ON au.id = po.person_id
       WHERE po.tenant_id = p_tenant
       GROUP BY po.person_id, au.display_name
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
      'mainstay_minor', NULL
    ),
    'still_owed_minor', v_still_owed_minor,
    'credits_liability_minor', v_credits_liability_minor,
    'earned_minor', v_earned_minor,
    'owed_in_work_minor', v_owed_in_work_minor,
    'owed_by_person', v_owed_by_person
  );
END
$function$;

-- ── keystone.report_coaches
CREATE OR REPLACE FUNCTION keystone.report_coaches(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'keystone', 'pg_temp'
AS $function$
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
        COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status IN ('succeeded', 'partially_refunded')), 0) AS earned_minor
      FROM keystone.booking b
      JOIN keystone.line_item li ON li.tenant_id = b.tenant_id AND li.booking_id = b.id
      JOIN keystone.invoice_effective i ON i.tenant_id = b.tenant_id AND i.id = li.invoice_id
      JOIN keystone.payment_effective p ON p.tenant_id = b.tenant_id AND p.invoice_id = i.id
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
$function$;

-- ── keystone.report_sessions
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
    'SELECT COALESCE(SUM(ie.amount_minor), 0) FROM keystone.invoice i JOIN keystone.invoice_effective ie ON ie.id = i.id WHERE i.tenant_id = %L AND i.source = %L AND ie.status NOT IN (%L, %L) AND i.id IN (' ||
    'SELECT li.invoice_id FROM keystone.line_item li JOIN keystone.booking b ON b.tenant_id = li.tenant_id AND b.id = li.booking_id ' ||
    'WHERE b.tenant_id = %L AND b.state = %L AND b.starts_at::date <@ %L::daterange AND %s)',
    p_tenant, 'no_show', 'draft', 'void', p_tenant, 'no_show', p_range, v_host_filter_b
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

-- ── keystone.report_accountant
CREATE OR REPLACE FUNCTION keystone.report_accountant(p_tenant uuid, p_month date, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'keystone', 'pg_temp'
AS $function$
DECLARE
  v_invoice_count integer;
  v_invoiced_minor bigint;
  v_paid_minor bigint;
  v_total_sessions integer;
  v_attended integer;
  v_no_show integer;
  v_not_yet_recorded integer;
  v_unexecuted_documents integer;
  v_in_by_method jsonb;
  v_collected_minor bigint;
  v_payouts jsonb;
BEGIN
  -- ★ Tenant mismatch guard: first statement after function entry.
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ★ Scope check: viewer must have 'invoice' 'view' permission
  IF NOT keystone.user_may(p_viewer, 'invoice', 'view', NULL) THEN
    RAISE EXCEPTION 'report_accountant: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- Revenue: invoiced and paid amounts for the month (from report_revenue_by_month logic)
  -- ─────────────────────────────────────────────────────────────────────────────
  -- ★ 0576: status/amount/paid are STRIPE's (invoice_effective). Draft and void invoices never count.
  --   The old LEFT JOIN to payment multiplied an invoice's amount by its payment-row count; paid_minor is
  --   Stripe's amount_paid on the invoice itself, so no join is needed. The month stays Mainstay's
  --   invoice.created_at (the view carries no created_at).
  SELECT
    count(*)::int,
    sum(ie.amount_minor)::bigint,
    coalesce(sum(ie.paid_minor), 0)::bigint
  INTO v_invoice_count, v_invoiced_minor, v_paid_minor
  FROM keystone.invoice i
  JOIN keystone.invoice_effective ie ON ie.id = i.id
  WHERE i.tenant_id = p_tenant
    AND ie.status NOT IN ('draft', 'void')
    AND date_trunc('month', i.created_at)::date = p_month;

  -- Default to 0 if null
  v_invoice_count := COALESCE(v_invoice_count, 0);
  v_invoiced_minor := COALESCE(v_invoiced_minor, 0);
  v_paid_minor := COALESCE(v_paid_minor, 0);

  -- ─────────────────────────────────────────────────────────────────────────────
  -- in_by_method: collected payments for the month
  -- ★ Temporary: no payment-method column on payment table yet. Returns a single
  --   element array with method='all' until a future stage adds payment method tracking.
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT COALESCE(SUM(amount_minor), 0)::bigint INTO v_collected_minor
    FROM keystone.payment_effective
   WHERE tenant_id = p_tenant
     AND status IN ('succeeded', 'partially_refunded')
     AND date_trunc('month', created_at)::date = p_month;

  v_in_by_method := jsonb_build_array(
    jsonb_build_object('method', 'all', 'amount_minor', v_collected_minor)
  );

  -- ─────────────────────────────────────────────────────────────────────────────
  -- Sessions and attendance: from report_sessions_by_coach aggregated per month
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE bp.attended IS TRUE)::int,
    count(*) FILTER (WHERE bp.attended IS FALSE)::int,
    count(*) FILTER (WHERE bp.attended IS NULL)::int
  INTO v_total_sessions, v_attended, v_no_show, v_not_yet_recorded
  FROM keystone.booking b
  LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id
  WHERE b.tenant_id = p_tenant
    AND date_trunc('month', b.starts_at)::date = p_month;

  v_total_sessions := COALESCE(v_total_sessions, 0);
  v_attended := COALESCE(v_attended, 0);
  v_no_show := COALESCE(v_no_show, 0);
  v_not_yet_recorded := COALESCE(v_not_yet_recorded, 0);

  -- ─────────────────────────────────────────────────────────────────────────────
  -- Unexecuted documents: count of unsent/unexecuted documents
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT count(*)::int INTO v_unexecuted_documents
    FROM keystone.document_instance d
   WHERE d.tenant_id = p_tenant
     AND d.sent_at IS NOT NULL
     AND date_trunc('month', d.sent_at)::date = p_month
     AND d.state NOT IN ('executed', 'void', 'declined', 'expired');

  v_unexecuted_documents := COALESCE(v_unexecuted_documents, 0);

  -- ─────────────────────────────────────────────────────────────────────────────
  -- Payouts: from keystone.payout table for the month
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', p.created_at::date,
      'amount_minor', p.amount_minor,
      'state', p.state
    ) ORDER BY p.created_at DESC
  ), '[]'::jsonb) INTO v_payouts
    FROM keystone.payout p
   WHERE p.tenant_id = p_tenant
     AND date_trunc('month', p.created_at)::date = p_month;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- Return the complete accountant report
  -- ─────────────────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'month', p_month::text,
    'in_by_method', v_in_by_method,
    'out', jsonb_build_object(
      'stripe_fees_minor', NULL,  -- ★ Set to NULL until Stage 15 adds fee tracking table
      'mainstay_minor', NULL      -- ★ Set to NULL until Stage 15 adds fee tracking table
    ),
    'still_owed_minor', v_invoiced_minor - v_paid_minor,
    'owed_in_work_minor', 0,  -- Not tracked yet; may be added in a future stage
    'payouts', v_payouts,
    'sessions', jsonb_build_object(
      'total', v_total_sessions,
      'attended', v_attended,
      'no_show', v_no_show
    ),
    'unexecuted_documents', v_unexecuted_documents,
    'balance', NULL  -- ★ Will become real once Stage 15's balance mirror exists (do not invent)
  );
END
$function$;


-- ── keystone.report_revenue_by_month (view) — same columns and types, security_invoker kept ────────────
CREATE OR REPLACE VIEW keystone.report_revenue_by_month
WITH (security_invoker = true) AS
SELECT i.tenant_id,
       (date_trunc('month'::text, i.created_at))::date AS month,
       i.currency,
       (count(*))::integer AS invoice_count,
       sum(ie.amount_minor) AS invoiced_minor,
       COALESCE(sum(ie.paid_minor), (0)::bigint) AS paid_minor
  FROM keystone.invoice i
  JOIN keystone.invoice_effective ie ON ie.id = i.id
 WHERE ie.status NOT IN ('draft', 'void')
 GROUP BY i.tenant_id, (date_trunc('month'::text, i.created_at)), i.currency;

-- ── Grants — re-stated identical to today's (EXECUTE to app_rw only; SELECT on the view to app_rw) ──────
GRANT EXECUTE ON FUNCTION keystone.report_enough_data(uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_enough_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.report_money(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_money(uuid, daterange, daterange, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.report_coaches(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_coaches(uuid, daterange, daterange, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.report_sessions(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_sessions(uuid, daterange, daterange, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.report_accountant(uuid, date, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_accountant(uuid, date, uuid) FROM PUBLIC;
GRANT SELECT ON keystone.report_revenue_by_month TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_fn text;
  v_src text;
  v_bad int;
BEGIN
  -- every money reader now reads the effective views and never keystone.payment directly
  FOREACH v_fn IN ARRAY ARRAY['report_enough_data','report_money','report_coaches','report_accountant'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE pronamespace = 'keystone'::regnamespace AND proname = v_fn;
    IF v_src !~ 'payment_effective' THEN
      RAISE EXCEPTION '0576 self-check: % does not read payment_effective', v_fn;
    END IF;
    IF v_src ~ 'keystone\.payment(?![_a-z])' THEN
      RAISE EXCEPTION '0576 self-check: % still reads keystone.payment', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['report_money','report_coaches','report_sessions','report_accountant'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE pronamespace = 'keystone'::regnamespace AND proname = v_fn;
    IF v_src !~ '(invoice_effective|person_owes)' THEN
      RAISE EXCEPTION '0576 self-check: % does not read invoice_effective/person_owes', v_fn;
    END IF;
  END LOOP;
  -- not SECURITY DEFINER, STABLE, same search_path, not executable by PUBLIC
  SELECT count(*) INTO v_bad FROM pg_proc p
   WHERE p.pronamespace = 'keystone'::regnamespace
     AND p.proname IN ('report_enough_data','report_money','report_coaches','report_sessions','report_accountant')
     AND (p.prosecdef OR p.provolatile <> 's'
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=keystone, pg_temp']
          OR has_function_privilege('public', p.oid, 'EXECUTE')
          OR NOT has_function_privilege('app_rw', p.oid, 'EXECUTE'));
  IF v_bad <> 0 THEN RAISE EXCEPTION '0576 self-check: % report function(s) lost their SECURITY/volatility/search_path/grants', v_bad; END IF;
  -- the view still has its six columns, security_invoker, and reads the effective view
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'keystone.report_revenue_by_month'::regclass AND attnum > 0 AND NOT attisdropped) <> 6 THEN
    RAISE EXCEPTION '0576 self-check: report_revenue_by_month column count changed';
  END IF;
  IF pg_get_viewdef('keystone.report_revenue_by_month'::regclass) !~ 'invoice_effective' THEN
    RAISE EXCEPTION '0576 self-check: report_revenue_by_month does not read invoice_effective';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'keystone.report_revenue_by_month'::regclass
                  AND reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '0576 self-check: report_revenue_by_month lost security_invoker';
  END IF;
  RAISE NOTICE '0576: 5 report functions + report_revenue_by_month read the effective views';
END
$check$;
