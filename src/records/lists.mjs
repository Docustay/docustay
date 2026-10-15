// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P15.5 / P6.0b — THE LIST VIEWS. "QUERY AND SCREEN, BOTH."
//
// ★★★ THIS FILE IS NOW AN INDEX. It was 627 lines holding all 29 descriptors, and P6.0b split them
//     into one module per NAV SECTION so the 13 P6 batches can be built concurrently without four
//     subagents writing the same file and silently overwriting one another (`~/keystone` is not a
//     git repository, so a lost write leaves nothing to diff against).
// ★★ EVERY EXPORT THIS FILE HAD, IT STILL HAS. `LIST_VIEWS`, `scoped` and `HOME_TILES` are the
//    public surface — 12 modules import them and none of those imports changed.
// ★ ONE DECLARATION PER NAV PATH, AND THE PATH IS THE KEY. `db/gates/p15_crm_screens.mjs` asserts
//   every key is a real `knownPaths()` entry, so a typo is a failing gate, not an unreachable screen.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { PEOPLE_LISTS } from "./lists/people.mjs";
import { ACCOUNTS_LISTS } from "./lists/accounts.mjs";
import { NETWORK_LISTS } from "./lists/network.mjs";
import { ENGAGEMENTS_LISTS } from "./lists/engagements.mjs";
import { ITEMS_LISTS } from "./lists/items.mjs";
import { DOCUMENTS_LISTS } from "./lists/documents.mjs";
import { MONEY_LISTS } from "./lists/money.mjs";
import { PLATFORM_LISTS } from "./lists/platform.mjs";
import { GROWTH_LISTS } from "./lists/growth.mjs";
import { TASKS_LISTS } from "./lists/tasks.mjs";
import { REPORTS_LISTS } from "./lists/reports.mjs";
import { SETTINGS_LISTS } from "./lists/settings.mjs";

// ★★ Re-exported so the ~12 existing importers of this module keep working untouched.
// ★★ IMPORTED, NOT ONLY RE-EXPORTED. `HOME_TILES` below CALLS `scoped()`, and a bare
//    `export { x } from "..."` re-exports without binding the name locally — the module then
//    throws `scoped is not defined` at evaluation time, not at import time.
import { scoped } from "./lists/_shared.mjs";
export { scoped };
import {
  documentsAwaitingSignatureCountQuery, unsignedInstanceQueueFragment,
  instancesStartedTodayCountExpr, notExecutedAnyDocumentFragment,
} from "../documents/api.mjs";

// ★★★ MERGED, NOT CONCATENATED BY HAND. A section added later needs ONE import line here and
//     its own file — never an edit inside somebody else's batch.
export const LIST_VIEWS = Object.freeze({
  ...PEOPLE_LISTS,
  ...ACCOUNTS_LISTS,
  ...NETWORK_LISTS,
  ...ENGAGEMENTS_LISTS,
  ...ITEMS_LISTS,
  ...DOCUMENTS_LISTS,
  ...MONEY_LISTS,
  ...PLATFORM_LISTS,
  ...GROWTH_LISTS,
  ...TASKS_LISTS,
  ...REPORTS_LISTS,
  ...SETTINGS_LISTS,
});

/** ★ The dashboard. Counts only — every number is a link to the list that produced it, so a
 *  figure on the home screen can always be taken apart. */
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY TILE IS SCOPED BY THE SAME PREDICATE AS THE LIST IT LINKS TO, AND UNTIL THE P1
//     ADVERSARIAL REVIEW NONE OF THEM WAS. [EXECUTED] `/api/home` bound NO viewer at all and these
//     counts had no predicate of any kind, so a coach whose `/people/all` returned 2 rows saw a
//     "People" tile reading **9**.
//   ★★★ A TILE IS A NUMBER **AND A DESTINATION** — the comment on the route says so. A count that
//       does not match the list behind it is both a LEAK (it discloses the size of what you may not
//       see) and a LIE (you click it and get two). Either alone would be worth fixing.
//   ★ The alias in each tile exists only so `scoped()` has something to qualify; the queries are
//     otherwise unchanged.
//   ★ Tiles now carry a `band` field to group related tiles, and money tiles additionally carry
//     `money: true` and select a literal `currency` column alongside `n`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ "Is Stripe live for this practice?" — a live Connect account OR the practice IS the platform's own
//   Stripe account (Docustay: the platform Stripe account has no connect_account row, by design — keystone.stripe_account
//   is_platform, migration 0575). Every gate that asked only about connect_account returned NULL for Docustay,
//   so Home read "$0.00 taken this month" beside "$2.00 this month" (found in the 2 Oct 2026 browser check).
export const STRIPE_LIVE_SQL = `(EXISTS (SELECT 1 FROM keystone.connect_account ca WHERE ca.state = 'live' AND ca.tenant_id = keystone.current_tenant_id())
        OR EXISTS (SELECT 1 FROM keystone.stripe_account sa WHERE sa.tenant_id = keystone.current_tenant_id()))`;

