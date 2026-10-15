// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B11 — REPORTS. FOUR VIEWS THAT HAVE EXISTED SINCE `0059`/`0060` AND HAD NO READ PATH.
//
// ★★★ THE ROW'S OWN REASON NAMED THE GAP EXACTLY: *"four fixed reports as security_invoker views;
//     no builder (ADD3-3)"*, and the build table adds *"the views exist, the read path does not."*
//     [MEASURED 2026-09-15] all four are present and all four carry `security_invoker = true`.
//
// ★★ `security_invoker` IS THE WHOLE SECURITY ARGUMENT AND IT IS WORTH STATING. A normal view runs
//    as its OWNER, which would hand every tenant's numbers to anyone who could select from it.
//    These run as the CALLER, so RLS and the scope predicate apply exactly as they do to a table.
//    That is why a report needs no hand-written tenant filter here — adding one would be the second
//    copy that drifts.
//
// ★★★ THIS ROW IS A CATALOGUE, NOT A REPORT. One nav row cannot BE four reports. It lists what
//     exists, what each answers, and HOW MANY ROWS EACH YIELDS FOR THIS VIEWER — which is the one
//     number that proves the view is readable rather than merely present. ★ A catalogue whose counts
//     are all zero for a viewer who should see data is a visible failure; a catalogue with no counts
//     would look identical either way.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The four, with the question each answers in the words a person would use. The gate asserts this
 *  list covers EVERY `report_%` view in the schema, so a fifth report cannot be added and forgotten. */
// ★ STILL NO `scoped()` IMPORT — 7.17 CHANGED WHY, NOT THE ANSWER. The four sources are
//   `security_invoker` VIEWS, so RLS (including 0196's new SELECT conjunct on keystone.invoice)
//   already narrows every ROW as the caller — a hand-written per-row predicate here would still be
//   the second copy `scoped()` exists to avoid. ★★★ BUT A CATALOGUE ROW IS NOT A ROW OF ONE OF
//   THOSE VIEWS — it is a COUNT, and RLS narrowing the count to a real 0 is indistinguishable from
//   "this report has no data yet" (the file's own :14-18 warning, now with a second cause). So each
//   count below is gated on the SAME grant `scoped()` would ask about, asked directly with
//   `keystone.user_may($1, '<grant>', 'view', NULL)` — `NULL` because a catalogue answers for the
//   WHOLE practice, not for one owned caseload, so only the `everything` scope (R45/CCR-7) counts as
//   "can read this report" here; `keystone.scope_allows` answers `false` for `owned`/`team`/`none`
//   against a NULL owner (0070:183-191), never `true`.
// ★ S2.2 — the empty-state helper. This module still imports nothing else from `_shared.mjs`; the
//   empty state is the one shared piece it needs.
import { documentAgingRelation } from "../../documents/frontDoor.mjs";
import { emptyOf } from "./_shared.mjs";

export const REPORT_VIEWS = Object.freeze([
  { view: 'report_revenue_by_month',  label: 'Revenue by month',
    question: 'What was invoiced and what was actually paid, month by month?' },
  { view: 'report_revenue_by_program', label: 'Revenue by program',
    question: 'How much was invoiced and paid for each of your programs, month by month?' },
  { view: 'report_sessions_by_coach', label: `Sessions by coach`,
    question: `How many sessions did each coach hold, and how many were attended or missed?` },
  { view: 'report_document_aging',    label: 'Documents waiting',
    question: 'Which documents have been sent and not signed, and for how long?' },
  { view: 'report_run_monthly',       label: 'Run metrics by month',
    question: 'What did each connected account report, month by month?' },
]);

export const REPORTS_LISTS = Object.freeze({
  '/reports': {
    title: 'Reports', recordType: null,
    columns: [
      { field: 'label',    label: 'Report',   format: 'text' },
      { field: 'question', label: 'Answers',  format: 'text' },
      { field: 'rows',     label: 'Rows',     format: 'number' },
    ],
    // ★ There are always four, so this sentence is for the case where the VIEWS have gone missing —
    //   which is a deployment fault, not an empty practice, and it says so.
    ...emptyOf({
      kind: 'period',
      icon: 'IconChartBar',
      headline: 'Reports appear as your data grows',
      line: 'Each report answers one question in plain words. They need a few weeks of sessions and invoices behind them first.',
      action: null,
    }),
    // ★★★ 7.17 — EACH COUNT IS GATED ON THE GRANT THE REPORT ACTUALLY READS. `revenue` and `run`
    //     read invoiced/paid money, so both ask `invoice`; `sessions` asks `engagement`; `documents`
    //     asks `document`. A viewer who cannot ask "everything" of that grant gets `rows: null` and
    //     the `question` column swapped for "Not available to your role" — never a silent 0, which
    //     would read exactly like a practice with no data (the header's own warning at :14-18).
    sql: `
      SELECT * FROM (
        SELECT 'revenue'   AS id, 'Revenue by month'       AS label,
               CASE WHEN keystone.user_may($1,'invoice','view',NULL)
                    THEN 'What was invoiced and what was actually paid, month by month?'
                    ELSE 'Not available to your role' END AS question,
               CASE WHEN keystone.user_may($1,'invoice','view',NULL)
                    THEN (SELECT count(*) FROM keystone.report_revenue_by_month)::int
                    ELSE NULL END AS rows
         UNION ALL
        SELECT 'sessions', 'Sessions by coach',
               CASE WHEN keystone.user_may($1,'engagement','view',NULL)
                    THEN 'How many sessions did each coach hold, and how many were attended or missed?'
                    ELSE 'Not available to your role' END,
               CASE WHEN keystone.user_may($1,'engagement','view',NULL)
                    THEN (SELECT count(*) FROM keystone.report_sessions_by_coach)::int
                    ELSE NULL END
         UNION ALL
        SELECT 'documents', 'Documents waiting',
               CASE WHEN keystone.user_may($1,'document','view',NULL)
                    THEN 'Which documents have been sent and not signed, and for how long?'
                    ELSE 'Not available to your role' END,
               CASE WHEN keystone.user_may($1,'document','view',NULL)
                    THEN (SELECT count(*) FROM ${documentAgingRelation()})::int
                    ELSE NULL END
         UNION ALL
        SELECT 'run', 'Run metrics by month',
               CASE WHEN keystone.user_may($1,'invoice','view',NULL)
                    THEN 'What did each connected account report, month by month?'
                    ELSE 'Not available to your role' END,
               CASE WHEN keystone.user_may($1,'invoice','view',NULL)
                    THEN (SELECT count(*) FROM keystone.report_run_monthly)::int
                    ELSE NULL END
      ) r
       WHERE $1::uuid IS NOT NULL
       ORDER BY label, r.id`,
  },
});
