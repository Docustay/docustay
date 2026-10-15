-- 0354 — TWO ADDITIONAL REPORT FUNCTIONS: `report_payouts` and `report_accountant_monthly`.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ BOTH VIEWS USE `security_invoker = true` FOR TENANT-SCOPED RLS, as per §M0.
--     See 0059_reports.sql for the full tenant-isolation strategy: security_invoker ensures
--     current_tenant_id() is the CALLER's tenant, so base tables' FORCE-RLS policies apply
--     exactly as they would to a direct query. Materialised views are still BANNED on tenant data.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5 · PAYOUT SUMMARY — `payout` table, by tenant and payout date.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ Stripe payouts grouped by date, showing summary counts and amounts by state.
--    Columns: stripe_id, tenant_id, amount_minor, state (from B1.3 schema).
--    ★ FIX (coordinator checkpoint review, 24 Sep 2026): this comment named `stripe_payout_id`,
--      guessed before B1.3 landed in the same parallel batch. B1.3 actually named the column
--      `stripe_id`. THE VIEW QUERY ITSELF NEVER REFERENCED THE WRONG NAME — only these comments
--      did — so this was a documentation drift, not a functional defect (CLAUDE.md failure #4:
--      "a check that reported the product broken when the check was wrong"). Comment corrected.
--  ★ State values track the three-state payout lifecycle: pending, completed, failed.
--    A payout that has not yet settled is correctly visible; a failed payout is visible so
--    it can be investigated.
CREATE VIEW keystone.report_payouts
WITH (security_invoker = true) AS
SELECT
  p.tenant_id,
  p.created_at::date                                 AS payout_date,
  p.state,
  count(*)::int                                      AS payout_count,
  sum(p.amount_minor)::bigint                        AS total_amount_minor,
  min(p.created_at)                                  AS first_payout_time,
  max(p.created_at)                                  AS last_payout_time
FROM keystone.payout p
GROUP BY p.tenant_id, p.created_at::date, p.state;

COMMENT ON VIEW keystone.report_payouts IS
  'Report 5. Payout summary by tenant and date. ★ State tracks the three-state payout lifecycle: '
  'pending, completed, failed. A payout that has not yet settled is correctly visible; a failed '
  'payout is visible so it can be investigated. ★★ Columns follow B1.3 payout table schema: '
  'stripe_id, tenant_id, amount_minor, state.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6 · MONTHLY ACCOUNTANT ROLLUP — revenue, sessions, document aging joined.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ A single monthly view combining the three core business metrics: revenue (invoiced and paid),
--    session attendance, and document pipeline age. Reuses the existing reports' underlying
--    queries rather than re-deriving the numbers.
--  ★ `report_revenue_by_month` is joined on month; `report_sessions_by_coach` and
--    `report_document_aging` are aggregated per month to create a single-row-per-tenant-per-month
--    summary suitable for accountant/bookkeeper review.
CREATE VIEW keystone.report_accountant_monthly
WITH (security_invoker = true) AS
SELECT
  rev.tenant_id,
  rev.month,
  rev.currency,
  rev.invoice_count,
  rev.invoiced_minor,
  rev.paid_minor,
  coalesce(ses.total_sessions, 0)::int               AS total_sessions,
  coalesce(ses.total_attended, 0)::int               AS total_attended,
  coalesce(ses.total_no_show, 0)::int                AS total_no_show,
  coalesce(ses.total_not_yet_recorded, 0)::int       AS total_not_yet_recorded,
  coalesce(doc.total_documents, 0)::int              AS unexecuted_documents,
  coalesce(doc.max_days_waiting, 0)::int             AS max_days_waiting
FROM keystone.report_revenue_by_month rev
LEFT JOIN (
  SELECT
    tenant_id,
    month,
    sum(sessions_scheduled)::int AS total_sessions,
    sum(attended)::int AS total_attended,
    sum(no_show)::int AS total_no_show,
    sum(not_yet_recorded)::int AS total_not_yet_recorded
  FROM keystone.report_sessions_by_coach
  GROUP BY tenant_id, month
) ses ON ses.tenant_id = rev.tenant_id AND ses.month = rev.month
LEFT JOIN (
  SELECT
    tenant_id,
    date_trunc('month', sent_at)::date AS month,
    count(*)::int AS total_documents,
    max(days_waiting)::int AS max_days_waiting
  FROM keystone.report_document_aging
  GROUP BY tenant_id, date_trunc('month', sent_at)
) doc ON doc.tenant_id = rev.tenant_id AND doc.month = rev.month
ORDER BY rev.month DESC;

COMMENT ON VIEW keystone.report_accountant_monthly IS
  'Report 6. Monthly accountant rollup joining revenue (invoiced, paid), sessions (attended, no-show, '
  'pending), and document aging (count, max days waiting). ★ Reuses the three existing reports'' '
  'underlying queries rather than re-deriving: joins report_revenue_by_month on month, and aggregates '
  'report_sessions_by_coach and report_document_aging per month for a single-row-per-tenant summary '
  'suitable for bookkeeper/accountant review.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ GRANTS. `app_rw` may SELECT and nothing else, matching the four existing reports.
--    §M0 LAW 2 is enforced by the absence of INSERT/UPDATE/DELETE privilege.
GRANT SELECT ON keystone.report_payouts              TO app_rw;
GRANT SELECT ON keystone.report_accountant_monthly   TO app_rw;
