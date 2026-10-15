-- 0453_report_accountant_retire_0354
--
-- Stage 16 task 16.12 — the accountant report function, absorbing the logic of the two
-- orphan views from migration 0354 (report_payouts and report_accountant_monthly).
--
-- One function: keystone.report_accountant(p_tenant uuid, p_month date, p_viewer uuid)
-- RETURNS jsonb. LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp.
-- Starts with tenant-mismatch guard and applies scope via keystone.user_may.
--
-- After the function, drop the two orphan views that have no readers anywhere in the
-- application, db/gates, or test.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0453: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  -- Verify source tables exist
  IF to_regclass('keystone.payout') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.payout does not exist';
  END IF;
  IF to_regclass('keystone.payment') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.payment does not exist';
  END IF;
  IF to_regclass('keystone.invoice') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.invoice does not exist';
  END IF;
  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.booking does not exist';
  END IF;
  IF to_regclass('keystone.booking_participant') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.booking_participant does not exist';
  END IF;
  IF to_regclass('keystone.document_instance') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.document_instance does not exist';
  END IF;

  -- Verify keystone.user_may exists with correct signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'user_may' AND pronamespace = 'keystone'::regnamespace
       AND pronargs = 4
  ) THEN
    RAISE EXCEPTION '0453: keystone.user_may(uuid, text, text, uuid) does not exist';
  END IF;

  -- Verify the two views to be dropped exist (to ensure we're at the right migration point)
  IF to_regclass('keystone.report_accountant_monthly') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.report_accountant_monthly does not exist (expected to exist from 0354)';
  END IF;
  IF to_regclass('keystone.report_payouts') IS NULL THEN
    RAISE EXCEPTION '0453: keystone.report_payouts does not exist (expected to exist from 0354)';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § A · keystone.report_accountant(p_tenant uuid, p_month date, p_viewer uuid) RETURNS jsonb
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ Absorbs the logic of report_payouts and report_accountant_monthly views.
-- ★ p_month: the first day of the target month (scoped via RLS).
-- ★ Returns a jsonb object with revenue, sessions, documents, and payouts for the month.
CREATE FUNCTION keystone.report_accountant(
  p_tenant uuid,
  p_month date,
  p_viewer uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp
AS $$
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
  SELECT
    count(*)::int,
    sum(i.amount_minor)::bigint,
    coalesce(sum(p.amount_minor) FILTER (WHERE p.status = 'succeeded'), 0)::bigint
  INTO v_invoice_count, v_invoiced_minor, v_paid_minor
  FROM keystone.invoice i
  LEFT JOIN keystone.payment p ON p.invoice_id = i.id
  WHERE i.tenant_id = p_tenant
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
    FROM keystone.payment
   WHERE tenant_id = p_tenant
     AND status = 'succeeded'
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
      'workbench_minor', NULL      -- ★ Set to NULL until Stage 15 adds fee tracking table
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
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § B · DROP ORPHAN VIEWS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ These views have been confirmed to have ZERO readers anywhere in src/, db/gates, or test,
--   and ZERO dependents in the database. Safe to retire.
DROP VIEW keystone.report_accountant_monthly;
DROP VIEW keystone.report_payouts;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- § C · GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION keystone.report_accountant(uuid, date, uuid) TO app_rw;
REVOKE EXECUTE ON FUNCTION keystone.report_accountant(uuid, date, uuid) FROM PUBLIC;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)
-- Written, not applied.
