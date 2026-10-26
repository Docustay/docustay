// P5.9 / P15.2 / P15.2a / P15.2b / P15.2c — THE RECORD PAGE: ONE SHELL, EVERY OBJECT.
//
// ★★ WHY ONE SHELL AND NOT NINE PAGES. [MEASURED, P4.10] the legacy product carried the same
// seven labels in two tables and they had silently DIVERGED. Nine bespoke record pages diverge the
// same way and for the same reason — each is edited on a different day by someone solving a
// different problem. A shell makes "every object behaves the same" a fact about the code rather
// than a thing everyone intends.
//
// ★ A new object type gets a record page by adding a DESCRIPTOR here. There is no second place to
// look, and no object may define its own shell.
//
// ══ WHAT THE SHELL IS ══════════════════════════════════════════════════════
//   header     — the object's name and its status
//   highlights — U3. The PINNED panel. Stays visible while the tabs beneath it change
//   panels     — the object's own fields, grouped
//   related    — lists of other objects hanging off this one
//   activity   — the audit trail, in one place, always last
// ★ The ORDER is part of the shell. A record whose activity is somewhere else is a different page.
//
// ═══════════════════════════════════════════════════════════════════════════
// ★★★ WHAT PHASE 15 CHANGED HERE, AND WHY EACH CHANGE IS STRUCTURAL RATHER THAN A PATCH.
//
// Four defects were measured by BUILDING THE SHELL AND READING WHAT CAME BACK. Every one of them
// passed a source-text check and failed against a real row. Patching the four values would leave
// the fifth free to arrive. So each fix is expressed as a RULE THE DESCRIPTOR MUST SATISFY:
//
//   F14 / P15.2  — there was NO highlights region and no descriptor carried the six U3 values.
//                  → `highlights` is now a region, it is MANDATORY on every descriptor, every
//                    entry must NAME ITS SOURCE, and buildRecordShell THROWS if the query did
//                    not supply one. "A highlights panel of nulls is worse than none."
//   F12 / P15.2a — document.header.title = 'name'; there is no `name` column.
//                  → the column now exists (0022) and is NOT NULL. The descriptor points at it.
//   F13 / P15.2b — activity.of = 'audit_event'; there is no such table.
//                  → repointed at `event`, and ACTIVITY_TABLE is asserted against the schema by
//                    db/gates/p15_crm_screens.mjs rather than being a string nobody checks.
//   P15.2c       — subscription.header.title = 'plan_id', a RAW UUID, and its panel rendered
//                  plan_id and app_user_id raw.
//                  → A PANEL FIELD MAY NOT BE A FOREIGN KEY. `assertDescriptor` refuses any
//                    field name ending in `_id`, and there is deliberately NO 'uuid' member of
//                    FIELD_FORMATS. The defect is now unrepresentable, not merely absent.

import { DOCUMENTS_DOMAIN } from "../documents/frontDoor.mjs";

/** ★ The five regions, in order. A descriptor may not add a sixth — see `assertDescriptor`. */
export const SHELL_REGIONS = Object.freeze(['header', 'highlights', 'panels', 'related', 'activity']);

/**
 * ★★★ F13 — THE ACTIVITY FEED'S TABLE, NAMED ONCE.
 * It was `audit_event`, which [MEAS] has exactly ONE hit in the entire project — the line that
 * emitted it. Every record's activity feed pointed at nothing and rendered empty forever, which
 * is indistinguishable from "this record has no activity".
 * ★ It is a named export so the gate can assert it against `information_schema.tables` instead of
 *   against another copy of the same string.
 */
export const ACTIVITY_TABLE = 'event';

/**
 * ★★★ RELATED LISTS THAT MAY NOT EXIST.
 * §A3: an Account's people are its TENANT's data — "COUNTS, NEVER NAMES … a tenancy boundary, not
 * a UI choice." Migration 0008 makes the count path structurally incapable of returning a name.
 * ★ This set is the SECOND half of that: it stops a related-list from being declared in the first
 * place, so nobody has to remember. `assertDescriptor` refuses a descriptor that declares one.
 */
export const FORBIDDEN_RELATED = Object.freeze({
  account: ['people', 'clients', 'users', 'staff', 'members'],
});

/**
 * ★ A `count` related-entry renders a NUMBER and has no row template at all. This is the shape an
 * Account uses for its seats — the only shape available to it.
 */
const RELATED_KINDS = Object.freeze(['list', 'count']);

/**
 * ★★★ THE CLOSED SET OF FIELD FORMATS, AND NOTE WHAT IS NOT IN IT.
 *
 * There is no `uuid` and there is no `raw`. A record page exists to be read by a person, and
 * `1f2b…` is not a fact about anybody. This is the same defect class CLAUDE.md records from the
 * PIR portal — "rendered a raw `1` where the question said `1 — Not at all`" — and the shell now
 * has no way to express it.
 *
 * ★ `enum` is distinct from `text` deliberately: an enum is a CLOSED set the renderer may style
 *   (a status pill), and a free-text column must never be styled as though it were one.
 */
// ★★★ L9 — `phone` IS A FORMAT, AND IT HAS TO BE DECLARED HERE FIRST. `assertDescriptor` refuses
//     any header whose format is not in this list, so a column declaring `phone` before the
//     vocabulary knows the word would be rejected by the server — correctly, and confusingly.
//   ★★ THE REASON IT IS NEEDED: `keystone.normalise_phone_e164` stores every number in E.164, so
//      what a practice TYPED as "+1-555-0164" is STORED as "+15550164" — which is right, and which
//      renders on screen as an unbroken run of digits. **The storage was never the defect; the
//      DISPLAY was.** A CRM whose client list shows `+15550164` is one nobody can read a number off.
// ★ 'tags' added the maintainer, 29 Sep 2026 — the four system tags (Adult/Adolescent/Parent/Lead), an array
//   because a person may hold more than one (see src/records/lists/people.mjs's TAGS_EXPR).
const FIELD_FORMATS = Object.freeze(['text', 'enum', 'money', 'date', 'datetime', 'boolean', 'number', 'phone', 'tags', 'program', 'programs']);

/**
 * ★★★ HIGHLIGHT PROVENANCE. P15.2(b) — "SAY WHERE EACH OF THE SIX VALUES COMES FROM: which table,
 * which column, which query."
 *
 * `from` is either `table.column` — a value read straight off a row — or `derived:<name>`, which
 * names a computation in `src/records/queries.mjs`. Both forms are CHECKED, and the derived names
 * are cross-checked against the query module by db/gates/p15_crm_screens.mjs. A highlight whose
 * provenance is a shrug is the thing this rule exists to stop.
 */
