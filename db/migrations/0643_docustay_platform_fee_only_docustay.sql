-- 0643 · the platform-fee total counts only DOCUSTAY workspaces' payments (0642 summed every tenant's stored fee, and a Mainstay practice's document payments carry Mainstay's own fee, which is not Docustay revenue).
-- 0642 stays as applied; this redefines the one function and lets the same narrow reader see which product a tenant belongs to.
GRANT SELECT (product) ON keystone.tenant TO auth_owner;
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.docustay_platform_fee(p_from timestamptz, p_to timestamptz) RETURNS TABLE (currency text, fee_minor bigint, fee_refunded_minor bigint, payments integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.currency, sum(p.fee_minor)::bigint, sum(p.fee_refunded_minor)::bigint, count(*)::int
    FROM keystone.document_payment p JOIN keystone.tenant t ON t.id = p.tenant_id AND t.product = 'docustay'
   WHERE p.fee_minor > 0 AND p.status IN ('paid', 'partially_refunded', 'refunded') AND NOT p.is_test AND p.paid_at >= p_from AND p.paid_at < p_to AND keystone.docustay_may_view()
   GROUP BY p.currency
$$;
SET LOCAL ROLE app_owner;
