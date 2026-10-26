// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE ACCOUNTS SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B3 — THE NINE ACCOUNTS ROWS. P6.14 … P6.22.
//
// ★★★ EVERY ONE OF THE SEVEN RUN ROWS DRIVES OFF `account`, NOT OFF `run_schedule_item`, AND THAT
//     IS §A3's RULING, NOT A CONVENIENCE. `sections.mjs:145` quotes it verbatim:
//     *"Not connected renders as an EMPTY ROW, NEVER A HIDDEN TAB."* A query anchored on the
//     schedule item would make an unconnected account DISAPPEAR from the Search Console tab —
//     which is precisely the hidden tab, arriving one layer down where a reviewer looking at the
//     renderer would never see it. So the account is the left side of every join and the absence
//     of a grant is rendered as a WORD.
//   ★★ [MEASURED 2026-09-15 against the live database] `account_grant`, `google_identity`,
//      `google_resource`, `run_reading`, `run_metric` and `run_schedule_item` all hold **0 rows**,
//      and `account` holds **3**. So today every Run row renders three accounts, each saying it has
//      never granted access. That is the honest state — KS-3/`F72` block the pull on three Google
//      approvals, *"weeks, not days"* — and it is a very different screen from a blank one.
//
// ★★★ AND NOTHING HERE CALLS GOOGLE. P20.7 forbids it outright; these are SELECTs over our own
//     cache. The age of the cache is therefore the most important thing on the screen, which is why
//     `age` is a column on every Run list and is never null — see AGE_TEXT.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  scoped, emptyOf,
} from "./_shared.mjs";
// ★★★ THE THREE RUN CONSTANT MODULES ARE IMPORTED, NOT TRANSCRIBED. Every service name, every
//     sampling cap, every write-scope disclosure and every "what the human must do" sentence below
//     is GENERATED from the module that already owns it. A transcribed copy is the `F142`/`F146`
//     class: a second declaration that is right on the day it is written and silently wrong after
//     the first edit to the original.
import { GOOGLE_SERVICES } from "../../run/grants.mjs";
import { SAMPLED_ITEMS } from "../../run/catalogue.mjs";
import { RUN_FACTS, SCOPE_DISCLOSURE } from "../../run/blocked.mjs";