export const HOME_TILES = Object.freeze([
  // ── MONEY band (Owner + Admin only — the /api/home route filters this band out for everyone else) ──
  // ★★★ GATED ON CONNECT. If Stripe Connect is not live for this tenant, these tiles return NULL
  // instead of zero, so the UI can distinguish "not connected" from "zero activity". The route or
  // UI layer interprets NULL as "not connected" and displays appropriately.
  { key: 'paid_this_month', label: 'Paid this month', path: '/money/payments', band: 'money', money: true,
    sql: `SELECT CASE WHEN ${STRIPE_LIVE_SQL}
                     THEN coalesce(sum(p.amount_minor), 0)::int ELSE NULL END AS n, 'USD' AS currency
            FROM keystone.payment_effective p
           WHERE p.status IN ('succeeded', 'partially_refunded')
             AND p.created_at >= date_trunc('month', now())
             AND ${scoped('payment', 'p')}` },
  { key: 'outstanding_balance', label: 'Outstanding', path: '/money/invoices', band: 'money', money: true,
    sql: `SELECT CASE WHEN ${STRIPE_LIVE_SQL}
                     THEN coalesce(sum(po.owes_minor), 0)::int ELSE NULL END AS n, 'USD' AS currency
            -- STRIPE-MIRROR §4 stage (e): the one owes function, keystone.person_owes (Stripe's own
            -- amount_remaining over invoices Stripe says are open). The viewer predicate is the same
            -- per-grant invoice.view on the payer's owner that scoped('invoice', ...) states.
            FROM keystone.person_owes po
            JOIN keystone.app_user pou ON pou.id = po.person_id
           WHERE keystone.user_may($1, 'invoice', 'view', pou.owner_user_id)` },
  { key: 'active_plans', label: 'Active plans', path: '/money/subscriptions', band: 'money',
    sql: `SELECT CASE WHEN ${STRIPE_LIVE_SQL}
                     THEN count(*)::int ELSE NULL END AS n FROM keystone.subscription_effective sub
           WHERE sub.state = 'active' AND ${scoped('subscription', 'sub')}` },
  { key: 'credits_outstanding', label: 'Credits out', path: '/money/credits', band: 'money',
    sql: `SELECT CASE WHEN ${STRIPE_LIVE_SQL}
                     THEN count(*)::int ELSE NULL END AS n FROM keystone.entitlement_credit ec
            JOIN keystone.entitlement e ON e.id = ec.entitlement_id
           WHERE ec.status IN ('available', 'returned') AND ${scoped('entitlement', 'e')}` },

  // ── WORK band (every viewer) ──
  { key: 'sessions_today', label: 'Sessions today', path: '/engagements/calendar', band: 'work',
    sql: `SELECT count(*)::int AS n FROM keystone.booking b
           WHERE b.starts_at >= date_trunc('day', now())
             AND b.starts_at <  date_trunc('day', now()) + interval '1 day'
             AND b.state IN ('confirmed','pending_payment','completed')
             AND ${scoped('engagement', 'b')}` },
  { key: 'no_shows_this_week', label: 'No-shows', path: '/engagements/calendar', band: 'work',
    sql: `SELECT count(*)::int AS n FROM keystone.booking b
           WHERE b.state = 'no_show'
             AND b.starts_at >= now() - interval '7 days' AND b.starts_at <= now()
             AND ${scoped('engagement', 'b')}` },
  { key: 'open_tasks', label: 'Open tasks', path: '/tasks/mine', band: 'work',
    sql: `SELECT count(*)::int AS n FROM keystone.task t
           WHERE t.closed_at IS NULL AND t.assignee_id = $1 AND ${scoped('task', 't')}` },
  { key: 'documents_awaiting_signature', label: 'Awaiting signature', path: '/documents/pipeline', band: 'work',
    sql: documentsAwaitingSignatureCountQuery('d') },

  // ── PEOPLE band (every viewer) ──
  { key: 'clients', label: 'Clients', path: '/people/clients', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.app_user u
           WHERE ${scoped('person', 'u')} AND u.role = 'adult_client'` },
  { key: 'new_clients_this_month', label: 'New this month', path: '/people/clients', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.app_user u
           WHERE u.role = 'adult_client' AND u.created_at >= date_trunc('month', now())
             AND ${scoped('person', 'u')}` },
  { key: 'open_leads', label: 'Open leads', path: '/people/leads', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.app_user u
           WHERE u.role IN ('adult_client','adolescent_client')
             AND u.lifecycle_status = 'lead'
             AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp WHERE bp.app_user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM keystone.entitlement e
                              WHERE e.owner_user_id = u.id AND e.status = 'active')
             AND ${notExecutedAnyDocumentFragment('u')}
             AND ${scoped('person', 'u')}` },
  { key: 'adolescents_awaiting_consent', label: 'Consent waiting', path: '/people/adolescents', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.app_user u
           WHERE u.role = 'adolescent_client' AND u.consent_status IN ('not_started','waiting')
             AND ${scoped('person', 'u')}` },
  // ★ FIX (the maintainer, live report 23 Sep 2026) — this tile links to `/people/all`, which excludes staff
  //   (`src/records/lists/people.mjs`'s own `peopleQuery(TYPE_EXPR, "u.role <> 'staff'")`) — a
  //   practice's own team is not one of its "people" in that list's sense. This count had no such
  //   filter, so it counted the Owner's own staff row too: Home read "People: 1" with nobody but
  //   the signed-in Owner in the practice, while the list the tile links to correctly showed none.
  { key: 'people', label: 'People', path: '/people/all', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.app_user u
           WHERE u.role <> 'staff' AND ${scoped('person', 'u')}` },
  { key: 'accounts', label: 'Accounts', path: '/accounts', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.account a
           WHERE a.status = 'active' AND ${scoped('account', 'a')}` },
  { key: 'sessions_this_week', label: 'Sessions this week', path: '/engagements/calendar', band: 'people',
    sql: `SELECT count(*)::int AS n FROM keystone.booking b
           WHERE b.state IN ('confirmed','pending_payment')
             AND b.starts_at BETWEEN now() AND now() + interval '7 days'
             AND ${scoped('engagement', 'b')}` },
]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HOME'S THREE REAL READS — TODAY · NEEDS YOU · THE WEEK AHEAD. [MOCKUPS.md §1]
//
// ★★★ THE MOCKUP ASKS FOR A HOME SCREEN THIS ROUTE COULD NOT DRAW. It shows a list of today's
//     sessions with the client, the service and an attendance control; a "needs you" queue with a
//     specific action per row; and a seven-day band of session counts. `/api/home` returned **six
//     integers**. Building that layout against six integers would have meant inventing the rows —
//     and the one rule this project will not bend is that a screen never prints a number or a name
//     the server did not give it. **So the reads are built, and the screen draws what they return.**
//
// ★★ EVERY QUERY BELOW USES `scoped(...)` AND `$1`, LIKE THE TILES ABOVE, FOR THE REASON RECORDED
//    THERE: a home screen that counts the whole tenant for a coach is a LEAK (it discloses the size
//    of what you may not see) and a LIE (you click through and get fewer). Home is the one screen
//    every role lands on, so it is the worst possible place to get scoping wrong.
//
// ★ They are SEPARATE from `HOME_TILES` because a tile is `{key,label,path,count}` and these are
//   rows. Folding them into the same array would make the route's loop branch on shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ Today's sessions, in the order they happen. `date_trunc('day', now())` is the tenant's own
 *  clock: `timezone` is set per tenant at connection time (`/readyz` probes it), so "today" here is
 *  the practice's today and not UTC's. */
