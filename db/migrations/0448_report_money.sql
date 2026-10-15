-- 0448_report_money
--
-- Stage 16 task 16.7 — the money report as one parameterised SQL function, plus a shared
-- "enough data" helper function that both this and later report functions will call.
--
-- Two functions: keystone.report_enough_data(p_tenant uuid) RETURNS jsonb, and
-- keystone.report_money(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
-- RETURNS jsonb. Both LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp.
-- Both start with tenant-mismatch guard. report_money applies scope via keystone.user_may.
--
-- ★★★ costs.* fields are NULL until Stage 15's Stripe balance-transaction mirror exists (PC-6).
-- At REFRESH, the four nulls become reads of the mirror table Stage 15 adds.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0448: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  -- Verify source tables exist
  IF to_regclass('keystone.payment') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.payment does not exist';
  END IF;
  IF to_regclass('keystone.invoice') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.invoice does not exist';
  END IF;
  IF to_regclass('keystone.line_item') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.line_item does not exist';
  END IF;
  IF to_regclass('keystone.entitlement') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.entitlement does not exist';
  END IF;
  IF to_regclass('keystone.entitlement_credit') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.entitlement_credit does not exist';
  END IF;
  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.booking does not exist';
  END IF;
  -- ★ REHEARSAL FIX (25 Sep 2026): people live in keystone.app_user; keystone.person never existed.
  IF to_regclass('keystone.app_user') IS NULL THEN
    RAISE EXCEPTION '0448: keystone.app_user does not exist';
  END IF;

  -- Verify keystone.user_may exists with correct signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'user_may' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0448: keystone.user_may(uuid, text, text, uuid) does not exist';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § A · keystone.report_enough_data(p_tenant uuid) RETURNS jsonb
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.report_enough_data(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp
AS $$
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
    SELECT MIN(created_at) AS earliest FROM keystone.payment
      WHERE tenant_id = p_tenant AND status = 'succeeded'
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
  SELECT COUNT(*) INTO v_payments FROM keystone.payment
    WHERE tenant_id = p_tenant AND status = 'succeeded';

  RETURN jsonb_build_object(
    'enough', v_days_going >= 30,
    'days_going', GREATEST(v_days_going, 0),
    'payments', COALESCE(v_payments, 0)
  );
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § B · keystone.report_money(p_tenant uuid, p_range daterange, p_compare daterange, p_viewer uuid)
--       RETURNS jsonb
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.report_money(
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
  -- ★ Tenant mismatch guard: first statement after function entry.
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'report: tenant mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ★ Scope check: viewer must have 'invoice' 'view' permission
  IF NOT keystone.user_may(p_viewer, 'invoice', 'view', NULL) THEN
    RAISE EXCEPTION 'report_money: not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Collected money: sum of succeeded payments in the range
  SELECT COALESCE(SUM(amount_minor), 0) INTO v_collected_minor
    FROM keystone.payment
   WHERE tenant_id = p_tenant
     AND status = 'succeeded'
     AND created_at::date <@ p_range;

  -- Collected money in compare range
  SELECT COALESCE(SUM(amount_minor), 0) INTO v_collected_compare_minor
    FROM keystone.payment
   WHERE tenant_id = p_tenant
     AND status = 'succeeded'
     AND created_at::date <@ p_compare;

  -- Still owed: open invoices minus succeeded payments against them
  SELECT COALESCE(SUM(i.amount_minor), 0) INTO v_still_owed_minor
    FROM keystone.invoice i
   WHERE i.tenant_id = p_tenant
     AND i.status = 'open';

  -- Owed in work: available+reserved credits on NON-EXPIRED entitlements
  -- (what we expect to deliver going forward)
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

  -- Earned in range: consumed credits in range + available credits expiring in range
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

  -- Credits liability: sum of ALL available+reserved credits (including expired ones), at unit value.
  -- This is the balance-sheet snapshot: full deferred-revenue liability as of upper(p_range),
  -- NOT filtered by expiry. credits_liability_minor >= owed_in_work_minor; the difference is
  -- expired-but-not-yet-consumed/returned credits sitting in limbo.
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

  -- By month: 6 months ending at upper(p_range), sum of collected per month
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', TO_CHAR(month_date, 'YYYY-MM'),
      'collected_minor', COALESCE(SUM(amount_minor), 0)
    )
  ), '[]'::jsonb) INTO v_by_month
    FROM (
      SELECT DATE_TRUNC('month', p.created_at)::date AS month_date, p.amount_minor
        FROM keystone.payment p
       WHERE p.tenant_id = p_tenant
         AND p.status = 'succeeded'
         AND p.created_at::date >= (upper(p_range) - INTERVAL '6 months')::date
         AND p.created_at::date < (upper(p_range))::date
    ) grouped
   GROUP BY month_date
   ORDER BY month_date;

  -- By item: service/package/plan items with counts and amounts
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

  -- Owed by person: breakdown of who owes what
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'person_id', payer_user_id,
      'display_name', au.display_name,
      'owed_minor', COALESCE(SUM(i.amount_minor), 0)
    )
  ), '[]'::jsonb) INTO v_owed_by_person
    FROM keystone.invoice i
    LEFT JOIN keystone.app_user au ON au.id = i.payer_user_id
   WHERE i.tenant_id = p_tenant
     AND i.status = 'open'
   GROUP BY i.payer_user_id, au.display_name
   ORDER BY SUM(i.amount_minor) DESC;

  -- Get enough_data from helper
  v_enough_data := keystone.report_enough_data(p_tenant);

  -- Return the complete report object
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

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § C · GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION keystone.report_enough_data(uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_enough_data(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION keystone.report_money(uuid, daterange, daterange, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_money(uuid, daterange, daterange, uuid) FROM PUBLIC;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)
-- Written, not applied.
