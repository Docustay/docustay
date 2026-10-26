import { ownerExpr, OWNERSHIP, permissionObjectFor } from "../permissions/ownership.mjs";
import { ARCHIVABLE } from "./archive.mjs";
import {
  documentRecordSql, documentEventsAboutPersonFragment, personDocumentsRelatedSql,
  documentInstanceTable, documentInstanceTableName,
} from "../documents/api.mjs";

// P15.5 / P15.5a — THE READ QUERIES. THEY DID NOT EXIST.
//
// ★★★ THIS IS NOT "SCREENS OVER EXISTING READS". THERE WERE NO READS.
// [MEAS, ADDENDUM 1] Out of 75 nav rows, exactly FOUR had a `SELECT` anywhere in `src/`:
// /settings/notifications · /settings/integrations · /platform/tenants · /platform/provisioning.
// `shell.mjs`, `sections.mjs`, `authorise.mjs`, `surfaces.mjs` and `vocabulary.mjs` contain ZERO
// SQL and ZERO database calls between them. `buildRecordShell(typeKey, row)` TAKES THE ROW AS AN
// ARGUMENT — and the query that would produce that row did not exist anywhere in the project.
// This file is that query, for every record type and every Phase 15 list.
//
// ★★★ AND IT IS WRITTEN AGAINST A CONTRACT IT CANNOT SILENTLY FAIL.
// `shell.mjs` throws when a declared highlight key is ABSENT from the row. So a derivation that
// is forgotten here is a loud error on the record page, not a blank cell. `DERIVATIONS` below is
// cross-checked against the descriptors by db/gates/p15_crm_screens.mjs IN BOTH DIRECTIONS:
// every `derived:<name>` in a descriptor must exist here, and every derivation here must be
// claimed by a descriptor. An orphan in either direction is a finding.
//
// ★★ EVERY COLUMN IS LISTED EXPLICITLY. Never `SELECT *`: a later migration adding a column must
// not silently start shipping it to a client.
//
// ★ NO QUERY HERE CARRIES A tenant_id PREDICATE, AND THAT IS CORRECT, NOT AN OVERSIGHT.
// Every one runs inside `withTenant()`, where FORCE row-level security applies
// `tenant_id = keystone.current_tenant_id()` to every table. Writing the predicate by hand as
// well would be a SECOND isolation mechanism that can drift from the first — and the one that
// drifts is always the hand-written one. The tenant-predicate lint checks the route opens a
// tenant scope; Postgres enforces the boundary.

// ═════════════════════════════════════════════════════════════════════════════
// THE DERIVATION REGISTRY — P15.2(b), "SAY WHERE EACH VALUE COMES FROM"
// ═════════════════════════════════════════════════════════════════════════════
//
// ★★★ FOUR OF THE PERSON'S SIX U3 VALUES ARE DERIVED BECAUSE THE COLUMNS DO NOT EXIST.
// [MEAS 2026-09-13, information_schema] `app_user` is (id, tenant_id, email, display_name, role,
// created_at, updated_at, staff_role, firebase_uid). There is NO coach_id, NO engagement column,
// NO progress column and NO next-session column anywhere in the 41 tables. §D6 rules that the
// pinned panel carries them, so they are COMPUTED from tables that do exist. The requirement was
// met; it was not lowered, and no column was invented to make it look easy.
//
// ★★ A DERIVATION RETURNS THE SENTENCE, NOT THE NUMBER. "4 sessions in 90 days" is a fact a
// person can read; a bare `4` under a heading called Engagement is the CLAUDE.md defect verbatim
// — "rendered a raw 1 where the question said 1 — Not at all".
//
// ★★★ AND ZERO IS NOT THE SAME AS UNKNOWN. A person with no completed sessions renders
// "No sessions in 90 days" — a VALUE. The descriptor's `empty` words are reserved for genuinely
// absent facts (no coach because there has never been a booking at all). P20.9a makes the same
// distinction for Run and calls confusing them "the most expensive version of this bug".