export const HOME_TODAY_SQL = `
  SELECT b.id, b.starts_at, b.state,
         (SELECT s.name FROM keystone.service s WHERE s.id = b.service_id) AS service_name,
         (SELECT bool_or(bp.attended) FROM keystone.booking_participant bp
           WHERE bp.booking_id = b.id) AS attended,
         (SELECT string_agg(bp.display_name, ', ' ORDER BY bp.display_name)
            FROM keystone.booking_participant bp WHERE bp.booking_id = b.id) AS who
    FROM keystone.booking b
   WHERE b.starts_at >= date_trunc('day', now())
     AND b.starts_at <  date_trunc('day', now()) + interval '1 day'
     AND b.state IN ('confirmed','pending_payment','completed')
     AND ${scoped('engagement', 'b')}
     AND $1::uuid IS NOT NULL
   ORDER BY b.starts_at`;

/**
 * ★★★ "NEEDS YOU" IS THREE REAL BACKLOGS IN ONE ORDERED LIST, NOT A FEELING.
 *   Each row names WHAT, WHO, and the one thing to do about it — which is the shape MOCKUPS.md §1
 *   asks for, and it is only answerable from rows.
 *   · a session that has FINISHED and has nobody marked → **this is F443's symptom made visible.**
 *     A booking can close with no attendance recorded, and until now nothing anywhere said so.
 *   · a document sent and not signed
 *   · an invoice past its due date
 * ★★ `kind` drives the action label in the UI. It is an enum from the SERVER, so the button and the
 *    row cannot disagree about what kind of thing this is.
 * ★ LIMIT 12 — a queue you can read. ★★ And the route reports the FULL count separately, because a
 *   truncated list that does not say it is truncated is the silent-loss defect.
 */
