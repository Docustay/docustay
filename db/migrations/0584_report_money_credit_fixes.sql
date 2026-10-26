-- 0584 · THE CREDITS REPORT, CORRECTED (QUEUE §12.3, specs/CREDITS-PIPELINE.md defects 12/13/25).
--   · BREAKAGE (earned from credits that expired unused) tested `e.status = 'available'` — a status an ENTITLEMENT never has — so breakage
--     revenue was always 0. It now counts credits that were still unused (available / returned / expired) when their entitlement expired in the range.
--   · A `returned` credit is spendable, so it counts as outstanding (liability + "owed in work") like an `available` one. `voided` never counts.
--   · (Worth was 0 because `entitlement.line_item_id` was never set; the grant now sets it — see creditGrant.mjs.)
--   · EARNED counted every credit once per credit of its package (a join fan-out: 4 credits → 4×). Now one pass.
-- Re-creates keystone.report_money from 0576 with exactly those predicates changed. Idempotent (CREATE OR REPLACE).

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

  -- ★ 0584: this block joined `credit_values` (already ONE ROW PER CREDIT) back to entitlement_credit on entitlement_id — every credit was
  --   counted once per credit of its package (4 credits → ×4). One pass over the credits, valued once each.
  SELECT COALESCE(SUM(
    CASE
      WHEN ec.status = 'consumed' AND ec.consumed_at::date <@ p_range THEN (unit_value * 1)::bigint
      WHEN ec.status IN ('available', 'returned', 'expired') AND e.expires_at <= now() AND e.expires_at::date <@ p_range THEN (unit_value * 1)::bigint
      ELSE 0
    END
  ), 0) INTO v_earned_minor
    FROM (
      SELECT ec.id, ec.status, ec.consumed_at, ec.entitlement_id,
             (li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0))::numeric / NULLIF(e.total_credits, 0) AS unit_value
        FROM keystone.entitlement_credit ec
        JOIN keystone.entitlement e ON e.id = ec.entitlement_id
        LEFT JOIN keystone.line_item li ON li.id = e.line_item_id
       WHERE e.tenant_id = p_tenant
    ) ec
    JOIN keystone.entitlement e ON e.id = ec.entitlement_id;

  WITH credit_values AS (
    SELECT ec.entitlement_id, e.line_item_id, e.total_credits,
           (li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0))::numeric / NULLIF(e.total_credits, 0) AS unit_value
      FROM keystone.entitlement_credit ec
      JOIN keystone.entitlement e ON e.id = ec.entitlement_id
      LEFT JOIN keystone.line_item li ON li.id = e.line_item_id
     WHERE e.tenant_id = p_tenant
       AND ec.status IN ('available', 'reserved', 'returned')
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