export const DERIVATIONS = Object.freeze({
  // ── person ────────────────────────────────────────────────────────────────
  sessions_90d: {
    key: 'engagement', owner: 'person',
    reads: ['booking_participant', 'booking'],
    why: 'booking.state=\'completed\' is the only terminal "it happened" fact the schema has. '
       + 'ADD3-1 notes there is no booking.completed TOPIC; the STATE exists and is what this reads.',
    sql: (u) => `(
      SELECT CASE count(*)
               WHEN 0 THEN 'No sessions in 90 days'
               WHEN 1 THEN '1 session in 90 days'
               ELSE count(*) || ' sessions in 90 days'
             END
        FROM keystone.booking_participant bp
        JOIN keystone.booking b ON b.id = bp.booking_id
       WHERE bp.app_user_id = ${u}.id
         AND b.state = 'completed'
         AND b.starts_at > now() - interval '90 days')`,
  },

  current_coach: {
    key: `coach`, owner: 'person',
    reads: ['booking_participant', 'booking', 'app_user'],
    why: 'There is no coach_id on app_user. The host of the person\'s most recent non-cancelled '
       + `booking is the only coach relationship the schema actually records. booking.host_id is `
       + 'NOT NULL and REFERENCES app_user, so the join cannot half-resolve.',
    sql: (u) => `(
      SELECT h.display_name
        FROM keystone.booking_participant bp
        JOIN keystone.booking b ON b.id = bp.booking_id
        JOIN keystone.app_user h ON h.id = b.host_id
       WHERE bp.app_user_id = ${u}.id
         AND b.state <> 'cancelled'
       ORDER BY b.starts_at DESC
       LIMIT 1)`,
  },

  credit_progress: {
    key: 'progress', owner: 'person',
    reads: ['entitlement', 'entitlement_credit'],
    why: 'Credits consumed against credits bought, across ACTIVE entitlements only. '
       + 'Returns NULL — and therefore the descriptor\'s "No package" — when the person holds no '
       + 'active entitlement at all, which is a different fact from holding one and using none.',
    sql: (u) => `(
      SELECT (SELECT count(*)
                FROM keystone.entitlement_credit ec
                JOIN keystone.entitlement e2 ON e2.id = ec.entitlement_id
               WHERE e2.owner_user_id = ${u}.id AND e2.status = 'active'
                 AND ec.status = 'consumed')
             || ' of ' ||
             (SELECT coalesce(sum(e3.total_credits), 0)
                FROM keystone.entitlement e3
               WHERE e3.owner_user_id = ${u}.id AND e3.status = 'active')
             || ' credits used'
       WHERE EXISTS (SELECT 1 FROM keystone.entitlement e4
                      WHERE e4.owner_user_id = ${u}.id AND e4.status = 'active'))`,
  },

  next_session: {
    key: 'next_session', owner: 'person',
    reads: ['booking_participant', 'booking', 'tenant'],
    why: 'Rendered in the TENANT\'S wall clock, never in UTC and never in the browser\'s zone. '
       + '§B4 STEP 3: local wall-clock + IANA zone. A session shown an hour out is a missed session.',
    sql: (u) => `(
      SELECT to_char(b.starts_at AT TIME ZONE t.timezone, 'Dy DD Mon, HH24:MI')
        FROM keystone.booking_participant bp
        JOIN keystone.booking b ON b.id = bp.booking_id
        JOIN keystone.tenant t ON t.id = b.tenant_id
       WHERE bp.app_user_id = ${u}.id
         AND b.state IN ('confirmed', 'pending_payment')
         AND b.starts_at > now()
       ORDER BY b.starts_at ASC
       LIMIT 1)`,
  },

  billing_status: {
    key: 'billing_status', owner: 'person',
    reads: ['invoice_effective', 'invoice', 'subscription_effective'],
    why: 'Ordered worst-first so the panel states the thing that needs acting on. NULL — i.e. '
       + '"Nothing due" — is reached only when there is no open invoice and no subscription at all.',
    sql: (u) => `(
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM keystone.invoice_effective ie
                      JOIN keystone.invoice i ON i.id = ie.id
                      WHERE ie.payer_user_id = ${u}.id AND ie.status = 'open'
                        AND i.period_end IS NOT NULL AND i.period_end < now())
             THEN 'Overdue'
        WHEN EXISTS (SELECT 1 FROM keystone.subscription_effective s
                      WHERE s.app_user_id = ${u}.id AND s.state = 'past_due')
             THEN 'Subscription past due'
        WHEN EXISTS (SELECT 1 FROM keystone.invoice_effective ie
                      WHERE ie.payer_user_id = ${u}.id AND ie.status = 'open')
             THEN 'Invoice open'
        WHEN EXISTS (SELECT 1 FROM keystone.subscription_effective s
                      WHERE s.app_user_id = ${u}.id AND s.state = 'active')
             THEN 'Subscription active'
        ELSE NULL END)`,
  },

  // ★★★ [TY, RULED 1 Oct 2026] SITE-READINESS BRIEF — two new highlights for a lead, both reading
  // columns 0549 added straight off the same `app_user` row (no join — unlike every derivation
  // above, which exists because the fact lives in another table). "Best time" formats the date the
  // same way the public site's own form does (`Dy Mon FMDD`, e.g. "Thu Oct 1", no zero-padding) so
  // staff see the same string a lead saw when they picked it. "Came from" duplicates the ordering
  // logic in `readAttribution`/publicLeads.mjs's own (unused-for-this) helper deliberately — that
  // one is JS run once at submit time for an email; this one is SQL run at read time for the record,
  // and the DERIVATIONS/descriptor cross-check (db/gates/p15_crm_screens.mjs) has no way to assert
  // two different languages stayed in sync, so keep both simple rather than trying to share code
  // across that boundary.
  lead_best_time: {
    key: 'lead_best_time', owner: 'person',
    reads: ['app_user'],
    why: '0549 — the site\'s "best time to call" (date + window + an optional half-hour slot) has '
       + 'no home on the pinned panel yet. NULL when a person was never a lead through the site form.',
    sql: (u) => `(
      CASE WHEN ${u}.lead_best_time_date IS NULL OR ${u}.lead_best_time_window IS NULL THEN NULL
           ELSE to_char(${u}.lead_best_time_date, 'Dy Mon FMDD') || ', ' || ${u}.lead_best_time_window
                || COALESCE(', around ' || ${u}.lead_best_time_time, '')
      END)`,
  },

  lead_came_from: {
    key: 'lead_came_from', owner: 'person',
    reads: ['app_user'],
    why: '0549 — ad/campaign attribution the site captured client-side. NULL for a direct visit, '
       + 'a non-website lead, or a lead who came in before this was wired.',
    sql: (u) => `(
      CASE
        WHEN ${u}.lead_attribution IS NULL THEN NULL
        WHEN ${u}.lead_attribution ->> 'gclid' IS NOT NULL THEN
          'Google Ads' || COALESCE(' — campaign ' || (${u}.lead_attribution ->> 'utm_campaign'), '')
        WHEN ${u}.lead_attribution ->> 'gbraid' IS NOT NULL OR ${u}.lead_attribution ->> 'wbraid' IS NOT NULL THEN
          'Google Ads (app)' || COALESCE(' — campaign ' || (${u}.lead_attribution ->> 'utm_campaign'), '')
        WHEN ${u}.lead_attribution ->> 'utm_source' IS NOT NULL THEN
          (${u}.lead_attribution ->> 'utm_source') || COALESCE(' — campaign ' || (${u}.lead_attribution ->> 'utm_campaign'), '')
        ELSE NULL
      END)`,
  },

  // ── account ───────────────────────────────────────────────────────────────
  seat_counts: {
    key: 'seats_used', owner: 'account',
    reads: ['account_seat_counts()'],
    why: '★★★ U11 — COUNTS, NEVER NAMES, and the guarantee is the RETURN TYPE, not this query. '
       + 'account_seat_counts() is SECURITY DEFINER returning five integers '
       + '(staff, adult_client, adolescent_client, parent, total). [MEAS 2026-09-13 from pg_proc.] '
       + 'There is no shape in which a person\'s name can travel back through it. That is the '
       + '0007/0008 argument and it is why this is a function call and not a join.',
    sql: (a) => `(
      SELECT sc.total_seats || ' seats — ' || sc.staff_seats || ' staff, '
             || sc.adult_client_seats || ' adult, ' || sc.adolescent_client_seats
             || ' adolescent, ' || sc.parent_seats || ' parent'
        FROM keystone.account_seat_counts(${a}.id) sc)`,
  },

  pipeline_states: {
    key: 'pipelines', owner: 'account',
    reads: ['account_pipeline'],
    why: '§A3: BUILD, PROVISION and RUN are three pipelines and must not collapse into one. '
       + 'They are listed separately, each with its own state, for exactly that reason.',
    sql: (a) => `(
      SELECT string_agg(p.kind || ': ' || p.state, ' · ' ORDER BY p.kind)
        FROM keystone.account_pipeline p
       WHERE p.account_id = ${a}.id)`,
  },

  // ── document ──────────────────────────────────────────────────────────────
  document_subject: {
    key: 'subject', owner: 'document',
    reads: ['app_user'],
    why: 'subject_user_id IS NULLABLE [MEAS], so this genuinely can be absent and the descriptor '
       + 'says "Nobody named" rather than rendering a blank.',
    sql: (d) => `(
      SELECT s.display_name FROM keystone.app_user s WHERE s.id = ${d}.subject_user_id)`,
  },

  days_since_sent: {
    key: 'age', owner: 'document',
    reads: [documentInstanceTableName()],
    why: 'The Pipeline screen exists to answer "what is out and how long has it been out". '
       + 'A draft has never been sent, so this is NULL and renders "Not sent" — which is a fact, '
       + 'not a gap.',
    sql: (d) => `(
      SELECT CASE
        WHEN ${d}.sent_at IS NULL THEN NULL
        WHEN ${d}.sent_at > now() - interval '1 day' THEN 'Sent today'
        WHEN ${d}.sent_at > now() - interval '2 days' THEN '1 day'
        ELSE floor(EXTRACT(epoch FROM now() - ${d}.sent_at) / 86400)::int || ' days'
      END)`,
  },

  // ── service / plan (shared, parameterised by subject_type) ─────────────────
  live_price: {
    key: 'price', owner: ['service', 'plan'],
    reads: ['current_price()'],
    why: '★★★ B2.1 / P15.5a / P8.7 — THE DEFINITION TABLES NO LONGER CARRY A PRICE COLUMN OF THEIR '
       + 'OWN. Migration 0015 moved price to the polymorphic `price` table under expand/contract '
       + 'and left the old per-definition columns behind, still written at creation and never '
       + 'updated — so reading one rendered whatever was true before the first re-price. '
       + 'Migration 0109 + scripts/retire-price-minor.mjs emptied them and the write path stopped '
       + 'naming them; they are nullable, NULL everywhere, and awaiting DROP COLUMN. '
       + '(The column name is deliberately not spelled here: db/gates/p8_7_the_definition_carries_no_price.mjs '
       + 'greps this file with comments stripped, and a `why` string is not a comment — F217.) '
       + '★★ AND NOT `plan_price` — F21, that table does not exist. '
       + '★★★ FINDING, 2026-09-13: keystone.current_price(subject_type, subject_id, at) ALREADY '
       + 'EXISTS and returns (amount_minor, currency, price_id). BUILD-UI.md B2.1 reads as though '
       + 'the query had to be written. It did not. A sibling, resolve_price(), additionally '
       + 'applies contracted_price per account — that is the per-CLIENT path, deliberately not '
       + 'used on a catalogue record page, which must show the LIST price.',
    sql: (t, subjectType) => `(
      SELECT to_char(cp.amount_minor / 100.0, 'FM999G999G990D00') || ' ' || cp.currency
        FROM keystone.current_price('${subjectType}', ${t}.id) cp)`,
  },

  sellable: {
    key: 'sellable', owner: ['service', 'plan'],
    reads: ['price', 'current_price()'],
    why: '★★★ §Z4 — a thing is sellable only when its definition is ACTIVE **and** an active price '
       + 'row covers now(). TWO conditions. ★★ And it NAMES WHICH ONE FAILED: "No — no live price" '
       + 'and "No — definition inactive" send an operator to different places, and a bare "No" '
       + 'sends them to neither.',
    sql: (t, subjectType) => `(
      SELECT CASE
        WHEN NOT ${t}.active THEN 'No — definition inactive'
        WHEN NOT EXISTS (SELECT 1 FROM keystone.current_price('${subjectType}', ${t}.id))
             THEN 'No — no live price'
        ELSE 'Yes' END)`,
  },

  // ── subscription ──────────────────────────────────────────────────────────
  subscription_plan: {
    key: 'plan_name', owner: 'subscription',
    reads: ['plan'],
    why: '★★★ P15.2c — the header used to be `plan_id`, a RAW UUID. [MEAS] subscription.plan_id is '
       + 'NOT NULL and REFERENCES plan(id) ON DELETE RESTRICT, so this join cannot half-resolve. '
       + '★ Resolving the plan NAME live is correct and is NOT F12\'s hard-limit-3 problem: the '
       + 'signed instrument is the CONTRACT (contract_id, NOT NULL by subscription_requires_'
       + 'contract) and the PRICE is already frozen on snapshot_amount_minor. Renaming a plan '
       + 'moves nothing that was signed.',
    sql: (s) => `(SELECT pl.name FROM keystone.plan pl WHERE pl.id = ${s}.plan_id)`,
  },

  // ── booking · P2.8 ─────────────────────────────────────────────────────────
  booking_client: {
    key: 'client', owner: 'booking',
    reads: ['booking_participant', 'app_user'],
    why: 'A session can have several participants; the pinned value names them. A GUEST has a '
       + 'display_name on the participant row and no account, so coalesce reads the row, not the join '
       + '\u2014 dropping guests would make a two-person session look like a one-person one.',
    sql: (b) => `(
      SELECT string_agg(coalesce(u.display_name, bp.display_name), ', ' ORDER BY bp.display_name)
        FROM keystone.booking_participant bp
        LEFT JOIN keystone.app_user u ON u.id = bp.app_user_id
       WHERE bp.booking_id = ${b}.id)`,
  },

  booking_host: {
    key: `coach`, owner: 'booking',
    reads: ['app_user'],
    why: 'booking.host_id is NOT NULL and REFERENCES app_user, so this cannot half-resolve.',
    sql: (b) => `(SELECT h.display_name FROM keystone.app_user h WHERE h.id = ${b}.host_id)`,
  },

  booking_when: {
    key: 'when', owner: 'booking',
    reads: ['tenant'],
    why: 'Rendered in the INVITEE\'s zone, falling back to the tenant\'s \u2014 \u00a7B4 STEP 3, local '
       + 'wall-clock plus an IANA zone, never a stored UTC instant. The zone is NAMED in the value '
       + 'because "10:00" without one is how somebody misses a session.',
    sql: (b) => `(
      SELECT to_char(${b}.starts_at AT TIME ZONE coalesce(${b}.invitee_timezone, t.timezone),
                     'Dy DD Mon, HH24:MI')
             || ' (' || coalesce(${b}.invitee_timezone, t.timezone) || ')'
        FROM keystone.tenant t WHERE t.id = ${b}.tenant_id)`,
  },

  booking_where: {
    key: 'where', owner: 'booking',
    reads: [],
    why: 'P2.5 stores location as KIND + DETAIL because the kind decides what the detail means. The '
       + 'pinned value says the kind in words, and adds the detail only when there is one \u2014 a video '
       + 'session whose link has not been generated yet is "Video call", not a blank.',
    sql: (b) => `(
      CASE ${b}.location_kind
        WHEN 'in_person' THEN 'In person'
        WHEN 'video'     THEN 'Video call'
        WHEN 'phone'     THEN 'Telephone'
        WHEN 'other'     THEN 'Elsewhere'
        ELSE NULL
      END || coalesce(' \u2014 ' || ${b}.location_detail, ''))`,
  },

  // ── invoice · P2.8 ─────────────────────────────────────────────────────────
  invoice_payer: {
    key: 'payer', owner: 'invoice',
    reads: ['app_user'],
    why: 'invoice.payer_user_id is NOT NULL and REFERENCES app_user.',
    sql: (i) => `(SELECT p.display_name FROM keystone.app_user p WHERE p.id = ${i}.payer_user_id)`,
  },

  invoice_paid: {
    key: 'paid', owner: 'invoice',
    reads: ['invoice_effective'],
    why: 'Stripe\'s own amount_paid via keystone.invoice_effective (mirror), not Workbench\'s payment rows. \u2605\u2605 RETURNS THE SENTENCE, NOT THE NUMBER: "Paid in full", '
       + '"$40.00 of $120.00", "Nothing paid yet". A bare figure under a heading called Paid cannot '
       + 'be read without doing arithmetic against another panel.',
    sql: (i) => `coalesce((
      SELECT CASE
        WHEN coalesce(iep.paid_minor, 0) = 0 THEN 'Nothing paid yet'
        WHEN coalesce(iep.paid_minor, 0) >= iep.amount_minor THEN 'Paid in full'
        ELSE to_char(coalesce(iep.paid_minor, 0) / 100.0, 'FM999999990.00')
             || ' of ' || to_char(iep.amount_minor / 100.0, 'FM999999990.00')
      END
        FROM keystone.invoice_effective iep
       WHERE iep.id = ${i}.id), 'Nothing paid yet')`,
  },

  subscription_client: {
    key: 'client_name', owner: 'subscription',
    reads: ['app_user'],
    why: 'subscription.app_user_id is NOT NULL and REFERENCES app_user(id).',
    sql: (s) => `(SELECT au.display_name FROM keystone.app_user au WHERE au.id = ${s}.app_user_id)`,
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// THE RECORD QUERIES — one per descriptor in RECORD_TYPES
// ═════════════════════════════════════════════════════════════════════════════
const D = DERIVATIONS;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P1.7 — A RECORD PAGE IS SCOPED BY THE SAME PREDICATE AS ITS LIST. `$1` is the record id and
//     `$2` IS THE VIEWER, on every query here.
//   ★★ AND A SCOPE REFUSAL MUST READ AS **404, NEVER 403** — which it does for free, because the
//      predicate returns zero rows and `src/routes/index.mjs` already answers `notFound` on an empty
//      result. That is not an accident of this change: answering 403 would CONFIRM THE ROW EXISTS,
//      which is the leak P13.7b asserts against for the cross-tenant case. A coach probing ids must
//      not be able to tell "not yours" from "not there".
//   ★ The un-ownable types (`network_party`, `service`, …) take `$2::uuid IS NOT NULL` instead, so every
//     query in this file binds the same two parameters and the route cannot get the arity wrong.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 7 7.18 — `verb` defaults to `'view'` for every existing caller (the record page and
//     every related list), and `RECORD_QUERIES.booking.sqlFor('edit')` is the ONLY other caller,
//     so cancel/reschedule ask the SAME predicate the read page does, just with the verb 'edit'
//     substituted — never a second, hand-copied predicate.
const scopedRecord = (object, alias, verb = 'view') => {
  const owner = ownerExpr(object, alias);
  // ★★★ THE GRANT IS `permissionObjectFor(object)`, **NOT** `object`. [MEASURED 2026-09-15] four of
  //     this file's predicates asked `user_may($2, 'subscription', …)` — a word that is not one of
  //     the eleven, so no role can hold it and the answer was false for everybody, forever. The
  //     resolver THROWS on an unresolvable object, so the next one fails at import instead of
  //     rendering as an empty list. See `src/permissions/ownership.mjs`.
  const grant = owner ? permissionObjectFor(object) : null;
  return owner
    ? `keystone.user_may($2, '${grant}', '${verb}', ${owner})`
    : `$2::uuid IS NOT NULL`;
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A RELATED LIST IS A **LIST**, AND ARCHIVED RECORDS DO NOT BELONG IN ONE.
//
//   `scoped()` (src/records/lists.mjs) appends the archive filter for every archivable table.
//   `scopedRecord()` deliberately does NOT — a record PAGE must still open for an archived record,
//   or archiving becomes the one-way door P2.9 exists to prevent.
//   ★★ THE RELATED LISTS SAT BETWEEN THOSE TWO AND GOT THE RECORD-PAGE RULE BY DEFAULT. [MEASURED,
//      P2 CLOSE §VISUAL] three of the seven leaked: an archived person appeared in a party's
//      referrals, and an archived subscription appeared on both the plan and the person. `person.
//      documents` was correct — by a hand-written predicate that only it had, which is exactly why
//      the others were missed.
//   ★ So the choice is named in a helper rather than remembered per entry. A related list of an
//     archivable object uses this; one whose table has no `archived_at` uses `scopedRecord` and the
//     `has no archived_at` fact is checked below rather than assumed.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const ARCHIVABLE_TABLES = new Set(Object.values(ARCHIVABLE).map((e) => e.table));

const scopedRelated = (object, alias) => {
  const table = OWNERSHIP[object]?.table;
  if (!ARCHIVABLE_TABLES.has(table)) {
    throw new Error(
      `scopedRelated("${object}") — that object's table (${table ?? "unknown"}) has no archived_at, ` +
      `so this helper would add a predicate on a column that does not exist. Use scopedRecord().`);
  }
  return `${alias}.archived_at IS NULL AND ${scopedRecord(object, alias)}`;
};

export const RECORD_QUERIES = Object.freeze({
  person: {
    table: 'keystone.app_user',
    sql: `
      SELECT u.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             u.id, u.display_name, u.email, u.role, u.staff_role,
             -- *** the maintainer, 29 Sep 2026 -- THREE FACTS THE PORTAL-INVITE CONTROL NEEDS, NONE OF WHICH
             --     THIS QUERY SELECTED. firebase_uid was ALREADY in shell.mjs's CONTROL_KEYS
             --     whitelist and PersonActions.jsx's own !person.firebase_uid gate -- reaching
             --     undefined (never selected, so 'k in row' was false) made that gate ALWAYS
             --     true, regardless of whether the person had ever signed in. email_bounced_at /
             --     has_ever_signed_in / invited_at are the same three raw facts
             --     src/records/lists/people.mjs's PORTAL constant selects for the list screens
             --     (never the derived portal_status itself -- see that constant's own header on
             --     why the DECISION is made once, in the route layer, not per-query).
             --   ** has_parent_linked: for an ADOLESCENT, the portal-invite control redirects to
             --     the linked parent (spec: "teens go to their linked parent"); the record page
             --     needs to know whether one exists before offering the button at all.
             u.firebase_uid, u.email_bounced_at,
             keystone.person_ever_signed_in(u.id) AS has_ever_signed_in,
             (SELECT max(i.created_at) FROM keystone.invite i
               WHERE i.tenant_id = u.tenant_id AND i.email = u.email) AS invited_at,
             EXISTS (SELECT 1 FROM keystone.guardian g
                      WHERE g.tenant_id = u.tenant_id AND g.child_user_id = u.id) AS has_parent_linked,
             -- ★★ P2.1 — the canonical base set. buildRecordShell THROWS on a panel field the
             --    query did not select, so this list and shell.mjs's panels are kept honest by the
             --    code rather than by anybody remembering.
             --  ★ NO BACKTICKS IN HERE: this SQL lives in a JS template literal and a backtick ends
             --    the string. [EXECUTED] that is exactly how this line first failed to parse — the
             --    same footgun src/events/outbox.mjs already warns about in its own comment.
             u.first_name, u.last_name, u.preferred_name, u.pronouns, u.date_of_birth,
             u.lifecycle_status, u.secondary_email, u.mobile_phone, u.home_phone,
             u.preferred_contact_method, u.do_not_email, u.do_not_text, u.do_not_call,
             u.address_line1, u.address_line2, u.city, u.state_region, u.postcode, u.country,
             u.timezone, u.source, u.joined_at, u.tags, u.notes,
             u.emergency_contact_name, u.emergency_contact_relationship, u.emergency_contact_phone,
             u.sobriety_date, u.recovery_programme, u.sponsor_name, u.support_network,
             -- ★★★ THE TWO REFERRAL COLUMNS, ADDED 25 Sep 2026. THE FORM WROTE THEM AND THE
             --     RECORD READ COULD NOT SEE THEM. createPerson and updatePerson have written
             --     referred_by_id (a PERSON, 0076) and referred_by_party_id (an ORGANISATION,
             --     0081) as two distinct columns since this task's form landed, and this query
             --     selected NEITHER — so "who sent this person to us" was captured, stored, and
             --     then invisible on the record page for ever. Found by the task that built the
             --     form, from the writing end.
             --   ★★ They are two columns and not one on purpose: app_user_one_referrer allows at
             --      most one to be non-null, because "a person referred them" and "a practice
             --      referred them" are different facts and collapsing them loses which it was.
             --   ★ Adding a field here is safe; buildRecordShell throws only on a panel field the
             --     query FAILED to select, never on one it did not ask for.
             --   ★★ AND THE COMMENT TWENTY LINES ABOVE WAS RIGHT: the first draft of this note
             --      used backticks and broke the parse, exactly as it warns. Left as evidence.
             u.referred_by_id, u.referred_by_party_id,
             u.display_name                  AS name,
             ${D.sessions_90d.sql('u')}      AS engagement,
             ${D.current_coach.sql('u')}     AS coach,
             ${D.credit_progress.sql('u')}   AS progress,
             ${D.next_session.sql('u')}      AS next_session,
             ${D.billing_status.sql('u')}    AS billing_status,
             ${D.lead_best_time.sql('u')}    AS lead_best_time,
             ${D.lead_came_from.sql('u')}    AS lead_came_from
        FROM keystone.app_user u
       WHERE u.id = $1
         AND ${scopedRecord('person', 'u')}`,
  },

  account: {
    table: 'keystone.account',
    sql: `
      SELECT a.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             a.id, a.name, a.status,
             -- ★★ P2.3 — the canonical account. Kept in step with shell.mjs's panels by the throw,
             --    not by anybody remembering.
             a.account_number, a.account_type, a.industry, a.employee_count, a.source, a.description,
             a.phone, a.email, a.website,
             a.billing_line1, a.billing_line2, a.billing_city, a.billing_state_region,
             a.billing_postcode, a.billing_country,
             -- ★★★ THE IN-TENANT CONTACT'S NAME. The join is app_user WITHIN this tenant; RLS scopes
             --     it, and the composite FK on (tenant_id, primary_contact_id) makes a cross-tenant
             --     contact unrepresentable. ★ NOT a walk through customer_tenant_id — that is the
             --     PLATFORM relation and names never cross it (A3, and 0007/0008 enforce it).
             -- \u2605\u2605\u2605 THE CONTACT'S NAME IS SCOPED TO THE VIEWER, NOT INHERITED FROM THE ACCOUNT.
             --     [EXECUTED, db/gates/p1_scope_wired.mjs \u00a74] the scan's rule is "CAN IT SURFACE A
             --     PERSON?", and a subselect resolving a display_name from app_user can. With no
             --     predicate a coach who may open the account reads the name of a person their scope
             --     does not reach \u2014 **F150's shape exactly**, arriving through the door marked
             --     "contact" rather than through a list. An unreachable contact renders as absent,
             --     which is the same answer the page gives when nobody is named.
             (SELECT pc.display_name FROM keystone.app_user pc
               WHERE pc.id = a.primary_contact_id
                 AND ${scopedRecord('person', 'pc')})       AS primary_contact,
             ${D.seat_counts.sql('a')}      AS seats_used,
             ${D.pipeline_states.sql('a')}  AS pipelines
        FROM keystone.account a
       WHERE a.id = $1
         AND ${scopedRecord('account', 'a')}`,
  },

  network_party: {
    table: 'keystone.network_party',
    sql: `
      SELECT n.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             n.id, n.name, n.kind, n.created_at AS since,
             -- ★★ P2.4 — kept in step with shell.mjs's panels by the throw, not by memory.
             n.active, n.notes, n.email, n.phone, n.website,
             n.address_line1, n.address_line2, n.city, n.state_region, n.postcode, n.country,
             n.agreement_on_file,
             -- ★★ THE CONTACT'S NAME, JOINED FROM app_user — 0082. It was a plain text column for
             --    the length of one migration; the pinned P15B rule is that a human's details never
             --    live outside the person record, because that is where consent lives. RLS scopes
             --    this join, and the composite FK makes a cross-tenant contact unrepresentable.
             --  ★ NO BACKTICKS: this SQL is inside a JS template literal, and the note two panels
             --    up says so. [EXECUTED] naming the old column in backticks here ended the string
             --    and the whole module failed to parse — the third time this footgun has fired.
             --  \u2605\u2605 SCOPED, for the reason spelled out on the account query above: the join puts a
             --     HUMAN BEING on the screen, so it owes a viewer predicate of its own. P2.4 added
             --     this join and p1_scope_wired went red the same run \u2014 the gate written against
             --     F150 catching F150 being reintroduced one item later.
             (SELECT pc.display_name FROM keystone.app_user pc
               WHERE pc.id = n.primary_contact_id
                 AND ${scopedRecord('person', 'pc')})       AS primary_contact
        FROM keystone.network_party n
       WHERE n.id = $1
         AND $2::uuid IS NOT NULL`,
  },

  document: {
    table: documentInstanceTable(),
    // ★ ISLAND-PROGRAMS §2 — the SQL text lives behind documents/api.mjs; this file passes its OWN
    //   scope helper and DERIVATIONS fragments in (one copy of each, no circular import). The door's
    //   own comment carries the three load-bearing notes that used to stand here: archived_at is
    //   selected so Restore is reachable (P7), NO archive predicate on purpose (the record page must
    //   still open for an archived document), and created_by + is_session_note feed the route's
    //   private-read decision (7.15, F597).
    sql: documentRecordSql({
      subjectExpr: D.document_subject.sql('d'),
      ageExpr: D.days_since_sent.sql('d'),
      scopeClause: scopedRecord('document', 'd'),
    }),
  },

  service: {
    table: 'keystone.service',
    sql: `
      SELECT s.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             s.id, s.name, s.duration_minutes, s.bookable, s.active,
             -- ★ The HIGHLIGHT key is duration; the PANEL field is duration_minutes. Both are
             --   selected explicitly. The first draft aliased neither and buildRecordShell threw
             --   naming the missing key — which is the contract doing its job at build time
             --   rather than a blank cell doing nothing at run time.
             s.duration_minutes AS duration,
             (SELECT cp.amount_minor FROM keystone.current_price('service', s.id) cp)
                                                    AS price_amount_minor,
             (SELECT cp.currency     FROM keystone.current_price('service', s.id) cp)
                                                    AS price_currency,
             ${D.live_price.sql('s', 'service')}    AS price,
             ${D.sellable.sql('s', 'service')}      AS sellable
        FROM keystone.service s
       WHERE s.id = $1
         AND $2::uuid IS NOT NULL`,
  },

  plan: {
    table: 'keystone.plan',
    sql: `
      SELECT p.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             p.id, p.name, p.interval, p.active,
             (SELECT cp.amount_minor FROM keystone.current_price('plan', p.id) cp)
                                                    AS price_amount_minor,
             (SELECT cp.currency     FROM keystone.current_price('plan', p.id) cp)
                                                    AS price_currency,
             ${D.live_price.sql('p', 'plan')}       AS price,
             ${D.sellable.sql('p', 'plan')}         AS sellable
        FROM keystone.plan p
       WHERE p.id = $1
         AND $2::uuid IS NOT NULL`,
  },

  // ★★★ P2.8 — booking and invoice had NO record query and NO descriptor. Every field P2.5 and P2.6
  //     added was invisible, and `line_item` was visible nowhere in the product at all.
  // ★★★ STAGE 7 7.18 — `sqlFor(verb)` is the ONE source this descriptor builds its SQL from.
  //     `sql` (below) is simply `sqlFor('view')`, exactly what `GET /api/records/booking/:id` used
  //     before this task. `src/booking/reschedule.mjs`'s `lockVisibleBooking` now calls
  //     `sqlFor('edit')` for both cancel and reschedule — the same `scopedRecord('engagement', 'b',
  //     verb)` predicate as the read, never a second hand-copied one.
  booking: (() => {
    const sqlFor = (verb) => `
      SELECT b.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             b.id, b.state, b.title, b.description,
             b.location_kind, b.location_detail,
             b.reminder_minutes_before, b.recurrence_cadence, b.cancellation_reason,
             ${D.booking_client.sql('b')} AS client,
             ${D.booking_host.sql('b')}   AS coach,
             ${D.booking_when.sql('b')}   AS when,
             ${D.booking_where.sql('b')}  AS where
        FROM keystone.booking b
       WHERE b.id = $1
         -- ★★★ THE OBJECT IS 'engagement', NOT 'booking'. The TABLE is booking; the PERMISSION
         --     OBJECT it belongs to is engagement (ownership.mjs: booking.host_id has been the
         --     owner all along). [EXECUTED] the first draft passed 'booking', ownerExpr returned
         --     null for an object it did not know, and this query shipped **with no scope predicate
         --     at all** — caught by p1_scope_wired §4. ownerExpr now THROWS on an unknown object
         --     rather than falling back, so the same mistake cannot be silent twice.
         AND ${scopedRecord('engagement', 'b', verb)}`;
    return {
      table: 'keystone.booking',
      sql: sqlFor('view'),
      sqlFor,
    };
  })(),

  invoice: {
    table: 'keystone.invoice',
    sql: `
      SELECT i.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             i.id, ie.status, i.currency, ie.amount_minor, i.invoice_number, i.due_at, i.memo,
             i.subtotal_minor, i.tax_minor, i.discount_minor, i.void_reason,
             -- ★ The HIGHLIGHT keys are total and due; the PANEL fields are amount_minor and
             --   due_at. Both are selected, because buildRecordShell requires the row to carry the
             --   highlight's KEY and the panel's FIELD, and an absent key is a loud throw rather
             --   than a blank cell. Same split the service query already uses for duration.
             --  ★ NO BACKTICKS. Fourth and fifth time in this file; the warning comment itself did
             --    it twice.
             ie.amount_minor AS total,
             i.due_at       AS due,
             i.billing_line1, i.billing_line2, i.billing_city, i.billing_state_region,
             i.billing_postcode, i.billing_country,
             ${D.invoice_payer.sql('i')} AS payer,
             ${D.invoice_paid.sql('i')}  AS paid
        FROM keystone.invoice i
        -- ★ STRIPE-MIRROR §4 stage (e): status and amount are Stripe's (keystone.invoice_effective);
        --   every other column here is Workbench's own. The view always has a row for a base invoice.
        JOIN keystone.invoice_effective ie ON ie.id = i.id
       WHERE i.id = $1
         AND ${scopedRecord('invoice', 'i')}`,
  },

  subscription: {
    table: 'keystone.subscription',
    sql: `
      SELECT sub.archived_at,
             -- ★★★ P7 — SELECTED SO THE RECORD PAGE CAN OFFER **RESTORE**. All nine
             --     archivable record queries omitted this, so the record-shell builder read
             --     undefined, the shell's archived flag was permanently false, and the archive
             --     control would have offered Archive on an already-archived record
             --     while Restore was dead code with a button on it. MEASURED by
             --     db/gates/p7_archive_restore_reachable.mjs, which archives a row and
             --     reads it back through THIS query.
             --   ★ The archived row is still SERVED by the record read (lists filter it,
             --     this does not) — that is the only reason Restore is reachable at all.
             sub.id, sub.state, sub.started_on, sub.snapshot_amount_minor,
             sub.current_period_end AS renews,
             ${D.subscription_plan.sql('sub')}   AS plan_name,
             ${D.subscription_client.sql('sub')} AS client_name,
             -- ★ [MEAS] the subscription table HAS NO currency column — only
             --   snapshot_amount_minor. A money field whose currency is missing renders as a
             --   bare number, and 1200 is not a price. It comes from the plan instead.
             COALESCE((SELECT pl.currency FROM keystone.plan pl WHERE pl.id = sub.plan_id), sub.currency) AS currency
        -- ★ STRIPE-MIRROR §4 stage (e): the record is read FROM keystone.subscription_effective — state,
        --   price and renewal are Stripe's, and a Stripe-only subscription (no Workbench row, listed on
        --   /money/subscriptions) has a record page too instead of a 404.
        FROM keystone.subscription_effective sub
       WHERE sub.id = $1
         AND ${scopedRecord('subscription', 'sub')}`,
  },
});

/**
 * ★ The activity feed, for every record type. F13: the table is `event`, not `audit_event`.
 *   `event_subject (tenant_id, subject_type, subject_id)` already indexes exactly this predicate
 *   [MEAS 2026-09-13 from pg_indexes], so no migration was needed and 0022 says so explicitly.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ FIX ROUND 1, C1 — A PERSON'S HISTORY ALSO INCLUDES EVENTS ABOUT THEM, NOT ONLY EVENTS ON
 *     THEM. Spec §12's History test: "create a person, send them a document → BOTH appear on the
 *     person's History." [MEASURED, review C1] `sendInstance` emits `subject_type:'document',
 *     subject_id:<instanceId>` — never the person's id — so the exact-match query above alone can
 *     never surface it on a PERSON's record page, only on the document's own.
 *   ★★ THE RELATION, NOT A SECOND COPY OF THE PERSON'S ID ON THE EVENT. A document already carries
 *      who it is about (`document_instance.subject_user_id`, 0009); a booking already carries who
 *      is in it (`booking_participant.app_user_id`, 0013). Joining through those is the same fact
 *      the record page's own visibility rules use elsewhere — not a new one invented here.
 *   ★★★ MONEY IS NOW VIEWER-GATED, NOT EXCLUDED — STAGE 7 TASK 7.17, FIELD 4.2. Controller ruling
 *       R45 held only while viewer-permission filtering did not exist ("viewer-permission filtering
 *       is Stage 7, not this task"). ACTIVITY_SQL gains a THIRD and FOURTH union branch (invoice and
 *       payment events naming a person through their own `payer_user_id`), each wrapped in
 *       `keystone.user_may($3, 'invoice', 'view', <payer>)` — so the History money rows appear for
 *       the Owner, the Admin and the payer, and not for a coach without the switch. `$3` is the
 *       VIEWER; every caller must now pass it. This closes the Stage-3 carried item "invoices join a
 *       person's History with the viewer money filter" and CCR-7.
 *   ★ ONLY WHEN $1='person'. Every other record type's History (document's own, account's own, …)
 *     is completely unchanged — the two extra branches contribute zero rows unless the caller is
 *     asking for a PERSON, so `ACTIVITY_SQL(ACTIVITY_SUBJECT['document'], instanceId)` still reads
 *     exactly as it did before this fix.
 *   ★ NO NEW TENANT SCOPING NEEDED. `keystone.event`, `keystone.document_instance` and
 *     `keystone.booking_participant` are each `FORCE ROW LEVEL SECURITY` under the ordinary
 *     `tenant_isolation` policy — the join cannot cross a tenant boundary that neither joined table
 *     would individually admit, and this query runs under the same tenant-scoped connection every
 *     other record-page read already uses. No privileged role, no new grant.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
// ★★★ STAGE 3 TASK 3 FIX 1, R46 — `reason` is the typed reason a staff member gave (archive · decline ·
//     stage change), kept in `keystone.record_reason` because §2.4 forbids it in the payload. This SQL is
//     read ONLY by the STAFF record route (`routes/index.mjs`), never by `/api/app/*` — a client's own
//     activity read (`routes/app.mjs`) selects named event columns and does not join this table.
export const ACTIVITY_SQL = `
  SELECT activity.*, rr.reason FROM (
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
     WHERE e.subject_type = $1 AND e.subject_id = $2

    UNION

    -- ★ A document ABOUT this person (documents.document.* events), when $1 is 'person'.
    ${documentEventsAboutPersonFragment()}

    UNION

    -- ★ A booking this person PARTICIPATES IN (booking.booking.* events), when $1 is 'person'.
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
      JOIN keystone.booking_participant bp ON bp.booking_id = e.subject_id
     WHERE $1 = 'person' AND e.subject_type = 'booking' AND bp.app_user_id = $2

    UNION

    -- ★★★ 12.7 — a referral OF this person (people.referral.* events), when $1 is 'person'.
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
      JOIN keystone.network_referral r ON r.id = e.subject_id
     WHERE $1 = 'person' AND e.subject_type = 'referral' AND r.referred_person_id = $2

    UNION

    -- ★★★ 12.7 — a referral naming this network party as the RECEIVING party (people.referral.*
    --     events), when $1 is 'network_party'.
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
      JOIN keystone.network_referral r ON r.id = e.subject_id
     WHERE $1 = 'network_party' AND e.subject_type = 'referral' AND r.receiving_network_party_id = $2

    UNION

    -- ★★★ 12.7 / F03 §5 — a payer-group membership naming this person, so it shows on the
    --     person's History as well as the account's.
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
     WHERE $1 = 'person' AND e.subject_type = 'payer_group_member'
       AND (e.payload->>'person_id')::uuid = $2

    UNION

    -- ★★★ STAGE 7 / 7.17 FIELD 4.2 — an invoice naming this person as PAYER (money.invoice.*
    --     events), when $1 is 'person', gated on the VIEWER's ($3) money grant so this branch
    --     contributes zero rows to a coach without the switch, exactly as R45 required before this
    --     grant existed to check.
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
      JOIN keystone.invoice i ON i.id = e.subject_id
     WHERE $1 = 'person' AND e.subject_type = 'invoice' AND i.payer_user_id = $2
       AND keystone.user_may($3, 'invoice', 'view', i.payer_user_id)

    UNION

    -- ★★★ STAGE 7 / 7.17 FIELD 4.2 — a payment naming this person as PAYER (money.payment.*
    --     events), when $1 is 'person', gated on the same viewer money grant. keystone.payment has
    --     its own payer_user_id (0015) — no join through invoice is needed to find it.
    SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
      JOIN keystone.payment p ON p.id = e.subject_id
     WHERE $1 = 'person' AND e.subject_type = 'payment' AND p.payer_user_id = $2
       AND keystone.user_may($3, 'invoice', 'view', p.payer_user_id)
  ) activity
  LEFT JOIN keystone.record_reason rr ON rr.event_id = activity.id
   ORDER BY activity.created_at DESC
   LIMIT 50`;

/** ★ The subject_type each record type writes into `event`. Single-sourced so the feed and the
 *    emitter cannot disagree — which is P4.10's measured failure in miniature. */
export const ACTIVITY_SUBJECT = Object.freeze({
  person: 'person', account: 'account', network_party: 'network_party',
  document: 'document', service: 'service', plan: 'plan', subscription: 'subscription',
  // ★ P2.8. `booking.booking.created` and `money.invoice.opened` already write these subject types,
  //   so both feeds have real rows from the moment the pages exist.
  booking: 'booking', invoice: 'invoice',
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE RELATED-LIST READS — P2.4. ★★★ THERE WERE NONE.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// ★★★ EVERY `kind:'list'` RELATED ENTRY RENDERED A SENTENCE INSTEAD OF ROWS.
//     [MEASURED, web/src/record/RecordPage.jsx:209 before this change] the renderer's only branch
//     for a list was a placeholder reading *"<label> are listed here once <of> rows exist for this
//     record"* — and it said that **whether or not rows existed.** Five entries across four
//     descriptors: person's documents and subscriptions, an account's pipelines, a plan's
//     subscriptions, and the referrals P2.4 had just made representable.
//
// ★★ P2.4 IS WHAT MADE IT UNTENABLE RATHER THAN MERELY UNFINISHED. The placeholder is honest on a
//    record with nothing linked. The moment a school HAS sent you three people, a page that says
//    "once person rows exist" is **stating something false about data it is holding** — which is
//    worse than the empty box the wording was chosen to avoid. So the reads land here, for all
//    five, rather than one special case for the entry that exposed it.
//
// ★★★ AND EVERY ONE IS SCOPED BY THE VIEWER, NOT ONLY BY THE PARENT RECORD. A related list is a
//     SECOND read of a second table; inheriting the parent`s visibility would let a coach open a`
//     network party they may see and read out every client in the practice it referred. `$2` is the
//     viewer on all five, exactly as on the record queries above. **This is F150's shape** — three
//     money lists shipped client names with no viewer bound — and it is the reason this file binds
//     the viewer everywhere rather than "where it seemed to matter".
//
// ★ ROW SHAPE IS UNIFORM — `{ id, label, sub }` — because the renderer is ONE component for all
//   five. A per-entry shape would put the mapping in the JSX, where a missing key renders blank
//   instead of throwing.
export const RELATED_QUERIES = Object.freeze({
  'person.documents': personDocumentsRelatedSql({ scopeClause: scopedRelated('document', 'd') }),

  'person.subscriptions': `
    SELECT sub.id, coalesce(pl.name, 'Subscription') AS label, sub.state AS sub
      FROM keystone.subscription_effective sub
      LEFT JOIN keystone.plan pl ON pl.id = sub.plan_id
     WHERE sub.app_user_id = $1
       AND ${scopedRelated('subscription', 'sub')}
     ORDER BY sub.created_at DESC
     LIMIT 50`,

  'account.pipelines': `
    SELECT p.id, p.kind AS label, p.stage AS sub
      FROM keystone.account_pipeline p
     WHERE p.account_id = $1
       AND $2::uuid IS NOT NULL
     ORDER BY p.created_at DESC
     LIMIT 50`,

  'plan.subscriptions': `
    SELECT sub.id, au.display_name AS label, sub.state AS sub
      FROM keystone.subscription_effective sub
      JOIN keystone.app_user au ON au.id = sub.app_user_id
     WHERE sub.plan_id = $1
       AND ${scopedRelated('subscription', 'sub')}
     ORDER BY sub.created_at DESC
     LIMIT 50`,

  // ★★★ P2.8 — WHAT AN INVOICE CHARGES FOR, AND WHAT A SESSION COST. `line_item` has had a writer,
  //     events and (since P2.7) real foreign keys, and **was readable nowhere in the product.**
  //   ★★ No viewer predicate of its own, and that is deliberate rather than an omission: a line item
  //      carries no person. Its visibility is entirely its parent's, and the parent's record query
  //      has already refused the caller before this query runs. Adding `$2` here would imply a
  //      second, independent scope decision that does not exist.
  //   ★ `name_snapshot` is the label, NOT a join to the catalogue — the line must read the way it
  //     read when it was issued, even after the service is renamed or retired.
  'invoice.lines': `
    SELECT li.id, li.name_snapshot AS label,
           (li.quantity || ' \u00d7 ' ||
            to_char(li.unit_amount_minor / 100.0, 'FM999999990.00')) AS sub
      FROM keystone.line_item li
     WHERE li.invoice_id = $1 AND $2::uuid IS NOT NULL
     ORDER BY li.created_at`,

  'booking.lines': `
    SELECT li.id, li.name_snapshot AS label,
           (li.quantity || ' \u00d7 ' ||
            to_char(li.unit_amount_minor / 100.0, 'FM999999990.00')) AS sub
      FROM keystone.line_item li
     WHERE li.booking_id = $1 AND $2::uuid IS NOT NULL
     ORDER BY li.created_at`,

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ F443 — WHO WAS AT THIS SESSION. **THIS KEY DID NOT EXIST, AND ITS ABSENCE MADE THE
  //     ATTENDANCE CONTROL MARK NOBODY.**
  //
  //   `Screen.svelte` passes `participants={state.data?.relatedRows?.participants ?? []}` into
  //   `AttendanceControl`; `relatedRows` is built ONLY from the descriptor's declared `related`
  //   entries, and the booking descriptor declared only `lines`. So `participants` was **always
  //   `[]`**, the control posted an empty list, the session closed, `booking.booking.completed`
  //   fired — and no participant row was ever marked. The Sessions list's `attended` column
  //   (`bool_or(bp.attended)`) could not become true through the UI at all.
  // ★★ AND THE EMPTY LIST IS A LEGITIMATE STATE, which is what made this invisible. The control's
  //    own comment is right that *"a booking with no participants recorded is still a session that
  //    happened."* The defect was that it was the ONLY REACHABLE state — a correct branch with no
  //    alternative is indistinguishable from a working feature.
  // ★ `sub` carries the answer so far — attended / did not attend / not recorded — because the
  //   related rail renders `label` and `sub`, and "not recorded" is the fact this whole finding is
  //   about. NULL is rendered as words, never as a blank.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  'booking.participants': `
    SELECT bp.id, bp.display_name AS label,
           CASE WHEN bp.attended IS NULL THEN 'Not recorded'
                WHEN bp.attended THEN 'Attended'
                ELSE 'Did not attend' END AS sub
      FROM keystone.booking_participant bp
     WHERE bp.booking_id = $1 AND $2::uuid IS NOT NULL
     ORDER BY bp.display_name`,

  // ★★★ P2.4, F122 — THE QUESTION THE NETWORK SECTION COULD NOT ANSWER: "who did this school send
  //     us?" The column it reads (`app_user.referred_by_party_id`) did not exist until 0081, and
  //     `network_party` had ZERO inbound foreign keys before it.
  //   ★ Scoped as a PERSON read, not as a network read — because that is what these rows are. A
  //     coach restricted to their own clients sees the referrals that are theirs and no others.
  'network_party.referrals': `
    SELECT u.id, u.display_name AS label, u.lifecycle_status AS sub
      FROM keystone.app_user u
     WHERE u.referred_by_party_id = $1
       AND ${scopedRelated('person', 'u')}
     ORDER BY u.created_at DESC
     LIMIT 50`,

  // ★★★ P6.23 — OUTBOUND REFERRALS. "Who did we refer out to this party?"
  //     Unlike `network_party.referrals` (people referred TO us BY this party),
  //     this query fetches `network_referral` records where this party is the RECIPIENT.
  //     ★ Scoped as a PERSON read, same as inbound referrals: a coach sees only
  //     referrals of their own clients.
  'network_party.referred_out': `
    SELECT nr.id, u.display_name AS label, nr.outcome AS sub
      FROM keystone.network_referral nr
      JOIN keystone.app_user u ON nr.referred_person_id = u.id
     WHERE nr.receiving_network_party_id = $1
       AND ${scopedRelated('person', 'u')}
     ORDER BY nr.created_at DESC
     LIMIT 50`,
});
