-- 0060 — CORRECTING 0059's JUSTIFICATION FOR `security_invoker`. COMMENTS ONLY; NO SHAPE CHANGES.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THIS MIGRATION EXISTS BECAUSE 0059 STATED A REASON THAT IS FALSE, AND I MEASURED IT FALSE.
--     0059's header says omitting `security_invoker` "would bypass the caller's RLS and return EVERY
--     TENANT'S ROWS". [MEASURED 2026-09-14] IT DOES NOT. With the option removed from
--     `report_revenue_by_month`, tenant A still saw only 11100 and tenant B only 22200.
--
--   ★★ THE REASON IT DOES NOT LEAK IS **FORCE** RLS. A view without invoker-rights runs as its OWNER
--      (`app_owner`), and app_owner owns these tables — but FORCE ROW LEVEL SECURITY applies the policy
--      to the OWNER TOO, which is the same property 0008:8-16 measured for SECURITY DEFINER functions.
--      `current_tenant_id()` reads a session GUC, still the caller's, so the filter holds.
--
-- ★★★ AND I AM FIXING THE COMMENT RATHER THAN LEAVING IT, BECAUSE AN OVERSTATED REASON IS WORSE THAN
--     NO REASON: the next reader who discovers the overstatement removes the OPTION along with the
--     claim, and the option is doing real work — just not the work I said.
--
-- ★★★ WHAT `security_invoker` ACTUALLY BUYS HERE, AND IT IS LOAD-BEARING TODAY:
--       1. PRIVILEGES, NOT RLS. Without it the view reads its base tables with the OWNER'S table
--          privileges, so a role holding SELECT on the VIEW but not on `keystone.invoice` can read
--          invoices through it. [EXECUTED] `db/gates/p20_reports.mjs` proves exactly this: with the
--          option removed the probe role READ THE REPORT ANYWAY; with it, the role is refused
--          `permission denied`, and a positive control shows the same role succeeds once granted the
--          base table. RLS and GRANTs are separate gates and FORCE fixes only the first.
--       2. TWO INDEPENDENT MECHANISMS. FORCE RLS is currently the only thing preventing a cross-tenant
--          read through a report. With invoker-rights, dropping FORCE from one base table is no longer
--          sufficient to leak. Neither mechanism is load-bearing alone.
--
-- ★ NO VIEW IS REDEFINED HERE. An applied migration is immutable (the runner refused the edit, and it
--   was right), so the correction travels as COMMENTs — which is also where a future reader will look.

COMMENT ON VIEW keystone.report_revenue_by_month IS
  'ADD3-3 report 1. Scoped to a period, NEVER an accumulating balance: a running total depends on when '
  'you ask it. invoiced_minor and paid_minor are SEPARATE facts. '
  '★★★ security_invoker=true is here for PRIVILEGES, not RLS: without it the view would read '
  'keystone.invoice with the OWNER''s grants, so a role with SELECT on this view and none on the base '
  'table could read invoices through it. ★ 0059''s header claims omitting it would leak ACROSS TENANTS '
  '— that is FALSE and was measured false; FORCE RLS applies the policy to the owner too. See 0060.';

COMMENT ON VIEW keystone.report_sessions_by_coach IS
  'ADD3-3 report 2. `attended` is THREE-VALUED and stays that way: true/false/NULL are "came", "did not '
  'come" and "nobody has said yet" — a FUTURE session is always the third. '
  '★ security_invoker=true: see 0060 for the corrected reason (privileges, not cross-tenant RLS).';

COMMENT ON VIEW keystone.report_document_aging IS
  'ADD3-3 report 3. UNEXECUTED ONLY — an executed document has no age worth chasing. Drafts are absent '
  'because it reads sent_at. '
  '★ security_invoker=true: see 0060 for the corrected reason (privileges, not cross-tenant RLS).';

COMMENT ON VIEW keystone.report_run_monthly IS
  'ADD3-3 report 4, CORRECTED by P20.6a: it reads run_metric, NOT run_reading — "a rendering of '
  'run_reading" would detoast ~120 jsonb blobs per account per month at request time. days_with_data is '
  'reported alongside the total so a gappy month cannot pass for a full one. '
  '★ security_invoker=true: see 0060 for the corrected reason (privileges, not cross-tenant RLS).';
