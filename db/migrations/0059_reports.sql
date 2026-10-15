-- 0059 — THE FOUR FIXED REPORTS. P20.10, to ADD3-3.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ADD3-3: *"A report builder is a product. These are SQL views over tables that already exist."*
--     So there are exactly FOUR, they are named, and none of them is configurable.
--
-- ★★★ §M0 LAW 2 — **REPORTS NEVER WRITE TO ANYTHING.** A report that writes is a design error, and it
--     is enforced structurally rather than by review: a VIEW cannot contain INSERT/UPDATE/DELETE, and
--     `db/gates/p20_reports.mjs` additionally greps every view's definition and mutation-checks that
--     the grep fires. ★ The subtle version of this defect is a view calling a VOLATILE function that
--     writes — so the gate checks the functions the views depend on, not only the SQL text.
--
-- ★★★ `security_invoker = true` ON ALL FOUR, AND IT IS THE WHOLE TENANT STORY.
--     A Postgres view NORMALLY runs with the privileges and the RLS context of its OWNER. These views
--     are owned by `app_owner`, which owns the tables — so WITHOUT `security_invoker` every one of them
--     would bypass the caller's RLS and return EVERY TENANT'S ROWS to anyone allowed to select from the
--     view. That is the single worst thing that could be built in this phase, and it is one missing
--     option away.
--   ★★ [PG 15+] `security_invoker` makes the view run as the CALLER, so `current_tenant_id()` is the
--      caller's and the base tables' FORCE-RLS policies apply exactly as they would to a direct query.
--
-- ★★ MATERIALISED VIEWS STAY BANNED ON TENANT DATA (ADD3-3), and the reason is the same one: a
--    matview is a STORED COPY, refreshed by somebody's privileges, with NO RLS of its own. It would be
--    a second copy of every tenant's numbers sitting in one unprotected relation.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · REVENUE BY MONTH — `invoice` + `payment`, scoped to a period, NEVER an accumulating balance.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ ADD3-3 says "scoped to period, never an accumulating balance" and that is a correctness rule, not
--    a preference: a running balance in a report is a number that depends on when you ask, so two
--    people reading the same report on different days disagree and neither is wrong.
--  ★ Invoiced and PAID are separate columns because they are separate facts. Collapsing them into
--    "revenue" would make an unpaid invoice look like money received — the same class of error as
--    `ok` collapsing two probes in P20.9a.
CREATE VIEW keystone.report_revenue_by_month
WITH (security_invoker = true) AS
SELECT
  i.tenant_id,
  date_trunc('month', i.created_at)::date          AS month,
  i.currency,
  count(*)::int                                    AS invoice_count,
  sum(i.amount_minor)::bigint                      AS invoiced_minor,
  -- ★ A LEFT JOIN and a FILTER, not an inner join: an invoice with no payment must still appear, as
  --   zero. Dropping it would hide exactly the invoices somebody needs to chase.
  coalesce(sum(p.amount_minor) FILTER (WHERE p.status = 'succeeded'), 0)::bigint AS paid_minor
FROM keystone.invoice i
LEFT JOIN keystone.payment p ON p.invoice_id = i.id
GROUP BY i.tenant_id, date_trunc('month', i.created_at), i.currency;

COMMENT ON VIEW keystone.report_revenue_by_month IS
  'ADD3-3 report 1. ★ Scoped to a period, NEVER an accumulating balance: a running total depends on '
  'when you ask it, so two people reading the same report on different days disagree and neither is '
  'wrong. ★★ invoiced_minor and paid_minor are SEPARATE because they are separate facts — collapsing '
  'them would make an unpaid invoice look like money received.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · SESSIONS AND ATTENDANCE BY COACH — `booking` + `booking_participant`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ `attended` IS THREE-VALUED AND THE REPORT KEEPS IT THAT WAY. true / false / NULL are "came",
--     "did not come" and "nobody has said yet" — and a future session is always the third. Counting
--     NULL as a no-show would make every upcoming week look like mass absenteeism, and counting it as
--     attended would inflate the number a coach is judged on.
CREATE VIEW keystone.report_sessions_by_coach
WITH (security_invoker = true) AS
SELECT
  b.tenant_id,
  b.host_id                                        AS coach_id,
  u.display_name                                   AS coach_name,
  date_trunc('month', b.starts_at)::date           AS month,
  count(*)::int                                    AS sessions_scheduled,
  count(*) FILTER (WHERE bp.attended IS TRUE)::int  AS attended,
  count(*) FILTER (WHERE bp.attended IS FALSE)::int AS no_show,
  count(*) FILTER (WHERE bp.attended IS NULL)::int  AS not_yet_recorded