export const HOME_NEEDS_YOU_SQL = `
  WITH unmarked AS (
    SELECT 'attendance'::text AS kind, b.id::text AS id, b.starts_at AS at,
           coalesce((SELECT s.name FROM keystone.service s WHERE s.id = b.service_id), 'Session') AS what,
           (SELECT string_agg(bp.display_name, ', ' ORDER BY bp.display_name)
              FROM keystone.booking_participant bp WHERE bp.booking_id = b.id) AS who,
           -- ★★★ THE RECORD TYPE, NOT A URL. This column used to build the href in SQL
           --     (a slash-prefixed literal concatenated with the id) and it was wrong twice over:
           --   1. A URL SHAPE IS A ROUTING CONCERN. The day the record route's path changes, three
           --      string concatenations buried in a query have to change with it, and nothing
           --      connects them to the route table. The route composes it now.
           --   2. ★★ IT BROKE A SOURCE-TEXT GUARD, which is how it was found.
           --      p6_descriptors_are_per_section asserts that this file declares no descriptors of
           --      its own by checking that NO LINE BEGINS WITH A QUOTED PATH. A SQL literal
           --      beginning with a slash is indistinguishable from a descriptor key to a regex over
           --      source text. The guard was right to fire; the string had no business being here.
           -- ★★★ AND NOTE WHAT THIS COMMENT MAY NOT CONTAIN: A BACKTICK. This whole query is a JS
           --     TEMPLATE LITERAL, so one backtick in a comment closes the string and the module
           --     stops parsing. It happened THREE TIMES in this one session (F438 and twice today).
           --     Prose here is plain: no backticks, ever.
           'booking'::text AS record_type
      FROM keystone.booking b
     WHERE b.ends_at < now()
       AND b.state IN ('confirmed','completed')
       -- ★★★ "NOBODY HAS SAID" IS attended IS NULL, AND THAT IS A MEASURED FACT ABOUT THE
       --     COLUMN RATHER THAN AN ASSUMPTION. MEASURED against the deployed schema: the attended
       --     column is boolean, NULLABLE, with NO DEFAULT -- so NULL is genuinely "unanswered" and
       --     is distinguishable from false, "they did not come".
       --   ★★ My first draft of this predicate named a column attendance_recorded_at. THAT COLUMN
       --      DOES NOT EXIST. The table is: id, tenant_id, booking_id, app_user_id, display_name,
       --      email, party, attended, optional. A query against a column that is not there does
       --      not return the wrong rows -- it throws, but only when something runs it, and this
       --      one would have shipped to the single screen every role lands on. One schema query
       --      caught it.
       --   ★★ AND NOTE THE SECOND MISTAKE IN THE SAME EDIT, recorded because it is a repeat: the
       --      comment I first wrote here spelled a column name inside BACKTICKS, inside a JS
       --      TEMPLATE LITERAL. It closed the string. Same shape as F438. No backticks below.
       --   ★ EXISTS-with-a-participant is required too: a booking with NO participants at all is a
       --     different problem (nobody was invited) and does not belong in this queue.
       AND EXISTS (SELECT 1 FROM keystone.booking_participant bp WHERE bp.booking_id = b.id)
       AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp
                        WHERE bp.booking_id = b.id AND bp.attended IS NOT NULL)
       AND ${scoped('engagement', 'b')}
  ), unsigned AS (
    ${unsignedInstanceQueueFragment('d')}
  ), overdue AS (
    SELECT 'invoice'::text, i.id::text, i.due_at,
           -- ★ invoice_number, not number. MEASURED from the schema; number does not exist.
           'Invoice ' || coalesce(i.invoice_number, ''),
           (SELECT u.display_name FROM keystone.app_user u WHERE u.id = i.payer_user_id),
           'invoice'::text
      FROM keystone.invoice i
      JOIN keystone.invoice_effective ie ON ie.id = i.id
     WHERE ie.status = 'open' AND i.due_at IS NOT NULL AND i.due_at < now()
       AND ${scoped('invoice', 'i')}
  )
  SELECT q.*, count(*) OVER ()::int AS total FROM (
    SELECT * FROM unmarked UNION ALL SELECT * FROM unsigned UNION ALL SELECT * FROM overdue
  ) q
  WHERE $1::uuid IS NOT NULL
  ORDER BY at NULLS LAST
  LIMIT 12`;

