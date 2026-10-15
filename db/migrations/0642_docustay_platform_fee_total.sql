-- Part 30 item 11 — the Docustay band in the platform organisation (named viewers only) shows what Docustay earned from its own platform fee. ONE total per currency for a period: the fee cents, how much of it went back with refunds,
-- and how many payments carried a fee. Never a customer's payment amount, never a workspace, never a person — the role that reads this is granted ONLY the fee columns of document_payment, so the amount column is out of its reach.
-- Test-mode payments are not revenue and are left out. Additive.
GRANT SELECT (tenant_id, status, paid_at, currency, fee_minor, fee_refunded_minor, is_test) ON keystone.document_payment TO auth_owner;
DROP POLICY IF EXISTS docustay_platform_fee_read ON keystone.document_payment;
CREATE POLICY docustay_platform_fee_read ON keystone.document_payment FOR SELECT TO auth_owner USING (keystone.docustay_may_view());

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.docustay_platform_fee(p_from timestamptz, p_to timestamptz) RETURNS TABLE (currency text, fee_minor bigint, fee_refunded_minor bigint, payments integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.currency, sum(p.fee_minor)::bigint, sum(p.fee_refunded_minor)::bigint, count(*)::int
    FROM keystone.document_payment p
   WHERE p.fee_minor > 0 AND p.status IN ('paid', 'partially_refunded', 'refunded') AND NOT p.is_test AND p.paid_at >= p_from AND p.paid_at < p_to AND keystone.docustay_may_view()
   GROUP BY p.currency
$$;
REVOKE ALL ON FUNCTION keystone.docustay_platform_fee(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_platform_fee(timestamptz, timestamptz) TO app_rw, app_worker, app_owner;
SET LOCAL ROLE app_owner;