FROM keystone.booking b
LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id
LEFT JOIN keystone.app_user u ON u.id = b.host_id
GROUP BY b.tenant_id, b.host_id, u.display_name, date_trunc('month', b.starts_at);

COMMENT ON VIEW keystone.report_sessions_by_coach IS
  'ADD3-3 report 2. ★★★ `attended` is THREE-VALUED and stays that way: true/false/NULL are "came", '
  '"did not come" and "nobody has said yet" — and a FUTURE session is always the third. Counting NULL '
  'as a no-show makes every upcoming week look like mass absenteeism; counting it as attended inflates '
  'the number a coach is judged on.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · DOCUMENT PIPELINE AGING — days since `sent_at`, UNEXECUTED ONLY.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ "Unexecuted only" is the report. An executed document has no age worth chasing, and including it
--    would bury the three that need a phone call under two hundred that do not.
--  ★ It reads `sent_at`, so a DRAFT (never sent) is correctly absent: it is not waiting on anybody.
CREATE VIEW keystone.report_document_aging
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id                                             AS document_id,
  d.title,
  d.state,
  d.subject_user_id,
  u.display_name                                   AS subject_name,
  d.sent_at,
  -- ★ Whole days, floored, so "sent 20 minutes ago" reads 0 rather than 1. A report that rounds up
  --   makes something look overdue on the day it was sent.
  floor(extract(epoch FROM (now() - d.sent_at)) / 86400)::int AS days_waiting
FROM keystone.document_instance d
LEFT JOIN keystone.app_user u ON u.id = d.subject_user_id
WHERE d.sent_at IS NOT NULL
  AND d.state NOT IN ('executed', 'void', 'declined', 'expired');

COMMENT ON VIEW keystone.report_document_aging IS
  'ADD3-3 report 3. ★ UNEXECUTED ONLY: an executed document has no age worth chasing, and including '
  'it would bury the three that need a phone call under two hundred that do not. ★★ Drafts are absent '
  'because it reads sent_at — a document nobody has sent is not waiting on anybody.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4 · THE MONTHLY RUN REPORT — ★★★ OVER `run_metric`, **NOT** OVER `run_reading`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ADD3-3 ORIGINALLY CALLED THIS "a rendering of run_reading", AND P20.6a CORRECTED IT. Rendering
--     one month that way means detoasting ~120 jsonb blobs per account AT REQUEST TIME; a 12-month
--     trend is ~1,460. **That is not a report, it is a scan** — and it makes ADD3-3 and ADD3-2
--     incompatible above trivial N. `run_metric` is written at ingest and is ~4,000× smaller.
--   ★ This view therefore does not mention `run_reading` at all, and the gate asserts that: a report
--     that touched the payload would reintroduce the scan silently, and it would still return correct
--     numbers, so nothing would fail until the account count grew.
CREATE VIEW keystone.report_run_monthly
WITH (security_invoker = true) AS
SELECT
  m.tenant_id,
  m.account_id,
  a.name                                           AS account_name,
  date_trunc('month', m.day)::date                 AS month,
  m.service,
  m.metric,
  sum(m.value)                                     AS total,
  avg(m.value)                                     AS daily_average,
  count(*)::int                                    AS days_with_data,
  min(m.day)                                       AS first_day,
  max(m.day)                                       AS last_day
FROM keystone.run_metric m
LEFT JOIN keystone.account a ON a.id = m.account_id
GROUP BY m.tenant_id, m.account_id, a.name, date_trunc('month', m.day), m.service, m.metric;

COMMENT ON VIEW keystone.report_run_monthly IS
  'ADD3-3 report 4, CORRECTED by P20.6a. ★★★ It reads run_metric, NOT run_reading: "a rendering of '
  'run_reading" would detoast ~120 jsonb blobs per account per month at request time (~1,460 for a '
  '12-month trend) — a scan, not a report. ★ days_with_data is reported alongside the total so a month '
  'with three readings cannot be mistaken for a month with thirty.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ GRANTS. `app_rw` may SELECT and nothing else. There is no INSERT/UPDATE/DELETE grant on a view
--    here even though Postgres can make some views updatable — §M0 LAW 2 is enforced by the absence of
--    the privilege as well as by the shape, which is two independent mechanisms for one rule.
GRANT SELECT ON keystone.report_revenue_by_month  TO app_rw;
GRANT SELECT ON keystone.report_sessions_by_coach TO app_rw;
GRANT SELECT ON keystone.report_document_aging    TO app_rw;
GRANT SELECT ON keystone.report_run_monthly       TO app_rw;