// ★★★ `count(*) OVER ()` IS NOT DECORATION, AND IT WAS ADDED BECAUSE THE TRUNCATION BIT ME INSIDE
//     THE HOUR. The comment above this query already said *"a truncated list that does not say it
//     is truncated is the silent-loss defect"* — and then the first run of `ui_home_reads.mjs`
//     reported the attendance branch as BROKEN. It was not. The local seed database holds enough
//     older unsigned documents that, ordered oldest-first, the fixture's three-hour-old booking
//     sat at position 13 and fell off the LIMIT. **A correct query, a correct predicate, and a
//     conclusion of "0 rows, therefore broken."**
//   ★★ The window function counts the rows BEFORE the limit is applied, so it is the true size of
//      the backlog, in the same round trip. The screen can then say "and 9 more" instead of
//      quietly showing twelve things and implying that is all there is.
//   ★ It is on every row (a window function has to be) — the route reads it off the first and
//     drops it, so nothing downstream has to know.

/** ★ Seven days from today, ONE ROW PER DAY INCLUDING THE EMPTY ONES — `generate_series`, not a
 *  `GROUP BY` over bookings. A band that silently omits a quiet Thursday is a band whose day cards
 *  do not line up with the week, and the reader has no way to tell. */
export const HOME_WEEK_SQL = `
  SELECT d::date AS day,
         -- ★ the screen keys and labels on a plain 'YYYY-MM-DD' string: a date column arrives as an
         --   object that JSON-encodes to {} — seven identical keys, and Home crashed (26 Sep 2026).
         to_char(d, 'YYYY-MM-DD') AS date,
         (SELECT count(*)::int FROM keystone.booking b
           WHERE b.starts_at >= d AND b.starts_at < d + interval '1 day'
             AND b.state IN ('confirmed','pending_payment','completed')
             AND ${scoped('engagement', 'b')}) AS n
    FROM generate_series(date_trunc('day', now()),
                         date_trunc('day', now()) + interval '6 days',
                         interval '1 day') AS d
   WHERE $1::uuid IS NOT NULL
   ORDER BY d`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TOUCH-UP · WORKSTREAM 9.4 — "TEAM TODAY", OWNER/ADMIN ONLY. Not scoped by `scoped('engagement')`