const PROVENANCE_RE = /^(?:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*|derived:[a-z][a-z0-9_]*)$/;

export const RECORD_TYPES = Object.freeze({
  person: {
    key: 'person', label: 'Person', section: 'people',
    notFound: { headline: 'No such person',
                line: 'This person is not in your practice, or you may not see them. Both look the same from here, on purpose — a record page must not become a way to find out who exists.' },
    header: { title: 'display_name', status: 'role' },

    // ★★★ U3`s SIX VALUES, EACH WITH ITS SOURCE. §D6: "name, engagement, coach, progress, next`
    //     session, billing status … stays visible while the tabs beneath it change."
    //     ★ Four of the six are DERIVED, because [MEAS] app_user carries none of them: there is no
    //       coach_id, no engagement column and no progress column anywhere in the 41 tables. The
    //       requirement is met by computing them from tables that DO exist — not by inventing
    //       columns and not by lowering the requirement.
    highlights: [
      { key: 'name',           label: 'Name',           from: 'app_user.display_name',  empty: 'Unnamed', format: 'text' },
      // ★ Completed sessions in the trailing 90 days. `booking.state='completed'` is the only
      //   terminal "it happened" fact the schema has — ADD3-1 notes there is no booking.completed
      //   TOPIC, but the STATE exists and is what this reads.
      { key: 'engagement',     label: 'Engagement',     from: 'derived:sessions_90d',   empty: 'No sessions yet', format: 'text' },
      // ★ The host of this person's most recent non-cancelled booking. booking.host_id is NOT NULL
      //   and REFERENCES app_user, so the join cannot half-resolve.
      { key: `coach`,          label: `Coach`,          from: 'derived:current_coach',  empty: 'Unassigned', format: 'text' },
      // ★ Credits consumed / credits bought, across ACTIVE entitlements only.
      { key: 'progress',       label: 'Progress',       from: 'derived:credit_progress', empty: 'No package', format: 'text' },
      { key: 'next_session',   label: 'Next session',   from: 'derived:next_session',   empty: 'None scheduled', format: 'text' },
      { key: 'billing_status', label: 'Billing',        from: 'derived:billing_status', empty: 'Nothing due', format: 'text' },
      // ★★★ [TY, RULED 1 Oct 2026] Site-readiness brief, 0549 — the public site's lead form asks
      //   for a preferred call time and captures ad attribution; neither had anywhere to be SEEN
      //   once stored. NULL for anyone who was never a website lead, same as `coach`/`billing_status`
      //   above are NULL for someone with no bookings or invoices — an absent fact, not a bug.
      { key: 'lead_best_time', label: 'Best time to call', from: 'derived:lead_best_time', empty: 'No preference given', format: 'text' },
      { key: 'lead_came_from', label: 'Came from',         from: 'derived:lead_came_from', empty: 'No ad attribution',   format: 'text' },
    ],

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ P2.1 — THE DETAILS CARD, GROUPED THE WAY THE CANONICAL MODEL GROUPS IT. Before 0076 this
    //     card had THREE fields, because `app_user` had two columns of person data. The panels are
    //     not a UI preference: each one is a group from the canonical Contact entity, and a reader
    //     can check the schema against it.
    //   ★★ EVERY FIELD HERE IS A REAL COLUMN. `buildRecordShell` THROWS on a field the query did
    //      not select, which is the guard that stops this list drifting into a wish.
    // ═════════════════════════════════════════════════════════════════════════════════════════
    panels: [
      { key: 'identity', label: 'Identity', fields: [
        { field: 'display_name',   label: 'Name',           format: 'text' },
        { field: 'first_name',     label: 'First name',     format: 'text' },
        { field: 'last_name',      label: 'Last name',      format: 'text' },
        { field: 'preferred_name', label: 'Preferred name', format: 'text' },
        { field: 'pronouns',       label: 'Pronouns',       format: 'text' },
        // ★★ The column that ends "minority is asserted and never dated" — see 0076.
        { field: 'date_of_birth',  label: 'Date of birth',  format: 'date' },
        { field: 'role',           label: 'Role',           format: 'enum' },
        { field: 'lifecycle_status', label: 'Status',       format: 'enum' },
      ] },

      { key: 'contact', label: 'Contact', fields: [
        { field: 'email',           label: 'Email',            format: 'text' },
        { field: 'secondary_email', label: 'Secondary email',  format: 'text' },
        { field: 'mobile_phone',    label: 'Mobile',           format: 'phone' },
        { field: 'home_phone',      label: 'Home phone',       format: 'phone' },
        { field: 'preferred_contact_method', label: 'Prefers', format: 'enum' },
        // ★★★ THE THREE FLAGS ARE ON THE CARD, NOT BURIED IN A SETTINGS DRAWER. Somebody about to
        //     pick up the phone has to be able to SEE that they must not.
        { field: 'do_not_email',    label: 'Do not email',     format: 'boolean' },
        { field: 'do_not_text',     label: 'Do not text',      format: 'boolean' },
        { field: 'do_not_call',     label: 'Do not call',      format: 'boolean' },
      ] },

      { key: 'address', label: 'Address', fields: [
        { field: 'address_line1', label: 'Line 1',   format: 'text' },
        { field: 'address_line2', label: 'Line 2',   format: 'text' },
        { field: 'city',          label: 'City',     format: 'text' },
        { field: 'state_region',  label: 'State',    format: 'text' },
        { field: 'postcode',      label: 'Postcode', format: 'text' },
        { field: 'country',       label: 'Country',  format: 'text' },
        // ★ The PERSON's zone, not the practice's — a reminder sent at "9am" has to pick one.
        { field: 'timezone',      label: 'Timezone', format: 'text' },
      ] },

      { key: 'relationship', label: 'Relationship', fields: [
        { field: 'source',    label: 'Source',    format: 'text' },
        { field: 'joined_at', label: 'Joined',    format: 'date' },
        // ★★★ `tags` IS NOT ON THE CARD, AND THE REASON IS A REAL GAP WORTH NAMING. It is `text[]`,
        //     and an empty array renders as an EMPTY <dd> — which `p21d_screens_real_rows` refuses
        //     by name: *"a blank cell is indistinguishable from a zero, a null and a bug."*
        //   ★★ HIGHLIGHTS CARRY AN `empty:` WORD ("No sessions yet", "Unassigned"). **PANEL FIELDS
        //      DO NOT** — so a panel has no way to say what nothing looks like. That is P4.10's
        //      five-state contract, and inventing a one-off format here would put the rule in a
        //      second place. ★ Tags reach the screen as chips on the LIST at P6.3 meanwhile.
        { field: 'notes',     label: 'Notes',     format: 'text' },
      ] },

      // ★★★ AN EMERGENCY CONTACT, IN A RECOVERY-COACHING PRODUCT. It could not be recorded at all
      //     before 0076, which is the starkest of P2.1's four measured consequences.
      { key: 'emergency', label: 'Emergency contact', fields: [
        { field: 'emergency_contact_name',         label: 'Name',         format: 'text' },
        { field: 'emergency_contact_relationship', label: 'Relationship', format: 'text' },
        { field: 'emergency_contact_phone',        label: 'Phone',        format: 'phone' },
      ] },

      // ★★ THE VERTICAL ADD-ON. Four fields on top of the base — P2.2 makes this a TEMPLATE rather
      //    than something every tenant carries, which is how one schema serves sixteen verticals.
      { key: 'recovery', label: 'Recovery', fields: [
        { field: 'sobriety_date',      label: 'Sobriety date', format: 'date' },
        { field: 'recovery_programme', label: 'Programme',     format: 'text' },
        { field: 'sponsor_name',       label: 'Sponsor',       format: 'text' },
        { field: 'support_network',    label: 'Support network', format: 'text' },
      ] },

      // ★ `staff_role` shows only for staff — the shape constraint in 0010 guarantees a
      //   non-staff row's value is NULL, so this cannot render a rank for a parent.
      { key: 'rank', label: 'Team', when: { role: 'staff' }, fields: [
        { field: 'staff_role', label: 'Rank', format: 'enum' },
      ] },
    ],
    related: [
      ...DOCUMENTS_DOMAIN.personRelated,
      { key: 'subscriptions', kind: 'list', label: 'Subscriptions', of: 'subscription' },
    ],
  },

  account: {
    key: 'account', label: 'Account', section: 'accounts',
    notFound: { headline: 'No such account',
                line: 'This account is not in your practice, or you may not see it.' },
    header: { title: 'name', status: 'status' },
    // ★★ §A3 rules that the account record also carries the Run schedule, the access ledger and
    //    "what is BILLED AND NOT DELIVERABLE". [MEAS] run_schedule_item and account_grant DO NOT
    //    EXIST — they are ADDENDUM 4 / PHASE 20. They are therefore NOT declared here: a highlight
    //    naming a table that does not exist is F13 repeating, and P20 adds them with their sources.
    highlights: [
      { key: 'name',        label: 'Name',      from: 'account.name',            empty: 'Unnamed', format: 'text' },
      { key: 'status',      label: 'Status',    from: 'account.status',          empty: 'Unknown', format: 'enum' },
      // ★★★ COUNTS, NEVER NAMES — U11. The source is the SECURITY DEFINER function whose return
      //     type is five integers, precisely so no name can travel back (0007/0008).
      { key: 'seats_used',  label: 'Seats used', from: 'derived:seat_counts',    empty: 'No seats', format: 'text' },
      { key: 'pipelines',   label: 'Pipelines', from: 'derived:pipeline_states',  empty: 'None running', format: 'text' },
    ],
    // ★★ P2.3 — the canonical account, grouped the way the canonical Account entity is. Seven
    //    columns became twenty-seven; two panel fields become fourteen.
    panels: [
      { key: 'basics', label: 'Basics', fields: [
        { field: 'name',           label: 'Name',    format: 'text' },
        { field: 'status',         label: 'Status',  format: 'enum' },
        { field: 'account_number', label: 'Account number', format: 'text' },
        { field: 'account_type',   label: 'Type',    format: 'enum' },
        { field: 'industry',       label: 'Industry', format: 'text' },
        { field: 'employee_count', label: 'Employees', format: 'number' },
        { field: 'source',         label: 'Source',  format: 'text' },
        { field: 'description',    label: 'About',   format: 'text' },
      ] },
      { key: 'reach', label: 'Contact', fields: [
        { field: 'phone',   label: 'Phone',   format: 'text' },
        { field: 'email',   label: 'Email',   format: 'text' },
        { field: 'website', label: 'Website', format: 'text' },
        // ★★★ THE IN-TENANT PRIMARY CONTACT'S NAME — resolved from `app_user` INSIDE this tenant.
        //     ★ It is NOT reached through `customer_tenant_id`: that is the platform relation and
        //       §A3 rules "counts, never names" across it. Two relations that look alike and are
        //       opposites; see 0080's header.
        { field: 'primary_contact', label: 'Primary contact', format: 'text' },
      ] },
      { key: 'billing', label: 'Billing address', fields: [
        { field: 'billing_line1',        label: 'Line 1',   format: 'text' },
        { field: 'billing_line2',        label: 'Line 2',   format: 'text' },
        { field: 'billing_city',         label: 'City',     format: 'text' },
        { field: 'billing_state_region', label: 'State',    format: 'text' },
        { field: 'billing_postcode',     label: 'Postcode', format: 'text' },
        { field: 'billing_country',      label: 'Country',  format: 'text' },
      ] },
    ],
    related: [
      // ★★★ A COUNT, NOT A LIST. There is no row template because there are no rows —
      // `account_seat_counts()` returns five integers and nothing else.
      { key: 'seats', kind: 'count', label: 'Seats', source: 'account_seat_counts' },
      { key: 'pipelines', kind: 'list', label: 'Pipelines', of: 'account_pipeline' },
    ],
  },

  network_party: {
    key: 'network_party', label: 'Network party', section: 'network',
    notFound: { headline: 'No such partner',
                line: 'This referral partner is not in your practice, or you may not see it.' },
    header: { title: 'name', status: 'kind' },
    highlights: [
      { key: 'name',  label: 'Name', from: 'network_party.name', empty: 'Unnamed', format: 'text' },
      { key: 'kind',  label: 'Kind', from: 'network_party.kind', empty: 'Unclassified', format: 'enum' },
      { key: 'since', label: 'Known since', from: 'network_party.created_at', empty: 'Unknown', format: 'date' },
    ],
    panels: [
      { key: 'basics', label: 'Basics', fields: [
        { field: 'name',   label: 'Name',   format: 'text' },
        { field: 'kind',   label: 'Kind',   format: 'enum' },
        { field: 'active', label: 'Active', format: 'boolean' },
        { field: 'notes',  label: 'Notes',  format: 'text' },
      ] },
      // ★★★ THE CONTACT IS A PERSON'S NAME RESOLVED THROUGH A KEY, NOT A STRING TYPED HERE.
      //     0081 made it `contact_person text` and test/p15b_network_writes.test.mjs:115 went red
      //     within the hour: a human whose details live outside `app_user` has no
      //     do_not_email/do_not_text/do_not_call beside them. 0082 replaced it with
      //     `primary_contact_id`, a composite FK — the same decision P2.3 made for an account one
      //     item earlier. ★ The value below is the JOINED NAME (queries.mjs), so the screen reads
      //     the same as it would have and the storage is the part that changed.
      { key: 'reach', label: 'Contact', fields: [
        { field: 'primary_contact', label: 'Contact',  format: 'text' },
        { field: 'email',           label: 'Email',    format: 'text' },
        { field: 'phone',           label: 'Phone',    format: 'text' },
        { field: 'website',         label: 'Website',  format: 'text' },
      ] },
      { key: 'address', label: 'Address', fields: [
        { field: 'address_line1', label: 'Line 1',   format: 'text' },
        { field: 'address_line2', label: 'Line 2',   format: 'text' },
        { field: 'city',          label: 'City',     format: 'text' },
        { field: 'state_region',  label: 'State',    format: 'text' },
        { field: 'postcode',      label: 'Postcode', format: 'text' },
        { field: 'country',       label: 'Country',  format: 'text' },
      ] },
      { key: 'agreement', label: 'Agreement', fields: [
        { field: 'agreement_on_file', label: 'On file', format: 'boolean' },
      ] },
    ],
    // ★★★ `related: []` WAS THE WHOLE DEFECT IN ONE LINE. [MEASURED, F122] `network_party` had ZERO
    //     inbound foreign keys, so the Network section could record that a school EXISTS and could
    //     never record that it sent you anybody. 0081 adds `app_user.referred_by_party_id`; this is
    //     the other end of that edge finally having somewhere to appear.
    related: [
      { key: 'referrals', kind: 'list', label: 'People referred', of: 'person' },
      { key: 'referred_out', kind: 'list', label: 'People referred out', of: 'person' },
    ],
  },

  ...DOCUMENTS_DOMAIN.recordShell,   // `document` — declared by Documents (ISLAND-PROGRAMS §2)

  service: {
    key: 'service', label: 'Service', section: 'items',
    notFound: { headline: 'No such service',
                line: 'This service is not in your catalogue. A service is archived rather than deleted, so check Items with archived rows shown.' },
    header: { title: 'name', status: 'active' },
    // ★★★ B2.1 / P15.5a — PRICE COMES FROM THE `price` TABLE, NOT FROM `service.price_minor`.
    //     Migration 0015 moved price out under expand/contract and LEFT the old column in place;
    //     reading it renders whatever was true before the move. NOT `plan_price` — F21, no such
    //     table. The target is the polymorphic `price` table, keyed (subject_type, subject_id).
    //     ★ §Z4: a thing is SELLABLE only when its definition is ACTIVE **and** an active price
    //       row covers now(). Two conditions. `derived:sellable` is that conjunction, so a screen
    //       cannot imply an unpriced service can be sold.
    highlights: [
      { key: 'name',     label: 'Service',  from: 'service.name',          empty: 'Unnamed', format: 'text' },
      { key: 'price',    label: 'Price',    from: 'derived:live_price',    empty: 'No live price', format: 'text' },
      { key: 'duration', label: 'Duration', from: 'service.duration_minutes', empty: 'No duration', format: 'number' },
      { key: 'sellable', label: 'Sellable', from: 'derived:sellable',      empty: 'Not sellable', format: 'text' },
    ],
    panels: [{ key: 'basics', label: 'Basics', fields: [
      { field: 'name',             label: 'Name',     format: 'text' },
      { field: 'price_amount_minor', label: 'Price',  format: 'money', currency: 'price_currency' },
      { field: 'duration_minutes', label: 'Minutes',  format: 'number' },
      { field: 'bookable',         label: 'Bookable', format: 'boolean' },
    ] }],
    related: [],
  },

  plan: {
    key: 'plan', label: 'Plan', section: 'items',
    notFound: { headline: 'No such plan',
                line: 'This plan is not in your catalogue. A plan is archived rather than deleted, so check Items with archived rows shown.' },
    header: { title: 'name', status: 'active' },
    highlights: [
      { key: 'name',     label: 'Plan',     from: 'plan.name',          empty: 'Unnamed', format: 'text' },
      { key: 'price',    label: 'Price',    from: 'derived:live_price', empty: 'No live price', format: 'text' },
      { key: 'interval', label: 'Interval', from: 'plan.interval',      empty: 'No interval', format: 'enum' },
      { key: 'sellable', label: 'Sellable', from: 'derived:sellable',   empty: 'Not sellable', format: 'text' },
    ],
    panels: [{ key: 'basics', label: 'Basics', fields: [
      { field: 'name',               label: 'Name',     format: 'text' },
      { field: 'price_amount_minor', label: 'Price',    format: 'money', currency: 'price_currency' },
      { field: 'interval',           label: 'Interval', format: 'enum' },
    ] }],
    // ★ A Plan lists its subscriptions; a Subscription is NOT a plan. §A4 keeps the words apart.
    related: [{ key: 'subscriptions', kind: 'list', label: 'Subscriptions', of: 'subscription' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P2.8 — booking AND invoice, WHICH HAD NO RECORD PAGE AT ALL.
  //     [MEASURED] `RECORD_TYPES` had SEVEN entries — person · account · network_party · document ·
  //     service · plan · subscription — and neither of these was among them. **Contract property 3
  //     (OPEN) failed for both**: a booking could not be opened to see who attended, and an invoice
  //     could not be opened to see what it charges for.
  //   ★★★ WHICH MEANT EVERY FIELD P2.5 AND P2.6 ADDED WAS INVISIBLE, and `line_item` — a table with
  //       its own writer, its own events and now its own foreign keys — **was visible NOWHERE in the
  //       product.** Three items of work landed in the database and none of it reached a screen.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  booking: {
    key: 'booking', label: 'Session', section: 'engagements',
    notFound: { headline: 'No such session',
                line: 'This session is not in your practice, or you may not see it. A cancelled session still has a record; a missing one was never yours.' },
    header: { title: 'title', status: 'state' },
    highlights: [
      { key: 'client',   label: 'Client',   from: 'derived:booking_client',  empty: 'No participants', format: 'text' },
      { key: `coach`,    label: `Coach`,    from: 'derived:booking_host',    empty: 'Unassigned',      format: 'text' },
      { key: 'when',     label: 'When',     from: 'derived:booking_when',    empty: 'Not scheduled',   format: 'text' },
      { key: 'where',    label: 'Where',    from: 'derived:booking_where',   empty: 'Not set',         format: 'text' },
    ],
    panels: [
      { key: 'basics', label: 'Session', fields: [
        { field: 'title',       label: 'Title',   format: 'text' },
        { field: 'state',       label: 'State',   format: 'enum' },
        { field: 'description', label: 'Notes',   format: 'text' },
      ] },
      // ★★ THE LOCATION READS AS TWO FIELDS BECAUSE IT IS TWO FACTS (0085). The KIND decides what
      //    the DETAIL means, and a screen that showed only the detail could not tell a room number
      //    from a telephone number.
      { key: 'where', label: 'Location', fields: [
        { field: 'location_kind',   label: 'Kind',    format: 'enum' },
        { field: 'location_detail', label: 'Details', format: 'text' },
      ] },
      { key: 'reminder', label: 'Reminder', fields: [
        { field: 'reminder_minutes_before', label: 'Minutes before', format: 'number' },
        { field: 'recurrence_cadence',      label: 'Repeats',        format: 'enum' },
      ] },
      // ★ Only shown when it happened: `cancellation_reason` is NULL unless cancelled (0085's CHECK),
      //   so this panel is empty on a live session rather than misleading.
      { key: 'cancellation', label: 'Cancellation', fields: [
        { field: 'cancellation_reason', label: 'Reason', format: 'text' },
      ] },
    ],
    // ★★ THE LINE ITEMS ARE THE POINT. P2.7 gave `line_item` a real `booking_id`; this is where a
    //    session's charges become visible for the first time.
    // ★★★ F443 — `participants` FIRST, because it is the one the attendance control READS. Without
    //     this entry `relatedRows.participants` was always `[]` and the control marked nobody.
    //   ★★ `of: 'participant'`, NOT `of: null`. I wrote `null` first, reasoning that a participant
    //      is not one of the nine servable record types so the rail should not link it — and
    //      `assertDescriptor` refused it: *"related list must declare what it lists via `of`"*.
    //      **The gate was right and my reasoning was aimed at the wrong layer.** `of` says WHAT
    //      THIS IS A LIST OF; whether that thing can be OPENED is `RecordPage`'s `OPENABLE` set,
    //      which already renders a non-servable type as text rather than as a link into the error
    //      screen. `lines` sets the precedent — `of: 'line_item'` is not servable either, and F444
    //      fixed that at the RENDER layer, which is where it belongs.
    //   ★ So: declare the truth here, and let the renderer decide what is clickable.
    related: [
      { key: 'participants', kind: 'list', label: 'Who was there', of: 'participant' },
      { key: 'lines', kind: 'list', label: 'Charges', of: 'line_item' },
    ],
  },

  invoice: {
    key: 'invoice', label: 'Invoice', section: 'money',
    notFound: { headline: 'No such invoice',
                line: 'This invoice is not in your practice, or you may not see it. An invoice is never deleted — it is a record of something that happened.' },
    // ★★★ THE HEADER IS THE NUMBER, NOT THE UUID. A person telephoning about an invoice is holding
    //     "2026-0043" (P2.6); they are not holding a uuid and not holding Stripe's id.
    header: { title: 'invoice_number', status: 'status' },
    highlights: [
      { key: 'payer',  label: 'Payer',   from: 'derived:invoice_payer', empty: 'No payer',      format: 'text' },
      { key: 'total',  label: 'Total',   from: 'invoice.amount_minor',  empty: 'No amount',     format: 'money', currency: 'currency' },
      { key: 'due',    label: 'Due',     from: 'invoice.due_at',        empty: 'No deadline',   format: 'date' },
      { key: 'paid',   label: 'Paid',    from: 'derived:invoice_paid',  empty: 'Nothing paid',  format: 'text' },
    ],
    panels: [
      { key: 'basics', label: 'Invoice', fields: [
        { field: 'invoice_number', label: 'Number', format: 'text' },
        { field: 'status',         label: 'Status', format: 'enum' },
        { field: 'due_at',         label: 'Due',    format: 'date' },
        { field: 'memo',           label: 'Memo',   format: 'text' },
      ] },
      // ★★ THE WORKING, SHOWN. 0086 stores subtotal, tax and discount as real columns because an
      //    invoice is a FROZEN STATEMENT — the tax that applied when it was issued must not change
      //    because a setting did. A page showing only the total cannot answer "why that figure?".
      { key: 'amounts', label: 'Amounts', fields: [
        { field: 'subtotal_minor', label: 'Subtotal', format: 'money', currency: 'currency' },
        { field: 'discount_minor', label: 'Discount', format: 'money', currency: 'currency' },
        { field: 'tax_minor',      label: 'Tax',      format: 'money', currency: 'currency' },
        { field: 'amount_minor',   label: 'Total',    format: 'money', currency: 'currency' },
      ] },
      { key: 'billing', label: 'Billed to', fields: [
        { field: 'billing_line1',        label: 'Line 1',   format: 'text' },
        { field: 'billing_line2',        label: 'Line 2',   format: 'text' },
        { field: 'billing_city',         label: 'City',     format: 'text' },
        { field: 'billing_state_region', label: 'State',    format: 'text' },
        { field: 'billing_postcode',     label: 'Postcode', format: 'text' },
        { field: 'billing_country',      label: 'Country',  format: 'text' },
      ] },
      { key: 'void', label: 'Void', fields: [
        { field: 'void_reason', label: 'Reason', format: 'text' },
      ] },
    ],
    // ★★★ WHAT IT CHARGES FOR. P2.8's stated proof is "assert line items render on the invoice", and
    //     until P2.7 gave `line_item` a real `invoice_id` there was nothing sound to join on.
    related: [{ key: 'lines', kind: 'list', label: 'Line items', of: 'line_item' }],
  },

  subscription: {
    key: 'subscription', label: 'Subscription', section: 'money',
    notFound: { headline: 'No such subscription',
                line: 'This subscription is not in your practice, or you may not see it. A cancelled subscription still has a record.' },
    // ★★★ P15.2c — WAS 'plan_id', A RAW UUID ON THE PAGE HEADING. It is the resolved plan NAME
    //     now. [MEAS] subscription.plan_id and subscription.app_user_id are BOTH NOT NULL and
    //     both REFERENCE a real table, so the join cannot half-resolve and the value cannot be
    //     null for a row that exists.
    //     ★ Resolving the plan NAME live is correct and is NOT the hard-limit-3 problem F12 had:
    //       the signed instrument is the CONTRACT (subscription.contract_id, NOT NULL by
    //       `subscription_requires_contract`), and the PRICE is already frozen on
    //       `snapshot_amount_minor`. Nothing signed moves when a plan is renamed.
    header: { title: 'plan_name', status: 'state' },
    highlights: [
      { key: 'plan_name',   label: 'Plan',   from: 'derived:subscription_plan',   empty: 'No plan', format: 'text' },
      { key: 'client_name', label: 'Client', from: 'derived:subscription_client', empty: 'No client', format: 'text' },
      { key: 'state',       label: 'State',  from: 'subscription.state',          empty: 'Unknown', format: 'enum' },
      { key: 'renews',      label: 'Renews', from: 'subscription.current_period_end', empty: 'No renewal date', format: 'date' },
    ],
    // ★ No live price field: the frozen amount lives on the subscription itself. Showing the
    //   plan's CURRENT price here would be the first step toward two prices that disagree.
    panels: [{ key: 'basics', label: 'Basics', fields: [
      { field: 'plan_name',             label: 'Plan',       format: 'text' },
      { field: 'client_name',           label: 'Client',     format: 'text' },
      { field: 'state',                 label: 'State',      format: 'enum' },
      { field: 'snapshot_amount_minor', label: 'Agreed price', format: 'money', currency: 'currency' },
      { field: 'started_on',            label: 'Started',    format: 'date' },
    ] }],
    related: [],
  },
});

/**
 * ★ The gate calls this for every descriptor. It throws rather than returning false: a malformed
 * descriptor that merely logs a warning ships.
 */
export function assertDescriptor(d) {
  const where = `record type "${d?.key ?? '(missing key)'}"`;
  if (!d || !d.key) throw new Error(`${where}: a descriptor needs a key`);
  if (!d.header?.title) throw new Error(`${where}: a record needs a header title field`);
  if (!Array.isArray(d.panels)) throw new Error(`${where}: panels must be an array`);
  if (!Array.isArray(d.related)) throw new Error(`${where}: related must be an array (use [])`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ S3.2 — EVERY RECORD TYPE MUST SAY WHAT IT IS WHEN THERE IS NO SUCH RECORD.
  //
  //   A list screen's empty state answers *"you have none of these yet"*. A RECORD page has no such
  //   state and must never grow one: there is no "create your first" for a URL somebody followed to
  //   a record that is not there. What it owes instead is a **NOT-FOUND** sentence, and the generic
  //   "This screen could not be loaded" is the wrong one — it describes the SCREEN when the fact is
  //   about the RECORD.
  //
  // ★★★ AND THE WORDING CARRIES A SECURITY PROPERTY, WHICH IS WHY IT IS DECLARED RATHER THAN
  //     IMPROVISED PER SCREEN. "Not found" and "you may not see it" **must read identically**. The
  //     record route is reachable by id, so a page that distinguished the two would answer *"does a
  //     person with this id exist in this practice"* to anybody who could type a uuid — an oracle,
  //     from the one screen that takes an identifier straight off the URL. Each sentence below says
  //     BOTH, deliberately, and several say why.
  //   ★ It is refused at module load, like the highlights rule above, so a tenth record type cannot
  //     be added without one.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (!d.notFound?.headline || !d.notFound?.line) {
    throw new Error(
      `${where}: needs a notFound { headline, line }. A record page has no "create your first" ` +
      `state — what it owes when the record is absent is a sentence about the RECORD, and the ` +
      `generic screen error describes the screen instead. It must not distinguish "does not exist" ` +
      `from "you may not see it": this route takes an id off the URL.`);
  }

  // ★★★ U3 — HIGHLIGHTS ARE MANDATORY AND MAY NOT BE EMPTY.
  //     "Record page, not a page per feature — a highlights panel pinned at the top … staying
  //     visible while the tabs beneath it change." A record type with no highlights is not the
  //     ruled record page, so `highlights: []` is refused exactly as a missing array is.
  if (!Array.isArray(d.highlights) || d.highlights.length === 0) {
    throw new Error(
      `${where}: highlights must be a NON-EMPTY array — U3 rules a pinned highlights panel on ` +
      `every record page, and an empty one is a page with no summary at all`);
  }
  const seenHighlights = new Set();
  for (const h of d.highlights) {
    if (!h?.key) throw new Error(`${where}: a highlight needs a key`);
    if (seenHighlights.has(h.key)) throw new Error(`${where}: duplicate highlight "${h.key}"`);
    seenHighlights.add(h.key);
    if (!h.label) throw new Error(`${where}: highlight "${h.key}" needs a label`);
    // ★ Same closed set as a panel field, and required for the same reason: a format nobody chose
    //   is a raw column on a page. There is no 'uuid' and no 'raw' here either.
    if (!FIELD_FORMATS.includes(h.format)) {
      throw new Error(
        `${where}: highlight "${h.key}" has format ${JSON.stringify(h.format ?? null)} — must be ` +
        `one of ${FIELD_FORMATS.join(', ')}`);
    }
    if (/_id$/.test(h.key)) {
      throw new Error(
        `${where}: highlight "${h.key}" is a foreign key. A PINNED PANEL IS THE MOST READ THING ` +
        `ON THE PAGE and must never carry an identifier. Resolve it to a name in the query`);
    }
    // ★★★ P15.2(b) IS ENFORCED HERE AND NOWHERE ELSE. A highlight that cannot say where it comes
    //     from is refused at declaration, which is the only moment anyone is thinking about it.
    if (!h.from || !PROVENANCE_RE.test(h.from)) {
      throw new Error(
        `${where}: highlight "${h.key}" must declare its SOURCE as "table.column" or ` +
        `"derived:<name>" — got ${JSON.stringify(h.from ?? null)}. P15.2(b): say which table, ` +
        `which column, which query. A highlights panel of nulls is worse than none`);
    }
    // ★★ AND WHAT IT SAYS WHEN THERE IS GENUINELY NOTHING. "None scheduled" is a fact; a blank
    //    cell is a rendering glitch, and B2.5 records exactly how a blank gets "fixed" in CSS.
    if (!h.empty) {
      throw new Error(
        `${where}: highlight "${h.key}" must declare an "empty" string — the words shown when ` +
        `the value is genuinely absent. A blank reads as a bug; "None scheduled" reads as an answer`);
    }
  }

  // ★ No object may invent a region. The shell is the shell.
  // ★★ `notFound` IS METADATA, NOT A REGION, AND THE DISTINCTION IS THE WHOLE POINT OF THIS LIST.
  //    A region is something `buildRecordShell()` RENDERS for a record that exists; `notFound` is
  //    what the screen says when there IS no record, so it is never part of a built shell. Adding
  //    it to `SHELL_REGIONS` would have let a descriptor declare it as a sixth panel area.
  for (const k of Object.keys(d)) {
    if (['key', 'label', 'section', 'readOnlyWhen', 'notFound'].includes(k)) continue;
    if (!SHELL_REGIONS.includes(k)) {
      throw new Error(`${where}: "${k}" is not a shell region — the five regions are ${SHELL_REGIONS.join(', ')}`);
    }
  }

  // ── PANEL FIELDS ───────────────────────────────────────────────────────────
  for (const p of d.panels) {
    if (!Array.isArray(p.fields)) throw new Error(`${where}: panel "${p.key}" needs a fields array`);
    for (const f of p.fields) {
      if (typeof f === 'string' || !f?.field) {
        throw new Error(
          `${where}: panel "${p.key}" declares a bare field ${JSON.stringify(f)} — every field ` +
          `must be { field, label, format }. A format nobody chose is a raw column on a page`);
      }
      // ★★★ P15.2c MADE UNREPRESENTABLE. subscription.header.title was 'plan_id' and its panel
      //     rendered plan_id and app_user_id RAW. A foreign key is an implementation detail; it
      //     is never a fact about a person, a plan or a document, and no format can make it one.
      if (/_id$/.test(f.field)) {
        throw new Error(
          `${where}: panel "${p.key}" renders "${f.field}" — A RECORD PAGE MAY NOT RENDER A ` +
          `FOREIGN KEY. Resolve it to a name in the query and render that. This is the defect ` +
          `P15.2c exists for: a raw UUID under a heading a human is meant to read`);
      }
      if (!f.label) throw new Error(`${where}: panel "${p.key}" field "${f.field}" needs a label`);
      if (!FIELD_FORMATS.includes(f.format)) {
        throw new Error(
          `${where}: panel "${p.key}" field "${f.field}" has format ${JSON.stringify(f.format)} — ` +
          `must be one of ${FIELD_FORMATS.join(', ')}. ★ There is deliberately no "uuid" and no ` +
          `"raw": both exist only to put an identifier in front of a person`);
      }
      if (f.format === 'money' && !f.currency) {
        throw new Error(
          `${where}: panel "${p.key}" field "${f.field}" is money and must name its currency ` +
          `column — an amount with no currency is a number, and 1200 is not a price`);
      }
    }
  }

  const forbidden = FORBIDDEN_RELATED[d.key] ?? [];
  for (const r of d.related) {
    if (!RELATED_KINDS.includes(r.kind)) {
      throw new Error(`${where}: related "${r.key}" has kind "${r.kind}" — must be one of ${RELATED_KINDS.join(', ')}`);
    }
    // ★★★ THE §A3 RULE, ENFORCED AT DECLARATION TIME.
    if (forbidden.includes(r.key)) {
      throw new Error(
        `${where}: related list "${r.key}" is forbidden — §A3, an account's people are COUNTS, ` +
        `NEVER NAMES. Use { kind: 'count' }.`);
    }
    // ★ A `count` entry must have no row template; a `list` must say what it lists.
    if (r.kind === 'count' && r.of) {
      throw new Error(`${where}: related "${r.key}" is a count and must not declare "of"`);
    }
    if (r.kind === 'list' && !r.of) {
      throw new Error(`${where}: related list "${r.key}" must declare what it lists via "of"`);
    }
  }
  return true;
}

/**
 * Build the shell for one record. ★ Region order is fixed here, not by the caller.
 *
 * ★★★ IT THROWS IF THE QUERY DID NOT SUPPLY A DECLARED HIGHLIGHT.
 * The test is `hasOwnProperty`, NOT truthiness, and the distinction is the whole point:
 *   · key ABSENT   → the READ QUERY forgot it. That is a bug in queries.mjs and it is loud.
 *   · key PRESENT, value null → there genuinely is no next session. That is a FACT, and it
 *     renders the descriptor's `empty` words.
 * Without this split the two are indistinguishable, and "a highlights panel of nulls is worse
 * than none" becomes a sentence in a document rather than a property of the program.
 */
/**
 * @param opts.customFields  P2.2's CUSTOM layer, already resolved to `{key,label,kind,value}[]`.
 *   ★★★ THEY ARRIVE AS DATA, NOT AS DESCRIPTORS, AND THAT IS THE WHOLE DESIGN. P2.1 made this
 *       function throw on a declared panel field the row does not carry — so a custom field declared
 *       by tenant A would make the shell throw for tenant B, whose query never selects it. The
 *       static panels stay static and keep their guard; the dynamic ones are dynamic all the way
 *       down. **Two different things kept apart, rather than one mechanism bent to do both.**
 * @param opts.hidePanels   P2.2's TEMPLATE layer: panel keys whose vertical pack this tenant has
 *   not selected. ★ Expressed as HIDE rather than SHOW so a failed lookup hides nothing — a
 *   default that can blank the card is worse than a vertical panel nobody wanted.
 */
export function buildRecordShell(typeKey, row = {}, { customFields = [], hidePanels = [] } = {}) {
  const d = RECORD_TYPES[typeKey];
  if (!d) throw new Error(`no record descriptor for "${typeKey}" — add one to RECORD_TYPES`);
  assertDescriptor(d);

  const visible = (p) =>
    !p.when || Object.entries(p.when).every(([f, v]) => row[f] === v);

  const highlights = d.highlights.map((h) => {
    if (!Object.prototype.hasOwnProperty.call(row, h.key)) {
      throw new Error(
        `record type "${typeKey}": the row supplied to buildRecordShell has no "${h.key}" — the ` +
        `read query must produce it (source: ${h.from}). ★ An ABSENT key means the QUERY forgot ` +
        `it; a null VALUE means there is genuinely none and renders "${h.empty}". They are ` +
        `different facts and this is the only place that can tell them apart`);
    }
    const value = row[h.key];
    return {
      key: h.key, label: h.label, from: h.from, empty: h.empty, format: h.format,
      value: value ?? null,
      // ★ Precomputed so the renderer never has to decide. A renderer that decides is a second
      //   place the rule lives, which is P4.10's measured failure.
      present: value !== null && value !== undefined && value !== '',
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `fields` — THE FLAT LOOKUP THE RECORD-PAGE CONTROLS ACTUALLY NEED. F442.
  //
  //   Every state-dependent control on a record page asks a scalar question: *is this booking
  //   closed? is this document executed? what stage is this person at? is this account paused?*
  //   `panels` carries those values, but nested two levels deep and keyed for RENDERING
  //   (`panels[].fields[] -> {field, label, format, value, currency}`), which is the wrong shape
  //   for a guard.
  //
  //   ★★★ SO FOUR SURFACES READ `shell.fields` AND IT DID NOT EXIST — undefined in all eight call
  //       sites (`webui/.../Screen.svelte:275-279, 297, 305, 314`). Nothing threw. The guards
  //       simply never became true, so the controls never rendered and the screens looked finished:
  //         · person   — the rank dropdown and "Invite again" NEVER appeared; the stage popover
  //                      always read "Stage: —" with no choice marked current.
  //         · booking  — attendance could close a session while marking NOBODY attended, because
  //                      `participants` was always `[]` and `closed` was always false.
  //         · document — Decline, Execute and the "Executed" chip never appeared; the only control
  //                      left on an instrument was "Withdraw consent".
  //         · account  — pause/resume counted from nothing.
  //
  //   ★★ IT IS A **WHITELIST**, NOT `...row`. A record row carries columns a UI has no business
  //      holding — and the highlight/panel branches above exist precisely to decide what a screen
  //      may see. Spreading the raw row would hand every future component the whole table and make
  //      this file's field discipline decorative. So: exactly the keys the descriptor already
  //      declares, plus the scalars a control needs to decide whether it may act.
  //   ★ `state`, `lifecycle_status` and `role` are the three the guards key on today. They are
  //      listed by name so adding a fourth is a decision somebody makes, not a side effect.
  //   ★ `is_session_note` joined 25 Sep 2026 (Stage 14 FIX, arising from 14.73's G29 share block):
  //      `DocumentActions.svelte`'s share row needs it to decide whether it renders at all — it was
  //      selected by `RECORD_QUERIES.document` (`src/records/queries.mjs:554-555`) but dropped here,
  //      the one gap 14.73 could not close from its own file list.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const CONTROL_KEYS = [
    'state', 'lifecycle_status', 'role', 'staff_role', 'firebase_uid', 'email',
    'attended', 'attendance_recorded_at', 'starts_at', 'ends_at',
    'executed_at', 'declined_at', 'withdrawn_at', 'title', 'name', 'display_name',
    'paused_at', 'pipeline_id', 'template_id', 'archived_at', 'is_session_note',
    // ★ the maintainer, 29 Sep 2026 — the portal-invite control's two facts. `portal_status` is the DERIVED
    //   decision (the route handler computes it and deletes the three raw facts it came from —
    //   see routes/index.mjs — so those three never reach this whitelist at all);
    //   `has_parent_linked` is what lets the control refuse to invite an unlinked teen by name
    //   instead of silently emailing nobody.
    'portal_status', 'has_parent_linked',
  ];
  const fields = {};
  for (const k of CONTROL_KEYS) if (k in row) fields[k] = row[k] ?? null;

  return {
    type: d.key,
    label: d.label,
    /** ★★ The flat, whitelisted scalars a record-page control needs. See the block above. */
    fields,
    readOnly: !!d.readOnlyWhen &&
      Object.entries(d.readOnlyWhen).every(([f, v]) => row[f] === v),
    // ★★★ P7 — WHETHER THIS RECORD IS ARCHIVED, STATED BY THE SERVER RATHER THAN GUESSED.
    //     The archive/restore control on the record page needs to know WHICH of the two it is, and
    //     a client cannot infer it: archived rows are filtered out of every LIST, so "I can see it
    //     therefore it is live" is exactly the wrong inference — the RECORD route serves an archived
    //     row, which is the only reason Restore is reachable at all.
    //   ★★ `row.archived_at` is UNDEFINED for a type whose table has no such column, and `!!` on
    //      undefined is false — which is the right answer for a type that cannot be archived. The
    //      control refuses those by name anyway, so this fails closed twice.
    archived: !!row.archived_at,
    header: { title: row[d.header.title] ?? null, status: row[d.header.status] ?? null },
    highlights,
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ PANEL FIELDS ARE CHECKED THE SAME WAY HIGHLIGHTS ARE, AND UNTIL P2.1 THEY WERE NOT.
    //     The highlight branch above throws on an absent key and explains exactly why:
    //     *"An ABSENT key means the QUERY forgot it; a null VALUE means there is genuinely none…
    //     They are different facts and this is the only place that can tell them apart."*
    //     **Panels did `row[f.field] ?? null` and told them apart never.**
    //
    //   ★★ [MEASURED at P2.1] `db/gates/p2_person_fields.mjs §7` deleted one key from the row and
    //      `buildRecordShell` accepted it silently. Two comments in this file already CLAIMED the
    //      throw covered panels — a comment describing behaviour that does not exist, which is the
    //      class the standing rules name and this project has now met three times.
    //
    //   ★★★ AND P2.1 IS WHAT MAKES IT EXPENSIVE. The person panels went from 3 fields to 30. A typo
    //       in a field name here, or a column forgotten in `queries.mjs`, renders as an EMPTY CELL —
    //       which looks exactly like a person who has not filled that field in. Thirty chances to
    //       lose a field silently, on the card a coach reads before phoning somebody.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ THE CUSTOM PANEL IS APPENDED TO `panels`, NOT PARKED IN A KEY OF ITS OWN. The first
    //    version returned it as `shell.customPanel` and **the renderer never read it** — the field
    //    was isolated correctly, stored correctly, resolved correctly, and did not reach the screen.
    //    [EXECUTED] `db/gates/p2_field_layers.mjs §3` caught it: *"the custom field does not reach
    //    tenant A's record page."*
    //  ★★★ ONE PANEL LIST. A second place a renderer must know to look is a second place it can
    //      forget to, and every other consumer of a shell would have to learn about it too.
    panels: [...d.panels.filter(visible).filter((p) => !hidePanels.includes(p.key)).map((p) => ({
      key: p.key, label: p.label,
      fields: p.fields.map((f) => {
        if (!Object.prototype.hasOwnProperty.call(row, f.field)) {
          throw new Error(
            `record type "${typeKey}": panel "${p.key}" declares field "${f.field}" and the row ` +
            `supplied to buildRecordShell has no such key — the read query must select it. ` +
            `★ An ABSENT key means the QUERY forgot it; a NULL value means there is genuinely none ` +
            `and renders empty. They are different facts and this is the only place that can tell ` +
            `them apart`);
        }
        return {
          field: f.field,
          label: f.label,
          format: f.format,
          value: row[f.field] ?? null,
          currency: f.currency ? (row[f.currency] ?? null) : null,
        };
      }),
    })),
    // ★★ BUILT FROM DATA, and ABSENT when the tenant has defined nothing — a panel with a heading
    //    and no rows is the blank-cell defect one level up.
    ...(customFields.length === 0 ? [] : [{
      key: 'custom', label: 'Additional',
      fields: customFields.map((f) => ({
        field: f.key,
        label: f.label,
        // ★ `kind` maps onto the same format vocabulary the static panels use, so the renderer has
        //   ONE switch and not two. A `select` renders as an enum.
        format: f.kind === 'select' ? 'enum' : f.kind,
        value: f.value ?? null,
        currency: null,
      })),
    }])],
    related: d.related.map((r) => ({ ...r })),
    // ★★★ F13 — `event`, not `audit_event`. See ACTIVITY_TABLE above.
    activity: { key: 'activity', label: 'Activity', kind: 'list', of: ACTIVITY_TABLE },
  };
}