// ★ SQL string literal. Everything fed to it is one of OUR OWN frozen constants — never a request
//   value — but the doubling is written anyway, because "no caller can reach this" is a property of
//   today's callers and not of the function.
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE GRANT FACTS, AS ONE FRAGMENT, DECLARED ONCE AND USED BY ALL SIX RUN LISTS.
//
//   This is a direct transcription of `resolveGrant()` (src/run/schedule.mjs:421) into a LATERAL:
//   the SAME three tables, the SAME join, the SAME `revoked_at IS NULL`, the SAME `ORDER BY
//   granted_at DESC LIMIT 1`. ★★ AND THE SAME BRANCH ORDER — grant_state is tested BEFORE
//   disappeared_at. `classifyRunFact` tests resource_lost first, but it reads `because` from
//   `resolveGrant`, so resolveGrant's order is the one that reaches a screen. Matching the
//   classifier instead of the producer would have made this list disagree with the Run pipeline
//   about the same account.
//
// ★★ WHY A COPY EXISTS AT ALL, SAID PLAINLY RATHER THAN HIDDEN: `resolveGrant()` answers for ONE
//    (account, service) and returns a JS object. A list descriptor is pure SQL over EVERY account at
//    once and cannot call it. So the fragment is declared HERE, ONCE, and interpolated six times —
//    one copy in this file rather than six. ★ It is still a second declaration of one rule, and that
//    is recorded as a finding in the handoff rather than left for somebody to discover.
//
// ★ NO `tenant_id` PREDICATE, DELIBERATELY — `_shared.mjs`'s header rules it: FORCE RLS applies
//   `tenant_id = current_tenant_id()` to every one of these tables and a hand-written second
//   predicate is the copy that drifts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const grantFacts = (accountAlias, serviceSql) => `
  LEFT JOIN LATERAL (
    SELECT g.id AS grant_id, g.granted_at, i.grant_state, r.disappeared_at,
           coalesce(r.display_name, r.external_id) AS property
      FROM keystone.account_grant g
      JOIN keystone.google_resource r ON r.id = g.resource_id
      JOIN keystone.google_identity i ON i.id = r.identity_id
     WHERE g.account_id = ${accountAlias}.id
       AND g.service = ${serviceSql}
       AND g.revoked_at IS NULL
     ORDER BY g.granted_at DESC
     LIMIT 1
  ) gr ON true`;

/** ★ resolveGrant's four outcomes, in resolveGrant's own order. Rendered as an `enum`, so
 *   `formatValue` prints "Never granted" rather than a token. */
const CONNECTION = `
  CASE WHEN gr.grant_id IS NULL                 THEN 'never_granted'
       WHEN gr.grant_state <> 'usable'          THEN 'reconsent_required'
       WHEN gr.disappeared_at IS NOT NULL       THEN 'property_gone'
       ELSE 'connected' END`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THE HUMAN MUST DO — GENERATED FROM `RUN_FACTS`, THE MODULE THAT ALREADY DECIDED IT.
//     P20.9a's whole argument is that three blocked facts need THREE DIFFERENT HUMAN ACTIONS, and
//     that telling a client to re-consent when they removed one property is *"how you lose them"*.
//     Those three sentences are already written, once, in `src/run/blocked.mjs`. Retyping them here
//     would put the product's most consequential wording in two places.
// ★ `connected` yields NULL on purpose — `formatValue` renders the caller's `—`, and an action
//   column that invents work for a healthy row is a checker crying wolf.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const NEXT_ACTION = `
  CASE WHEN gr.grant_id IS NULL           THEN ${lit(RUN_FACTS.never_granted.taskTitle)}
       WHEN gr.grant_state <> 'usable'    THEN ${lit(RUN_FACTS.grant_lost.taskTitle)}
       WHEN gr.disappeared_at IS NOT NULL THEN ${lit(RUN_FACTS.resource_lost.taskTitle)}
       ELSE NULL END`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE AGE, AND THE STALENESS WORD IN THE SAME CELL AS THE AGE.
//
//   P20.8 names three failures — a spinner, a blank, and AN UNLABELLED STALE NUMBER — and
//   `RunServiceCard.jsx` records why the third is the subtle one: *"A number with no age is read as
//   current."* So this column:
//     · is rendered on EVERY path, including the healthy one, so a reader never learns that the
//       age's ABSENCE means "fine";
//     · is never NULL — "never read successfully" is a value, not a blank;
//     · carries the word STALE **as text, inside the same cell as the age**, never as a colour or a
//       class. A reader who cannot see colour, or who is reading a screenshot, must still be told.
//
// ★★ THE BUCKETS MIRROR `formatAge()` (min / hours / days) so the table and the card cannot
//    disagree about how old the same reading is.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const AGE_TEXT = `
  CASE
    WHEN ok.fetched_at IS NULL THEN 'never read successfully'
    ELSE
      CASE WHEN bad.fetched_at IS NOT NULL AND bad.fetched_at > ok.fetched_at
           THEN 'STALE — last good reading, ' ELSE '' END
      ||
      CASE
        WHEN now() - ok.fetched_at < interval '1 hour'
          THEN greatest(1, floor(extract(epoch FROM now() - ok.fetched_at) / 60))::text || ' min ago'
        WHEN now() - ok.fetched_at < interval '1 day'
          THEN floor(extract(epoch FROM now() - ok.fetched_at) / 3600)::text || ' hours ago'
        ELSE floor(extract(epoch FROM now() - ok.fetched_at) / 86400)::text || ' days ago'
      END
  END`;

/** ★★ P20.7b — a SAMPLED number must say so, and the cap comes from `SAMPLED_ITEMS`, which exists
 *   *"so the screen states it; a screen that has to know the number itself is a screen that can be
 *   wrong"*. Built from the catalogue at module load, so adding a sampled item needs no edit here. */
const SAMPLING = (() => {
  const arms = Object.entries(SAMPLED_ITEMS)
    .map(([item, v]) => `WHEN si.item = ${lit(item)} THEN ${lit(v.screenLabel)}`);
  return arms.length ? `CASE ${arms.join(" ")} ELSE NULL END` : `NULL::text`;
})();

/** ★ The newest SUCCESS and the newest FAILURE, separately — `newestReading()`'s requirement,
 *  because a single "newest row" shows a failure with nothing to display, and a single "newest
 *  success" hides that the last three attempts failed. */
const readingLaterals = (accountAlias, serviceSql) => `
  LEFT JOIN LATERAL (
    SELECT rr.fetched_at, rr.row_count
      FROM keystone.run_reading rr
     WHERE rr.account_id = ${accountAlias}.id AND rr.service = ${serviceSql}
       AND rr.item = si.item AND rr.ok = true
     ORDER BY rr.fetched_at DESC LIMIT 1
  ) ok ON true
  LEFT JOIN LATERAL (
    SELECT rr.fetched_at, rr.failure_class, rr.http_status
      FROM keystone.run_reading rr
     WHERE rr.account_id = ${accountAlias}.id AND rr.service = ${serviceSql}
       AND rr.item = si.item AND rr.ok = false
     ORDER BY rr.fetched_at DESC LIMIT 1
  ) bad ON true`;

/** ★★ Columns shared by all five service tabs, so two Run tabs cannot disagree about what "Age"
 *   means — the same reason `PERSON_COLUMNS` exists in `_shared.mjs`. */
const RUN_COLUMNS = Object.freeze([
  { field: 'account',      label: 'Account',    format: 'text' },
  { field: 'item',         label: 'Item',       format: 'enum' },
  { field: 'connection',   label: 'Connection', format: 'enum' },
  { field: 'delivery',     label: 'Delivery',   format: 'enum' },
  { field: 'rows_read',    label: 'Rows read',  format: 'number' },
  { field: 'last_read',    label: 'Last read',  format: 'datetime' },
  { field: 'age',          label: 'Age',        format: 'text' },
  { field: 'next_action',  label: 'Next step',  format: 'text' },
]);

/**
 * ★★★ ONE BUILDER FOR THE FIVE SERVICE TABS (P6.16–P6.20). The table says of P6.17–P6.20
 *     *"build, same shape"*, and five hand-written near-copies would be five chances to drop the
 *     age column from one of them — the one nobody looked at.
 *
 * @param service   one of run_reading's service values
 * @param label     the nav row's own label, so the heading matches the sidebar
 * @param empty     the sentence P4.10 requires; ScreenState THROWS without one
 * @param extra     service-specific columns (the sampling cap; the write-scope disclosure)
 */
// ★★ `emptyState` TRAVELS WITH `empty`. The builder destructures its parameters by name, so a
//    key it does not name is silently DROPPED — which is exactly what happened to these four
//    descriptors on the first pass: they carried the spread, the spread was discarded, and the
//    screens quietly fell back to the legacy string with no headline and no action. A sweep
//    counting `emptyState` found it; nothing errored.
function runServiceList({ service, label, empty, emptyState, extraColumns = [], extraSelect = "" }) {
  const svc = lit(service);
  return {
    title: label,
    // ★ NO `recordType`. A (account × item) row is not a record you can open — its `id` is a
    //   composite, and handing that to /record/account/:id would be a link to a 404. Seven of the
    //   existing 29 descriptors decline `recordType` for the same reason (availability rules,
    //   templates, jobs).
    columns: [...RUN_COLUMNS, ...extraColumns],
    empty,
    emptyState,
    sql: `
      SELECT a.id || ':' || coalesce(si.item, '-') AS id,
             a.name AS account,
             coalesce(si.item, 'not_scheduled')    AS item,
             ${CONNECTION}                         AS connection,
             -- ★★ si.state IS THE PIPELINE'S OWN WORD, not a second classification. P20.9a's five
             --    states are decided by classifyRunFact and written to this column by
             --    advanceSchedule; reading it back is the only way this list and the worker can be
             --    guaranteed to agree. 'not_scheduled' NAMES THE ABSENCE of a row rather than
             --    leaving a blank, which B2.5 says reads as a rendering glitch.
             coalesce(si.state, 'not_scheduled')   AS delivery,
             ok.row_count                          AS rows_read,
             ok.fetched_at                         AS last_read,
             ${AGE_TEXT}                           AS age,
             ${NEXT_ACTION}                        AS next_action${extraSelect}
        FROM keystone.account a
        -- ★★★ LEFT JOIN, AND THIS IS §A3: an account with no schedule item for this service is an
        --     EMPTY ROW, never a hidden one.
        LEFT JOIN keystone.run_schedule_item si
               ON si.account_id = a.id AND si.service = ${svc}
        ${grantFacts('a', svc)}
        ${readingLaterals('a', svc)}
       WHERE ${scoped('account', 'a')}
       ORDER BY a.name, coalesce(si.item, '-'), id`,
  };
}

/** ★★ P20.9c — the disclosure is rendered for the two scopes whose WRITE AUTHORITY IS UNAVOIDABLE,
 *   and the string is `SCOPE_DISCLOSURE`'s own, verbatim. P20.9c is exact about where this belongs:
 *   *"in the consent copy and in the contract — NOT in a `scope` column that pretends there was a
 *   choice."* ★★★ It is rendered on EVERY row regardless of `connection`, so it is on the screen
 *   BEFORE anybody consents, which is the only moment at which it can do any good. */
const disclosureFor = (service) => {
  const entry = Object.values(SCOPE_DISCLOSURE).find((d) => d.service === service);
  if (!entry) throw new Error(`no SCOPE_DISCLOSURE entry for "${service}"`);
  return entry;
};
const disclosureColumn = (service) => ({
  columns: [{ field: 'authority', label: 'What the connection grants', format: 'text' }],
  select: `,\n             ${lit(disclosureFor(service).disclosure)} AS authority`,
  sentence: disclosureFor(service).disclosure,
});

// ★ Declared once and used by both `/accounts` and `/accounts/all` — P6.15's PROVES is literally
//   *"the clicked row renders what the header renders"*, and two SQL strings cannot promise that.
const ACCOUNT_COLUMNS = Object.freeze([
  { field: 'name',      label: 'Account',   format: 'text' },
  { field: 'status',    label: 'Status',    format: 'enum' },
  // ★★★ U11 — A COUNT COLUMN, NEVER A NAME COLUMN, and it comes from the SECURITY DEFINER
  //     function whose return type is five integers. A list of accounts is exactly where
  //     somebody would otherwise join app_user to show "who is on this account".
  { field: 'seats',     label: 'Seats',     format: 'number' },
  { field: 'pipelines', label: 'Pipelines', format: 'text' },
]);
const ACCOUNT_SQL = `
      SELECT a.id, a.name, a.status,
             (SELECT sc.total_seats FROM keystone.account_seat_counts(a.id) sc) AS seats,
             (SELECT string_agg(p.kind || ': ' || p.state, ' · ' ORDER BY p.kind)
                FROM keystone.account_pipeline p WHERE p.account_id = a.id) AS pipelines
        FROM keystone.account a
       WHERE ${scoped('account', 'a')}
         AND $1::uuid IS NOT NULL
       ORDER BY a.name, a.id`;
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S2.2 — `/accounts` AND `/accounts/all` SHARE ONE EMPTY STATE **BY REFERENCE, NOT BY COPY**, which
// is the rule the two descriptors below already followed for their columns and their SQL.
//
// ★★★ AND IT IS A **ROOT** SCREEN (F372). Six other screens — the four Build-Wire-Run lists,
//     Monitoring and Access — go empty for want of an account; nothing makes THIS one empty except
//     not having started. So it is `first-run` with a create action, never `blocked`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TOUCH-UP · WORKSTREAM 6.3 — RESTORED after an agent's `git checkout` accidentally discarded
//     this fix (Part 3.4 correction, 23 Sep 2026). Ported from `EmptyAccounts.frame.html` (read
//     fresh). The PREVIOUS copy here described the RUN vertical's "sites, services and reporting"
//     account — the wrong product for every practice-side screen: an account here is WHOEVER PAYS
//     (a family, an employer), never a website.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ACCOUNT_EMPTY_STATE = emptyOf({
  kind: 'first-run',
  icon: 'IconBuilding',
  headline: 'Group people who pay together',
  line: "An account is whoever pays: a family paying for a teenager, or an employer paying for "
      + "staff. Invoices go to the account, sessions stay with each person.",
  action: { label: 'Create an account', href: '/accounts?new=1' },
});

export const ACCOUNTS_LISTS = Object.freeze({
  // ── P6.14 · the section header. It also REDIRECTS to /accounts/all (sectionRedirects.mjs), so
  //    this descriptor is what the redirect target must agree with, not a screen people land on.
  '/accounts': {
    title: 'Accounts', recordType: 'account',
    columns: ACCOUNT_COLUMNS, ...ACCOUNT_EMPTY_STATE, sql: ACCOUNT_SQL,
  },

  // ── Task 12.35 (OQ-12.4) — the '/accounts/all' descriptor is REMOVED from here: the row is now
  //    a dedicated screen backed by C3.4's payer-groups API (`registerPayerGroupsRoutes`), not this
  //    generic LIST_VIEWS SQL descriptor. `/accounts` (above) stays as the section header redirect
  //    target — untouched.

  // ── P6.16 · Search Console ──────────────────────────────────────────────────
  '/accounts/search-console': runServiceList({
    service: 'search_console',
    label: 'Search Console',
    extraColumns: [{ field: 'sampling', label: 'Sampling', format: 'text' }],
    extraSelect: `,\n             ${SAMPLING} AS sampling`,
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconSearch',
      headline: 'No accounts to read Search Console for',
      line: 'Every account appears here whether or not it has connected — connecting changes the Connection column, not whether the row exists.',
      action: null,
      blockedAction: { label: 'Add account', href: '/accounts?new=1' },
      blockedLine: 'You have no accounts yet, so there is nothing to read Search Console for.',
    }),
  }),

  // ── P6.17 · Google Ads ──────────────────────────────────────────────────────
  // ★★★ ITS PROVES IS THE DISCLOSURE, NOT THE CHART: *"the write-scope disclosure (KS-3) renders
  //     before any consent"*. [MEAS] Google Ads is `.../auth/adwords` — SINGULAR, with no
  //     `.readonly` variant — so connecting an account "for read-only reporting" necessarily hands
  //     this product the technical ability to change what a client SPENDS. The sentence is in the
  //     empty state AND on every row, so there is no state of this screen in which it is absent.
  '/accounts/google-ads': runServiceList({
    service: 'google_ads',
    label: 'Google Ads',
    extraColumns: disclosureColumn('google_ads').columns,
    extraSelect: disclosureColumn('google_ads').select,
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconSpeakerphone',
      headline: 'No accounts to read Google Ads for',
      line: 'Campaign spend appears against each account once Google Ads is linked to it.',
      action: null,
      blockedAction: { label: 'Add account', href: '/accounts?new=1' },
      blockedLine: 'You have no accounts yet, so there is no ad spend to report.',
    }),
  }),

  // ── P6.18 · Analytics ───────────────────────────────────────────────────────
  '/accounts/analytics': runServiceList({
    service: 'analytics',
    label: 'Analytics',
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconChartArea',
      headline: 'No accounts to read Analytics for',
      line: 'Traffic and conversions appear against each account once a property is linked.',
      action: null,
      blockedAction: { label: 'Add account', href: '/accounts?new=1' },
      blockedLine: 'You have no accounts yet, so there is no analytics data to report.',
    }),
  }),

  // ── P6.19 · Business Profile ────────────────────────────────────────────────
  // ★★★ The second unavoidable-write scope: `.../auth/business.manage` has no read-only form
  //     either, so the same disclosure rule applies — hours, posts and replies to reviews.
  '/accounts/business-profile': runServiceList({
    service: 'business_profile',
    label: 'Business Profile',
    extraColumns: disclosureColumn('business_profile').columns,
    extraSelect: disclosureColumn('business_profile').select,
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconMapPin',
      headline: 'No accounts to read Business Profile for',
      line: 'Reviews and map listings appear against each account once a profile is linked.',
      action: null,
      blockedAction: { label: 'Add account', href: '/accounts?new=1' },
      blockedLine: 'You have no accounts yet, so there are no profiles to read.',
    }),
  }),

  // ── P6.20 · Monitoring ──────────────────────────────────────────────────────
  // ★★ `monitoring` IS NOT A GOOGLE SERVICE. It is in `run_reading`'s CHECK and in `RUN_ITEMS`, but
  //    NOT in `GOOGLE_SERVICES` and NOT in `account_grant`'s CHECK — so `grantFacts` can never find
  //    a row for it and Connection would read "never granted" forever, which would be a lie about a
  //    probe that needs no consent at all. Hence its own shape: schedule state and reading age only.
  '/accounts/monitoring': {
    title: 'Monitoring',
    columns: [
      { field: 'account',   label: 'Account',   format: 'text' },
      { field: 'item',      label: 'Item',      format: 'enum' },
      { field: 'delivery',  label: 'Delivery',  format: 'enum' },
      { field: 'rows_read', label: 'Rows read', format: 'number' },
      { field: 'last_read', label: 'Last read', format: 'datetime' },
      { field: 'age',       label: 'Age',       format: 'text' },
      { field: 'failure',   label: 'Last failure', format: 'text' },
    ],
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconActivity',
      headline: 'Nothing being monitored yet',
      line: 'Uptime and error checks run against each account\'s own site — no Google consent needed.',
      action: null,
      blockedAction: { label: 'Add account', href: '/accounts?new=1' },
      blockedLine: 'You have no accounts yet, so there is nothing to monitor.',
    }),
    sql: `
      SELECT a.id || ':' || coalesce(si.item, '-') AS id,
             a.name AS account,
             coalesce(si.item, 'not_scheduled')  AS item,
             coalesce(si.state, 'not_scheduled') AS delivery,
             ok.row_count                        AS rows_read,
             ok.fetched_at                       AS last_read,
             ${AGE_TEXT}                         AS age,
             -- ★★ THE FAILURE IS NAMED, NOT HIDDEN. failure_class is the thing that tells an
             --    operator which action to take, and P20.6 kept the ok=false row specifically so it
             --    could be said.
             CASE WHEN bad.fetched_at IS NULL THEN NULL
                  ELSE bad.failure_class ||
                       coalesce(' (' || bad.http_status::text || ')', '') END AS failure
        FROM keystone.account a
        LEFT JOIN keystone.run_schedule_item si
               ON si.account_id = a.id AND si.service = 'monitoring'
        ${readingLaterals('a', "'monitoring'")}
       WHERE ${scoped('account', 'a')}
       ORDER BY a.name, coalesce(si.item, '-'), id`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ── P6.21 · Access ──────────────────────────────────────────────────────────
  // ★★★ ONE ROW PER (ACCOUNT × GOOGLE SERVICE), AND THE SERVICE LIST IS `GOOGLE_SERVICES` ITSELF.
  //     Four names typed out here would be a fifth place they are written down; `unnest` over the
  //     frozen array means adding a service changes this screen with no edit.
  //  ★★ `monitoring` IS DELIBERATELY ABSENT — `account_grant.service`'s CHECK does not admit it,
  //     so a monitoring row on an ACCESS screen would be a row about a grant that cannot exist.
  //
  // ★★★ WHAT IS NOT HERE, AND WHY — READ THIS BEFORE ADDING IT.
  //   1. **There is no "Request access" button.** The mockup draws one (`crm-mockup.html:836`) and
  //      there is nothing behind it: [MEAS] `bindAccountGrant()` needs a `resource_id` from
  //      `google_resource`, that table has ZERO rows, and it is populated only by OAuth discovery,
  //      which KS-3/`F72` block on three Google approvals. A button that cannot bind anything is a
  //      dead control, and DEFECT 3's rule is that a dead control is the same lie as a dead link.
  //      ★ The ASK it stands for is already made without it: the Run pipeline emits
  //      `run.item.blocked`, which opens the `chase_the_grant` chain (`src/tasks/chains.mjs:86`).
  //      The Next-step column below names the same three actions, from the same module.
  //   2. **There is no "not on your plan" state.** P6.22's PROVES asks for three states, the third
  //      being an ENTITLEMENT refusal. [MEASURED against the live catalog] there is no entitlement
  //      store for product features: `keystone.entitlement` is SESSION CREDITS keyed on
  //      `owner_user_id`/`service_id`, `keystone.plan` is a billing plan with no feature column, and
  //      `authoriseSection()` gates on `minRole` and `foundryOnly` only. Rendering a plan state would
  //      mean inventing the store that decides it. Raised in the handoff instead.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  '/accounts/access': {
    title: 'Access',
    columns: [
      { field: 'account',     label: 'Account',   format: 'text' },
      { field: 'service',     label: 'Service',   format: 'enum' },
      { field: 'access',      label: 'Access',    format: 'enum' },
      { field: 'property',    label: 'Property',  format: 'text' },
      { field: 'granted',     label: 'Granted',   format: 'datetime' },
      { field: 'next_action', label: 'Next step', format: 'text' },
      { field: 'authority',   label: 'What the connection grants', format: 'text' },
    ],
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconKey',
      headline: 'No access granted yet',
      line: 'What each account has let us reach, service by service.',
      action: null,
      blockedAction: { label: 'Add account', href: '/accounts?new=1' },
      blockedLine: 'You have no accounts yet, so there is no access to show.',
    }),
    sql: `
      SELECT a.id || ':' || svc.service AS id,
             a.name  AS account,
             svc.service,
             ${CONNECTION} AS access,
             gr.property,
             gr.granted_at AS granted,
             ${NEXT_ACTION} AS next_action,
             -- ★★★ P20.9c — the disclosure is a fact about the SCOPE, so it is rendered for every
             --     account whether or not it has consented. Two of the four have no read-only form
             --     at all and the words say so.
             CASE ${Object.values(SCOPE_DISCLOSURE)
                     .map((d) => `WHEN svc.service = ${lit(d.service)} THEN ${lit(d.disclosure)}`)
                     .join("\n                  ")}
                  ELSE NULL END AS authority
        FROM keystone.account a
        CROSS JOIN unnest(ARRAY[${GOOGLE_SERVICES.map(lit).join(", ")}]) AS svc(service)
        ${grantFacts('a', 'svc.service')}
       WHERE ${scoped('account', 'a')}
       ORDER BY a.name, svc.service, id`,
  },

  // ── P6.22 · Reports ─────────────────────────────────────────────────────────
  // ★★★ IT READS `report_run_monthly`, WHICH READS `run_metric` — **NOT** `run_reading`. 0059's own
  //     header records why: rendering a month out of `run_reading` detoasts ~120 jsonb blobs per
  //     account (~1,460 for a 12-month trend). *"That is not a report, it is a scan"* — and it would
  //     return CORRECT NUMBERS, so nothing would fail until the account count grew.
  //  ★★ `days_with_data` IS A COLUMN, not a footnote: a month with three readings must not be
  //     mistaken for a month with thirty, and the total alone cannot tell them apart.
  //  ★ The view is `security_invoker`, so RLS applies as the caller — but RLS is TENANT isolation,
  //    not the per-grant scope. The join to `account` is what lets `scoped()` do the second half.
  '/accounts/reports': {
    title: 'Reports',
    columns: [
      { field: 'month',          label: 'Month',          format: 'date' },
      { field: 'account',        label: 'Account',        format: 'text' },
      { field: 'service',        label: 'Service',        format: 'enum' },
      { field: 'metric',         label: 'Metric',         format: 'enum' },
      { field: 'total',          label: 'Total',          format: 'number' },
      { field: 'daily_average',  label: 'Daily average',  format: 'number' },
      { field: 'days_with_data', label: 'Days with data', format: 'number' },
    ],
    ...emptyOf({
      kind: 'period',
      icon: 'IconFileAnalytics',
      headline: 'No reports yet',
      line: 'Monthly reports generate at month end, once the Run worker has ingested a day of data.',
      action: null,
    }),
    sql: `
      SELECT rm.account_id || ':' || rm.month::text || ':' || rm.service || ':' || rm.metric AS id,
             rm.month, a.name AS account, rm.service, rm.metric,
             rm.total, round(rm.daily_average, 2) AS daily_average, rm.days_with_data
        FROM keystone.report_run_monthly rm
        JOIN keystone.account a ON a.id = rm.account_id
       WHERE ${scoped('account', 'a')}
       ORDER BY rm.month DESC, a.name, rm.service, rm.metric, id`,
  },
});