// on purpose: that predicate is "owned by the VIEWER", and this read's whole point is every OTHER
// staff member's day too. The route only ever runs it for `isOwner` (same guard `needsIntake`
// already uses) — a coach hitting this query directly would just get their own single row, but
// nothing routes them to it, so the practice-wide shape stays behind the same door as the rest of
// Home's owner-only content.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const HOME_TEAM_TODAY_SQL = `
  SELECT u.id, u.display_name,
         count(*)::int AS n,
         count(*) FILTER (WHERE b.ends_at < now() AND
           (SELECT bool_or(bp.attended) FROM keystone.booking_participant bp
             WHERE bp.booking_id = b.id) IS NOT TRUE)::int AS unmarked,
         min(b.starts_at) FILTER (WHERE b.starts_at >= now()) AS next_at
    FROM keystone.booking b
    JOIN keystone.app_user u ON u.id = b.host_id
   WHERE b.starts_at >= date_trunc('day', now())
     AND b.starts_at <  date_trunc('day', now()) + interval '1 day'
     AND b.state IN ('confirmed','pending_payment','completed')
     AND u.role = 'staff' AND u.archived_at IS NULL
   GROUP BY u.id, u.display_name
   ORDER BY u.display_name`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 17.27 — HERO METRICS FOR OWNER HOME. This month's and last month's succeeded payments,
//     both in minor units (cents). These values are separate so the handler can compute the delta
//     sentence: "▲ $1,340 on August" or "since you started" for first-weeks practices. Connect-gated:
//     returns NULL if Stripe Connect is not live (same gate as paid_this_month).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const HOME_HERO_SQL = `
  SELECT CASE WHEN ${STRIPE_LIVE_SQL}
              THEN coalesce(sum(p.amount_minor), 0)::int ELSE NULL END AS this_month_minor,
         CASE WHEN ${STRIPE_LIVE_SQL}
              THEN coalesce((SELECT sum(p2.amount_minor)::int
                              FROM keystone.payment_effective p2
                             WHERE p2.status IN ('succeeded', 'partially_refunded')
                               AND p2.created_at >= date_trunc('month', now()) - interval '1 month'
                               AND p2.created_at < date_trunc('month', now())
                               AND ${scoped('payment', 'p2')}), 0)::int ELSE NULL END AS last_month_minor,
         (SELECT min(p3.created_at)
            FROM keystone.payment_effective p3
           WHERE p3.status IN ('succeeded', 'partially_refunded') AND ${scoped('payment', 'p3')}) AS first_payment_at
    FROM keystone.payment_effective p
   WHERE p.status IN ('succeeded', 'partially_refunded')
     AND p.created_at >= date_trunc('month', now())
     AND ${scoped('payment', 'p')}`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 17.27 — STAFF PEOPLE METRICS. Count of clients assigned to the viewer (staff), count
//     of drifting clients (no booking ≥6 weeks, didn't cancel), and count of unsigned documents
//     from this week. Scoped to the viewer's own clients, staff-only.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const HOME_STAFF_PEOPLE_SQL = `
  SELECT (SELECT count(distinct u.id)::int
            FROM keystone.app_user u
           WHERE u.role <> 'staff' AND u.archived_at IS NULL
             AND ${scoped('person', 'u')}) AS clients,
         (SELECT count(distinct u.id)::int
            FROM keystone.app_user u
           WHERE u.role <> 'staff' AND u.archived_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM keystone.booking b
                               JOIN keystone.booking_participant bp ON bp.booking_id = b.id  -- no booking.person_id
                              WHERE bp.app_user_id = u.id
                                AND b.starts_at > now() - interval '42 days'
                                AND b.state != 'cancelled')
             AND ${scoped('person', 'u')}) AS drifting,
         ${instancesStartedTodayCountExpr('di')} AS notes_to_write`;

