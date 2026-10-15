// P5.2 · P5.3 — THE KEYSTONE NAV. ONE SOURCE.
//
// ★★ ONE SOURCE, AND THE REASON IS MEASURED, NOT STYLISTIC.
// [MEASURED 2026-09-12, P4.10] the PIR portal carried the same seven labels in TWO tables and
// they DISAGREED — `notifications` read 'Alerts' in one and 'Notifications' in the other. Nobody
// ever saw 'Alerts' because a `||` fallback always shadowed it. ★ Wrong data that is invisible
// because something else shadows it is the worst kind, because it waits. This file is the only
// place a Keystone section is named.
//
// ★ §A1, ruled 2026-09-12: THIRTEEN top-level sections. This supersedes D5's provisional
// six-object list — the six-object PRINCIPLE stands, this is the settled section list.
//
// ══ BUCKETS, ON EVERY ROW ═══════════════════════════════════════════════════
//   key   — bucket C, an IDENTIFIER. Never changes, never translated.
//   path  — bucket C, an IDENTIFIER. Never changes.
//   label — bucket A, the ONLY configurable one — and only when it is a PARTY NOUN.
//   minRole — bucket B, a stored DATA VALUE. Changing it is a MIGRATION, never a rename.
// ★ Getting this wrong is how a party label crosses parties on an executed instrument, which
// has already happened in this product once.
//
// ★★ `termKey` is set ONLY where the label is genuinely a party noun. 'Home', 'Money', 'Reports'
// are PRODUCT NAVIGATION — giving them term keys would grow the namespace back toward the 340
// the deleted system carried, most of it for features that no longer exist.

/** §A9 — Platform is SUPER ADMIN 1 ONLY, and per P2.16 it lives in its own server-checked namespace. */
export const PLATFORM_SECTION_KEY = 'platform';

/**
 * ★★★ RETIRED FROM THE NAV. §A1: the word `Organizations` "meant both and therefore neither" —
 * it was used for our customers AND for referral partners. It is replaced by the Accounts /
 * Network split below. A guard asserts it never comes back as a label.
 */
export const RETIRED_NAV_WORDS = Object.freeze(['Organizations', 'Organisations']);

export const SECTIONS = Object.freeze([
  { key: 'home',        path: '/home',        label: 'Home',               minRole: 'client' },
  // ★ the maintainer, 29 Sep 2026 — "Everyone who gets services is a client." The section label becomes
  //   Clients (was People); the key/path stay 'people' — nothing downstream that keys off the
  //   section identifier needs to change, only what a person reads in the sidebar.
  // ★ `People` holds the party nouns, so its CHILDREN carry termKeys — not the section itself.
  { key: 'people',      path: '/people',      label: 'Clients',            minRole: 'staff' },
  // ★ the maintainer, 1 Oct 2026 — Team brief: "Team lives under Clients" was the whole complaint. Promoted
  //   to its own top-level section, same `path` as the row it replaces (PEOPLE_CHILDREN's own
  //   `team`, now `sidebar: false` below, not deleted — same "hide, don't delete" convention this
  //   file already uses for clients/adolescents/parents/leads, for the same reason: nothing that
  //   resolves a path or a rename should have to know which array currently renders it).
  //   `authoriseSection` resolves by PATH via `allRows()`, not by which array a row sits in, so
  //   this move changes nothing about who may reach `/people/team` — same `minRole: 'admin'`.
  { key: 'team',        path: '/people/team', label: 'Team',               minRole: 'admin' },
  // ★★ ACCOUNTS = organisations that are OUR CUSTOMERS. They have an account with us.
  { key: 'accounts',    path: '/accounts',    label: 'Accounts',           minRole: 'staff' },
  // ★★ NETWORK = referral partners, vendors, schools, providers. NOT billed.
  { key: 'network',     path: '/network',     label: 'Network',            minRole: 'staff' },
  { key: 'engagements', path: '/engagements', label: 'Engagements',        minRole: 'staff' },
  { key: 'items',       path: '/items',       label: 'Items and services', minRole: 'staff' },
  { key: 'documents',   path: '/documents',   label: 'Documents',          minRole: 'staff' },
  { key: 'money',       path: '/money',       label: 'Money',              minRole: 'staff' },
  { key: 'run',         path: '/run',         label: 'Run',                minRole: 'staff' },
  { key: 'tasks',       path: '/tasks',       label: 'Tasks',              minRole: 'staff' },
  { key: 'reports',     path: '/reports',     label: 'Reports',            minRole: 'staff' },
  { key: 'settings',    path: '/settings',    label: 'Settings',           minRole: 'admin' },
  // ★★★ Task 17.25 — What's-new section with two children (whats-new-notes and whats-new-log). The
  //     What's-new feature is a staff-visible system status surface. Inserted as the 14th section,
  //     per task 17.31 field 4(b).
  { key: 'whats-new',   path: '/whats-new',   label: "What's new",         minRole: 'staff' },
  // ★ Listed here for completeness of §A1's thirteen, but see PLATFORM_SECTION_KEY: it is NOT
  // served from the tenant app. `isPlatformSection()` exists so a renderer cannot forget.
  { key: PLATFORM_SECTION_KEY, path: '/platform', label: 'Platform', minRole: 'super_admin_1' },
]);

/**
 * §A2 — People's children. ★ Staff must be listable BY ROLE: [MEASURED] previously there was NO
 * surface that showed who held which role.
 */
// ★★★ the maintainer, 29 Sep 2026 — "One Clients list... the sub-tabs become tag filters." `clients` /
//     `adolescents` / `parents` / `leads` stop being a SECOND way to reach those four paths from
//     the sidebar — `PeopleLedger.jsx`'s `VIEWS` already renders in-page tag-filter tabs on top of
//     `/people/all` (All · Adult · Adolescent · Parent · Lead · Archived) that reach the exact
//     same paths. ★★ THE FOUR ROWS ARE NOT DELETED FROM THIS ARRAY, only marked `sidebar: false`:
//     [MEASURED, `test/p5_nav.test.mjs`] this array is ALSO the one place `clients`/`parents`
//     carry the `termKey` a tenant rename resolves through (P5's own "renaming a party noun
//     changes the People child" test) — deleting the rows outright silently took the rename
//     feature down with them, which is a real regression the ruling never asked for. A renderer
//     that lists the sidebar tree must now skip a row with `sidebar: false`; `allRows()`/
//     `resolveSections()` (below) are unchanged and still return every row, since rename
//     resolution and reachability-by-search both still need all of them.
// ★★★ SECTION C (the maintainer, pasted brief, 1 Oct 2026) — "rebuild People tabs as Active (default) · Lead ·
//     All · Paused · Former, driven by lifecycle_status... remove 'Archived' from People and the
//     sidebar." `active` is now the ONE visible People row (same convention `all-people` used to
//     be) — a practice opens Clients and lands on who they are actually working with, not a list
//     that also includes every former and departed person. `all-people`/`archived` follow the SAME
//     "never delete, mark `sidebar: false`" rule this file already uses everywhere else (see the
//     comment above this array): both routes, and everything they are wired to (restore, exports,
//     the generic archive API for OTHER object types), stay reachable — only the SIDEBAR changes.
export const PEOPLE_CHILDREN = Object.freeze([
  { key: 'active',      path: '/people/active',      label: 'Active' },
  { key: 'all-people',  path: '/people/all',        label: 'All people', sidebar: false },
  { key: 'clients',     path: '/people/clients',    termKey: 'userType.clientPlural', fallback: 'Clients', sidebar: false },
  { key: 'adolescents', path: '/people/adolescents', label: 'Adolescents', sidebar: false },
  { key: 'parents',     path: '/people/parents',    termKey: 'userType.parentPlural', fallback: 'Parents', sidebar: false },
  { key: 'leads',       path: '/people/leads',      label: 'Leads', sidebar: false },
  { key: 'paused',      path: '/people/paused',      label: 'Paused', sidebar: false },
  { key: 'former',      path: '/people/former',      label: 'Former', sidebar: false },
  // ★ Task 12.35 — archived people, built by 12.17's LIST_VIEWS descriptor. ★ SECTION C: demoted
  //   from the sidebar — `former` is the new destination for someone who has left; this route and
  //   its restore action stay reachable (deep link, or a future settings screen) but are no longer
  //   a People nav row.
  { key: 'archived',    path: '/people/archived',   label: 'Archived', sidebar: false },
  // ★★★ TASK 1.2 (spec 01 §11) — the four role-split children that used to live here
  // (super-admin-1, super-admins, admins, coaches) are RETIRED: TeamList (§2, `/people/team`
  // itself) is the one combined roster that replaces all four, matching the same retirement of
  // their list descriptors in `src/records/lists/people.mjs`'s `PEOPLE_LISTS`. `invites` stays —
  // §11 keeps it unchanged, and TeamList's own pending-invites section reads it as-is.
  // ★★★ FLAGGED DISCREPANCY, FIXED HERE — spec 01 §4 (:408-409) states TeamList "is therefore
  //     Admin/Owner-only in practice — gated additionally by section: /people/team's own
  //     minRole: "admin" nav floor (unchanged)". [MEASURED] that floor did NOT exist before this
  //     line: this row carried no `minRole` of its own and inherited `people`'s section-level
  //     `minRole: 'staff'` (`authorise.mjs:69-79`), so a Coach could reach the WHOLE roster —
  //     every admin/owner email and every colleague's row — through the unmodified generic
  //     `/api/list/people/team` route. Reported as a scope note (not a STOP): the frame and this
  //     task's own "Done" line both assume the admin/owner-only design is real, this is a one-line,
  //     unambiguous, same-file fix directly for the screen this task builds, and leaving a stated
  //     security boundary provably absent while shipping the screen it is supposed to gate is the
  //     exact "who supplies the condition it checks" failure CLAUDE.md's four failures warn about.
  // ★ the maintainer, 1 Oct 2026 — `sidebar: false`, not deleted: TEAM_CHILDREN (below) is the row that
  //   actually renders now, under the new top-level `team` SECTIONS entry. This row stays so
  //   nothing that resolves `/people/team` by walking PEOPLE_CHILDREN specifically goes dark.
  { key: 'team',        path: '/people/team',       label: 'Team', minRole: 'admin', sidebar: false, children: [
    { key: 'invites',       path: '/people/team/invites',       label: 'Invites', sidebar: false },
  ] },
  // ★ Task 12.35 — scheduling, built by task 12.3's registered routes.
  // ★ the maintainer, 1 Oct 2026 — moved to TEAM_CHILDREN below: staff availability/scheduling belongs with
  //   the staff section, not under Clients. `sidebar: false`, not deleted — same convention this
  //   file already uses everywhere a row moves rather than disappears (see the `team` row above).
  // ★★★ FOUND LIVE, 1 Oct 2026 — `minRole: 'staff'` is EXPLICIT here on purpose, not inherited.
  //   Both this row and TEAM_CHILDREN's copy declare the SAME path (`/people/scheduling`); whichever
  //   SECTIONS entry is walked last when MIN_ROLE_BY_PATH is built (src/nav/authorise.mjs, 'team'
  //   comes after 'people' in SECTIONS) silently OVERWRITES the other's inherited floor. Before the
  //   Team move this row had no explicit minRole and inherited People's 'staff' — a Coach could at
  //   least reach their own schedule (src/people/scheduling.mjs's own "Owner/Admin: everything,
  //   Coach: own row only" design). Relying only on TEAM_CHILDREN's copy inheriting Team's 'admin'
  //   would have silently raised the floor and locked every Coach out of their own hours. Both
  //   copies now say 'staff' explicitly, so neither array's removal can change the other's answer.
  { key: 'scheduling',  path: '/people/scheduling', label: 'Scheduling', minRole: 'staff', sidebar: false },
]);

/**
 * ★ the maintainer, 1 Oct 2026 — Team's own children, now that Team is a top-level section.
 * ★★★ FIX, same day — `invites` was the ONLY child, and NavRow's own click handler
 *   (webreact/src/lib/shell/NavRow.jsx: `if (hasKids && onToggle) { ...; onToggle(); return; }`)
 *   means a row WITH children never navigates to its own path on click, only expands — so the
 *   `TeamListScreen` already registered at `/people/team` (routes.js:90, with the real roster AND
 *   its own "Invite someone" button) was reachable by NO click path in the sidebar at all. [FOUND
 *   LIVE] the maintainer: "I need to be able to see my active team members... there is not icon next to the
 *   Team title." Fixed the same way `/documents` already fixes the identical shape
 *   (DOCUMENTS_CHILDREN's `doc-documents` row, path === the section's own path, the maintainer 29 Sep 2026) —
 *   a visible first child whose path IS the section's landing page. `scheduling` moves in from
 *   PEOPLE_CHILDREN (above), same request.
 */
const TEAM_CHILDREN = Object.freeze([
  { key: 'roster',      path: '/people/team',         label: 'Team' },
  { key: 'invites',     path: '/people/team/invites', label: 'Invites' },
  { key: 'scheduling',  path: '/people/scheduling',   label: 'Scheduling' },
]);

/**
 * §A5 — Documents. ★★★ the maintainer's ruling, 29 Sep 2026 (the tab/IA reconciliation flagged as deferred
 *   above, now built): ONE list of everything sent (any builder), split by STATE, not by builder —
 *   "Sent" answers "what's out and how did it end", the same question regardless of whether it was
 *   a contract or a form. Templates mirrors it for the library: one list, split by builder, plus
 *   Retired for anything switched off. Building blocks and Settings are unchanged, both now real
 *   sidebar rows instead of one being a button hanging off the Contracts screen.
 * ★ THE OLD ROWS STAY IN THE TREE, `sidebar: false` (the exact mechanism PEOPLE_CHILDREN already
 *   uses for clients/adolescents/parents/leads — navTree()'s own comment). Removing them outright
 *   would 403 every internal consumer that still fetches their list data directly (DocsSend,
 *   DocTemplateEditor, ServiceEditor, PersonForm, ModalAttachAgreement, DocPreview,
 *   DocsFormBuilder, DocsList — eight files, MEASURED by grep, none of them a nav destination).
 *   `sidebar: false` drops them from the rendered tree only; `authoriseSection` still admits the
 *   path, so nothing downstream breaks.
 */
// ★★★ the maintainer, 29 Sep 2026 (Square Contracts rebuild) — THREE TABS, no sub-rows. Square's own vocabulary
//   is ours now: a TEMPLATE is the basis you write once; a "contract" (we say DOCUMENT) is the
//   completed-or-drafted copy sent to one person. Agreements/Forms/Retired are filter CHIPS inside
//   the Templates page now (see DOCUMENTS_LISTS['/documents/templates']), not sidebar rows — same
//   reasoning as Sent's old sub-tabs, taken one step further. Settings leaves the sidebar entirely
//   (a gear icon on the Documents page opens it) per this ruling's own §1.
const DOCUMENTS_CHILDREN = Object.freeze([
  { key: 'doc-documents', path: '/documents',            label: 'Documents' },
  { key: 'doc-templates', path: '/documents/templates',  label: 'Templates' },
  // ★ Square calls these "clauses"; we called them "Building blocks". Same screen, same path
  //   (DocsClauses.jsx unchanged), new label.
  { key: 'doc-clauses',   path: '/documents/clauses',    label: 'Clauses' },

  // ═══ RETIRED SIDEBAR ROWS — kept authorised (data APIs and internal consumers still read them),
  //     hidden from the tree, every one redirected from its old address (sectionPages.js's Redirect
  //     rows) so no bookmark or old link breaks. ═══
  { key: 'doc-settings',  path: '/documents/settings',           label: 'Settings', sidebar: false },
  { key: 'doc-sent',      path: '/documents/sent',               label: 'Sent', sidebar: false, children: [
    { key: 'sent-all',       path: '/documents/sent/all',            label: 'All', sidebar: false },
    { key: 'sent-waiting',    path: '/documents/sent/waiting',        label: 'Waiting', sidebar: false },
    { key: 'sent-signed',     path: '/documents/sent/signed',         label: 'Signed', sidebar: false },
    { key: 'sent-declined',   path: '/documents/sent/declined',       label: 'Declined', sidebar: false },
    { key: 'sent-expired',    path: '/documents/sent/expired',        label: 'Expired', sidebar: false },
  ] },
  // ★ The old Templates sub-tabs — no wrapping parent needed, `/documents/templates` itself is
  //   already the real row above; these four are just the leaf paths every old sub-tab link named.
  { key: 'templates-all',        path: '/documents/templates/all',        label: 'All', sidebar: false },
  { key: 'templates-agreements', path: '/documents/templates/agreements', label: 'Agreements', sidebar: false },
  { key: 'templates-forms',      path: '/documents/templates/forms',      label: 'Forms', sidebar: false },
  { key: 'templates-retired',    path: '/documents/templates/retired',    label: 'Retired', sidebar: false },
  { key: 'doc-pipeline',  path: '/documents/pipeline',           label: 'Pipeline', sidebar: false },
  { key: 'contracts',     path: '/documents/contracts',          label: 'Contracts', sidebar: false, children: [
    { key: 'all-contracts',   path: '/documents/contracts/all',       label: 'All contracts', sidebar: false },
    { key: 'contract-templates', path: '/documents/contracts/templates', label: 'Templates', sidebar: false },
  ] },
  { key: 'forms',         path: '/documents/forms',              label: 'Forms', sidebar: false, children: [
    { key: 'all-forms',       path: '/documents/forms/all',           label: 'All forms', sidebar: false },
    { key: 'form-templates',  path: '/documents/forms/templates',     label: 'Templates', sidebar: false },
  ] },
  { key: 'executed',      path: '/documents/executed',           label: 'Executed', sidebar: false },
]);

/**
 * §A4 — the catalogue. TWELVE children: the original four (matching the four tables in migration
 * 0009) plus the eight Stage 14 added (task 14.74) — categories, modifiers, options, units, images,
 * loyalty, gift-cards, defaults.
 *
 * ★ The previous version of this line read "Four words, four children" and stayed that way while the
 *   array grew. 14.74 was scoped to the array only and flagged it rather than editing outside its
 *   file list — correctly. Corrected here on the main thread, 25 Sep 2026.
 * ★★ `db/gates/p6_all_83_rows.mjs` asserts the WHOLE tree's row count and must move with this array.
 *    MEASURED at that edit: the literal said 91 while the real tree held 92 — an earlier stage had
 *    added a row without updating it — so it is now 100 (92 + 8), the real count, not 91 + 8.
 * ★★★ Task 20.37 — Items regrouped into 4 groups (F17 §1.1): Catalogue, Pricing, Extras, Library.
 *     Three levels: Items section → group rows → leaf rows. "Discounts" label becomes "Coupons".
 */
export const ITEMS_CHILDREN = Object.freeze([
  { key: 'cat-catalogue',  path: '/items/catalogue', label: 'Catalogue', children: [
    { key: 'services',    path: '/items/services',    label: 'Services' },
    { key: 'packages',    path: '/items/packages',    label: 'Packages' },
    { key: 'plans',       path: '/items/plans',       label: 'Plans' },
    { key: 'categories',  path: '/items/categories',  label: 'Categories' },
    // Programs moved to Settings → Programs & client types ('set-programs', /settings/programs, 2 Oct 2026); /items/programs redirects there.
  ] },
  { key: 'cat-pricing',  path: '/items/pricing', label: 'Pricing', children: [
    { key: 'coupons',     path: '/items/coupons',     label: 'Coupons' },
    { key: 'modifiers',   path: '/items/modifiers',   label: 'Modifiers' },
    { key: 'units',       path: '/items/units',       label: 'Units' },
    { key: 'defaults',    path: '/items/defaults',    label: 'Item defaults' },
  ] },
  { key: 'cat-extras',  path: '/items/extras', label: 'Extras', children: [
    { key: 'gift-cards',  path: '/items/gift-cards',  label: 'Gift cards' },
    { key: 'loyalty',     path: '/items/loyalty',     label: 'Loyalty' },
  ] },
  { key: 'cat-library',  path: '/items/library', label: 'Library', children: [
    { key: 'images',      path: '/items/images',      label: 'Image library' },
  ] },
]);

/**
 * §A6 — Engagements · Money · Growth · Tasks.
 * ★★ TWO PLACEMENT RULES LIVE HERE AND BOTH ARE ASSERTED BY A GATE, because both are the kind of
 * thing a later reorganisation "tidies" back to where it feels natural:
 *   · **Booking rules are in ENGAGEMENTS, not Settings** — they change when a coach's
 *     availability changes, which is weekly. §A7's test for Settings is "rarely touched".
 *   · **RUN IS NOT UNDER GROWTH.** It moved to Accounts: Run is work done *for an account*,
 *     not a marketing surface.
 */
export const ENGAGEMENTS_CHILDREN = Object.freeze([
  { key: 'calendar',       path: '/engagements/calendar',  label: 'Calendar' },
  // ★ Stage 20 run 2 — the coach's week on one screen (EngAvailability.frame.html): hours with
  //   breaks, days that are different, time off, limits, and "why isn't a time showing".
  { key: 'availability',   path: '/engagements/availability', label: 'Availability' },
  { key: 'sessions',       path: '/engagements/sessions',  label: 'Sessions' },
  { key: 'waitlist',       path: '/engagements/waitlist',  label: 'Waitlist' },
  { key: 'online-booking', path: '/engagements/booking',   label: 'Online booking' },
  { key: 'booking-channels', path: '/engagements/booking/channels', label: 'Booking channels' },
  // ★ Stage 20 run 2 (0496) — scoped booking links (EngBookingLinks.frame.html). Admin: which pages
  //   exist and what each offers is practice configuration, the same floor the API enforces.
  { key: 'booking-links',  path: '/engagements/booking/links', label: 'Booking links', minRole: 'admin' },
  // ★ Buffers, notice and cancellation policy. Deliberately HERE and not in Settings.
  { key: 'booking-settings', path: '/engagements/booking/settings', label: 'Settings' },
]);

export const MONEY_CHILDREN = Object.freeze([
  { key: 'invoices',      path: '/money/invoices',      label: 'Invoices' },
  { key: 'estimates',     path: '/money/estimates',     label: 'Estimates' },
  // ★ §A4: "one client on one plan. Lives under Money." Plans live in Items; subscriptions here.
  { key: 'subscriptions', path: '/money/subscriptions', label: 'Subscriptions' },
  { key: 'payments',      path: '/money/payments',      label: 'Payments' },
  { key: 'money-account', path: '/money/account',       label: 'Account management' },
  { key: 'credits',       path: '/money/credits',       label: 'Credits' },
  { key: 'payouts',       path: '/money/payouts',       label: 'Payouts' },
  { key: 'disputes',      path: '/money/disputes',      label: 'Disputes' },
  { key: 'payment-links', path: '/money/payment-links', label: 'Payment links' },
  { key: 'payment-methods', path: '/money/payment-methods', label: 'Payment methods' },
  { key: 'virtual-terminal', path: '/money/virtual-terminal', label: 'Virtual terminal' },
  // ★ RUN-2 C1 (26 Sep 2026): /money/readers had a live screen (MoneyReaders.svelte) and no row.
  { key: 'readers',       path: '/money/readers',       label: 'Card readers' },
  { key: 'money-settings', path: '/money/settings',     label: 'Settings', children: [
    { key: 'money-tax', path: '/money/settings/tax', label: 'Tax' },
  ] },
  // ★ Task 12.35 (OQ-12.5) — the `payer-groups` row is REMOVED. Payer groups now live under
  // Accounts (`/accounts/all`, C3.4's own route stays mounted, just no longer nav-reachable here).
]);

/**
 * ★★★ ADDENDUM 5 / A5.1 · P20.2 — THE EIGHT ACCOUNTS SUB-TABS. A **DATA** DEFECT, FIXED IN THE DATA.
 *
 * [MEASURED] `SECTION_CHILDREN` had **no `accounts` key at all**, while §A3 rules eight sub-tabs, each
 * of which is *"BOTH a cross-account view and a tab on the individual account record"*. So the nav has
 * been silently claiming Accounts is a leaf section since it was written.
 *
 * ★★★ AND EVERY PRIOR RESTATEMENT OF THIS LIST SAID "EIGHT" AND NAMED **SEVEN**. [MEASURED
 *     2026-09-12, `BUILD-PATH-3.md:262-263`] the one that kept being dropped is **`All accounts`** —
 *     the cross-account index itself, i.e. the row a person actually lands on. A list that is
 *     self-describing as "eight" and enumerates seven is the kind of error that survives review
 *     precisely because the count reads as the check.
 *
 * ★★ THESE ROWS ARE ❌ UNTIL PHASE 20 AND RENDER `SectionNotBuilt`. They are added so **the nav stops
 *    lying about the architecture**, not so anything looks finished. §A3 rules the render explicitly
 *    (`BUILD-PATH-3.md:267`): *"Not connected renders as an EMPTY ROW, never a hidden tab."* A
 *    renderer that hides an unconnected service is violating §A3 directly, not merely being unhelpful
 *    — the same honesty rule as `SectionNotBuilt` and `CapabilityLocked`, ruled independently here.
 *
 * ★ NO `termKey` ON ANY OF THEM, DELIBERATELY: these are SERVICE names (Search Console, Google Ads,
 *   Analytics, Business Profile) and one English noun. A service's name is not configurable
 *   terminology — renaming "Google Ads" per tenant would make the screen disagree with the vendor.
 * ★★ Adding this key takes the nav from 75 to 83 rows, so **every count in Part B, `knownPaths()` and
 *    the P14.10 order guard must be RE-DERIVED after this lands, not assumed.** That re-derivation is
 *    part of this item, not a follow-up.
 */
const ACCOUNTS_CHILDREN = Object.freeze([
  // ★ Task 12.35 (F03 §4) — admin-only row: a Coach never sees it, and the route refuses anyway.
  { key: 'acc-all',               path: '/accounts/all',               label: 'All accounts', minRole: 'admin' },
  { key: 'acc-search-console',    path: '/accounts/search-console',    label: 'Search Console' },
  { key: 'acc-google-ads',        path: '/accounts/google-ads',        label: 'Google Ads' },
  { key: 'acc-analytics',         path: '/accounts/analytics',         label: 'Analytics' },
  { key: 'acc-business-profile',  path: '/accounts/business-profile',  label: 'Business Profile' },
  { key: 'acc-monitoring',        path: '/accounts/monitoring',        label: 'Monitoring' },
  { key: 'acc-access',            path: '/accounts/access',            label: 'Access' },
  { key: 'acc-reports',           path: '/accounts/reports',           label: 'Reports' },
]);

// ★ Task 12.35 — Network's children: referral partners (12.8's LIST_VIEWS descriptor) and
// releases (task 12.7's dedicated screen).
const NETWORK_CHILDREN = Object.freeze([
  { key: 'net-referrals', path: '/network/referrals', label: 'Referrals' },
  { key: 'net-releases',  path: '/network/releases',  label: 'Releases' },
]);

/**
 * ★★★ Task 20.37 — Run becomes one growth product with six groups (F17 §1.1, Stage 20).
 * Three levels: Run section → group rows → leaf rows. Group rows redirect to first child.
 * Leaf rows from kit2.py SUBS["run"] ordered into groups per F17 §1.1.
 */
const RUN_CHILDREN = Object.freeze([
  { key: 'dashboard',  path: '/run/dashboard', label: 'Dashboard' },
  { key: 'run-presence',  path: '/run/presence', label: 'Presence', children: [
    { key: 'website',        path: '/run/website',       label: 'Website' },
    { key: 'search',         path: '/run/search',        label: 'Search' },
    { key: 'ai-visibility',  path: '/run/ai-visibility', label: 'AI visibility' },
    { key: 'listings',       path: '/run/listings',      label: 'Listings' },
    { key: 'reviews',        path: '/run/reviews',       label: 'Reviews' },
  ] },
  { key: 'run-reach',  path: '/run/reach', label: 'Reach', children: [
    { key: 'social',        path: '/run/social',        label: 'Social' },
    { key: 'ads',           path: '/run/ads',           label: 'Ads' },
    { key: 'campaigns',     path: '/run/campaigns',     label: 'Campaigns' },
    { key: 'landing-pages', path: '/run/pages',        label: 'Landing pages' },
    { key: 'forms-funnels', path: '/run/funnels',      label: 'Forms and funnels' },
  ] },
  { key: 'run-audience',  path: '/run/audience', label: 'Audience', children: [
    { key: 'lists-segments', path: '/run/lists',  label: 'Lists and segments' },
    { key: 'templates',      path: '/run/templates', label: 'Templates' },
  ] },
  { key: 'run-signals',  path: '/run/signals', label: 'Signals', children: [
    { key: 'calls',        path: '/run/calls',       label: 'Calls' },
    { key: 'competitors',  path: '/run/competitors', label: 'Competitors' },
  ] },
  { key: 'connections',  path: '/run/connections', label: 'Connections' },
]);

const TASKS_CHILDREN = Object.freeze([
  { key: 'my-tasks',    path: '/tasks/mine',        label: 'My tasks' },
  { key: 'team-tasks',  path: '/tasks/team',        label: 'Team' },
  { key: 'automations', path: '/tasks/automations', label: 'Automations' },
]);

/**
 * §A6 (extended) — Reports gains children. Task 16.57 (RULED 16.9: a screen with no way to reach it
 * is the same defect as a nav row with nothing behind it). ★ The four `minRole: 'admin'` rows are
 * F11 §4 made mechanical — `Staff: Reports nav shows Sessions + their own Coaches row only;`
 * Money/People(found)/Accountant absent". The two rows with no override inherit `reports`'s own
 * section-level `minRole: 'staff'` (`SECTIONS` above), so a coach sees exactly Sessions and Coaches.
 * ★ The nav is the SECOND layer only — the routes refuse independently (16.30's `user_may` inside
 * each SQL function), and 16.53`s Coaches report returns a coach only their own row. Both layers are`
 * required; this array is only the row half.
 * ★ All paths are added to `BUILT_PATHS` in `src/nav/buildState.mjs` in the same build, each
 * backed by a real GET added in 16.30 (`/api/reports/{money,people,sessions,found,coaches}` via the
 * shared `/api/reports/:name` route, plus the dedicated `/api/reports/receipt` route — all measured
 * present in `src/routes/reports.mjs`). ★ [TY, 2 Oct 2026] The accountant row/route/email/template
 * are removed entirely.
 */
export const REPORTS_CHILDREN = Object.freeze([
  { key: 'rep-money',      path: '/reports/money',      label: 'Money',                minRole: 'admin' },
  { key: 'rep-people',     path: '/reports/people',     label: 'People',               minRole: 'admin' },
  { key: 'rep-sessions',   path: '/reports/sessions',   label: 'Sessions' },
  { key: 'rep-found',      path: '/reports/found',      label: 'How people find you',  minRole: 'admin' },
  { key: `rep-coaches`,    path: `/reports/coaches`,    label: `Coaches` },
  { key: 'rep-receipt',    path: '/reports/receipt',    label: 'What we did this month', minRole: 'admin' },
]);

/**
 * §A7 — Settings. ★ THE TEST IS "SET ONCE, ORG-WIDE, RARELY TOUCHED." Anything failing it belongs
 * on a record or in the section that owns it.
 * ★★ ITEM PRICES ARE NOT HERE — a price is a product decision and lives in Items and services.
 * ★★★ Task 20.37 — Settings regrouped into 5 groups (F17 §1.1): Practice, Clients, Money, Channels, Data.
 *     Three levels: Settings section → group rows → leaf rows. Coach-visible rows stay top-level.
 */
export const SETTINGS_CHILDREN = Object.freeze([
  { key: 'set-practice-grp',  path: '/settings/practice-grp', label: 'Practice', children: [
    { key: 'set-practice',      path: '/settings/practice',      label: 'Practice' },
    { key: 'set-branding',      path: '/settings/branding',      label: 'Branding' },
    { key: 'set-team-roles',    path: '/settings/roles/presets', label: 'Team and roles' },
    { key: 'set-fields-required', path: '/settings/fields-required', label: 'Required fields' },
  ] },
  { key: 'set-clients-grp',  path: '/settings/clients-grp', label: 'Clients', children: [
    { key: 'set-client-app',    path: '/settings/client-app',    label: 'Client app' },
    { key: 'set-documents',     path: '/settings/documents',     label: 'Documents' },
    { key: 'set-notifications', path: '/settings/notifications', label: 'Notifications' },
  ] },
  { key: 'set-money-grp',  path: '/settings/money-grp', label: 'Money', children: [
    { key: 'set-money',         path: '/settings/money',         label: 'Money' },
    { key: 'set-plans',         path: '/settings/plans',         label: 'Plans and billing' },
    // ★ Restored 25 Sep 2026: F17 §1.1's list dropped this row while SetBilling (Stripe billing portal,
    //   close the practice) still renders and Integrations links to it — every visit answered
    //   "refused: unknown_path". Ruled in RUN-2-TRACKER.md.
    { key: 'set-billing',       path: '/settings/billing',       label: 'Billing' },
    { key: 'set-usage',         path: '/settings/usage',         label: 'Usage' },
  ] },
  { key: 'set-channels-grp',  path: '/settings/channels-grp', label: 'Channels', children: [
    { key: 'set-email',         path: '/settings/email',         label: 'Email' },
    { key: 'set-domains',       path: '/settings/domains',       label: 'Domains' },
    { key: 'set-integrations',  path: '/settings/integrations',  label: 'Integrations' },
  ] },
  { key: 'set-data-grp',  path: '/settings/data-grp', label: 'Data', children: [
    { key: 'set-import',        path: '/settings/import',        label: 'Import' },
    // ★ Restored 25 Sep 2026: MOCKUPS.md:30 rules "one audit log, under Data and audit"; F17 §1.1's
    //   list dropped the row while SetData (exports + audit) still renders. Ruled in RUN-2-TRACKER.md.
    { key: 'set-data-audit',    path: '/settings/data',          label: 'Data and audit' },
    { key: 'set-developer',     path: '/settings/developer',     label: 'Developer', children: [
      { key: 'dev-api-keys',  path: '/settings/developer/api-keys',  label: 'API keys' },
      { key: 'dev-webhooks',  path: '/settings/developer/webhooks',  label: 'Webhooks' },
      { key: 'dev-webhook-log', path: '/settings/developer/webhook-log', label: 'Webhook deliveries' },
      { key: 'dev-embeds',    path: '/settings/developer/embeds',    label: 'Embeds' },
      { key: 'dev-audit-log', path: '/settings/developer/audit-log', label: 'Audit log' },
      { key: 'dev-sandbox',   path: '/settings/developer/sandbox',   label: 'Sandbox' },
    ] },
  ] },
  // ★ PART 4.6 [TY, RULED 23 Sep 2026] — the ONE shape control (crm/run/both), `src/nav/groups.mjs`.
  //   Replaces WORKSTREAM 12's per-group toggle list ("What you use"). Not grouped per F17.
  { key: 'set-shape',         path: '/settings/shape',         label: 'Shape' },
  // ★ Role DEFINITIONS and the permission matrix. Not grouped, stays admin-only.
  { key: 'set-roles',         path: '/settings/roles',         label: 'Roles and permissions' },
  // ★ TERMINOLOGY — Not grouped per F17.
  { key: 'set-terminology',   path: '/settings/terminology',   label: 'Terminology' },
  // ★ Programs & client types (QUEUE §4, the maintainer 2 Oct 2026) — programs list + the four client-type words. Admin and up.
  { key: 'set-programs',      path: '/settings/programs',      label: 'Programs & client types', minRole: 'admin' },
  // ★★★ 6.12 — Q6-3 (RULED: staff only): a Coach's own device list is not a settings-wide
  //     permission. This row OVERRIDES the section's `minRole: 'admin'` (`SECTIONS` above) down to
  //     `coach` — `src/nav/authorise.mjs:69`, `minRole: row.minRole ?? section.minRole`, a child
  //     that states its own `minRole` wins. Coach-visible, stays top-level per F17.
  { key: 'set-sign-in',       path: '/settings/sign-in',       label: 'Sign-in and devices', minRole: 'member' },
  // ★★★ Task 17.20 — `set-mine` row, a Coach-visible settings screen for their own profile. Backing
  //     `GET /api/settings/mine` (task 17.20 `src/routes/settings.mjs`); `minRole: 'coach'` same as
  //     `set-sign-in`. Coach-visible, stays top-level per F17.
  { key: 'set-mine',          path: '/settings/mine',          label: 'You', minRole: 'member' },
]);

/**
 * ★★★ Task 17.25 — What's new. Two children: the home screen feed and the activity log.
 */
const WHATS_NEW_CHILDREN = Object.freeze([
  // ★ FIX (25 Sep 2026, run close-out): task 17.25 gave this section a `whats-new-notes` child at
  //   `/whats-new` — the SECTION's own path, making 120 rows but 119 unique paths (18.49 measured
  //   it; the only section/child path collision in the tree). The notes screen IS the section's
  //   landing page, so the child was a duplicate row, not a second screen. One child remains.
  { key: 'whats-new-log',   path: '/whats-new/log', label: 'Activity log' },
]);

/**
 * §A9 — Platform. ★★ NOT permission-hidden inside the tenant app: its OWN route namespace,
 * checked server-side. A tenant admin must not reach it by guessing a URL.
 */
const PLATFORM_CHILDREN = Object.freeze([
  { key: 'pf-overview',     path: '/platform/overview',     label: 'Overview' },
  { key: 'pf-tenants',      path: '/platform/tenants',      label: 'Practices' },
  { key: 'pf-provisioning', path: '/platform/provisioning', label: 'Provisioning' },
  { key: 'pf-usage',        path: '/platform/usage',        label: 'Usage' },
  { key: 'pf-automations',  path: '/platform/automations',  label: 'Automations' },
  { key: 'pf-branding',     path: '/platform/branding',     label: 'Branding' },
  { key: 'pf-flags',        path: '/platform/flags',        label: 'Feature switches' },
  { key: 'pf-tiers',        path: '/platform/tiers',        label: 'Tiers' },
  { key: 'pf-jobs',         path: '/platform/jobs',         label: 'Jobs' },
  { key: 'pf-health',       path: '/platform/health',       label: 'Health' },
  // ★ §A9: "Impersonation is written to the audit log and is visible to the tenant. This is the
  // feature that gets abused if it is not recorded." The audit write is not optional.
  { key: 'pf-impersonation', path: '/platform/impersonation', label: 'Impersonation',
    requiresAuditLog: true },
]);

/** ★ The children, attached to their sections. ONE source — see the file header. */
export const SECTION_CHILDREN = Object.freeze({
  people:      PEOPLE_CHILDREN,
  // ★ the maintainer, 1 Oct 2026 — Team's own section now that it is promoted out of Clients.
  team:        TEAM_CHILDREN,
  // ★ A5.1 / P20.2 — the key that did not exist. See ACCOUNTS_CHILDREN above.
  accounts:    ACCOUNTS_CHILDREN,
  documents:   DOCUMENTS_CHILDREN,
  // ★ Task 12.35 — the key that did not exist. See NETWORK_CHILDREN above.
  network:     NETWORK_CHILDREN,
  items:       ITEMS_CHILDREN,
  engagements: ENGAGEMENTS_CHILDREN,
  money:       MONEY_CHILDREN,
  run:         RUN_CHILDREN,
  tasks:       TASKS_CHILDREN,
  reports:     REPORTS_CHILDREN,
  settings:    SETTINGS_CHILDREN,
  // ★ Task 17.25 — What's new section with two children.
  'whats-new': WHATS_NEW_CHILDREN,
  [PLATFORM_SECTION_KEY]: PLATFORM_CHILDREN,
});

export const isPlatformSection = (key) => key === PLATFORM_SECTION_KEY;

/** Every section with its children attached — the shape a renderer actually wants. */
export function navTree(terms = {}) {
  return resolveSections(terms, SECTIONS).map((s) => ({
    ...s,
    // ★ the maintainer, 29 Sep 2026 — a row marked `sidebar: false` (PEOPLE_CHILDREN's `clients`/`adolescents`/
    //   `parents`/`leads`) is reachable a different way (the in-page tag-filter tabs on
    //   `/people/all`) and is dropped ONLY here, from the tree the SIDEBAR actually renders.
    //   `resolveSections` itself is untouched — a tenant rename still resolves through these rows
    //   (test/p5_nav.test.mjs), and this is the one place that draws the visible nav.
    children: SECTION_CHILDREN[s.key]
      ? resolveSections(terms, SECTION_CHILDREN[s.key]).filter((r) => r.sidebar !== false)
      : undefined,
  }));
}

/**
 * Resolve every label for one tenant. ★ A row with a `termKey` takes its word from the shared
 * vocabulary; a row with a `label` keeps it. A row may not have both — `assertBuckets` enforces it.
 */
export function resolveSections(terms = {}, rows = SECTIONS) {
  return rows.map((row) => {
    const resolved = {
      ...row,
      // ★★★ P14.9a / U30 — `|| ''` IS GONE, AND ITS ABSENCE IS THE FIX.
      //     The old chain was `terms[key] || row.label || ''`. A row may not carry both a
      //     termKey and a label, so for the four termKey rows `row.label` was ALWAYS undefined
      //     and the chain ALWAYS landed on the empty string. [EXECUTED] navTree({}) returned
      //     label:"" for /people/clients, /people/parents, /people/team/admins and
      //     /people/team/coaches — four of the most-used rows in the CRM, BLANK, today.
      //     ★★ This is the CLAUDE.md §2.7 defect class from the opposite direction: there a
      //     missing resolver made i18next ECHO THE KEY, printing a dotted token on screen; here
      //     it ERASES THE LABEL. A printed token announces itself as a bug. A BLANK ROW READS AS
      //     A CSS GLITCH AND GETS "FIXED" IN CSS.
      //     ★ An empty string must not be REACHABLE from this expression at all. A label that
      //       cannot be resolved is a BUILD ERROR (see assertBuckets), never a blank.
      label: row.termKey ? (terms[row.termKey] || row.fallback) : row.label,
    };
    if (row.children) resolved.children = resolveSections(terms, row.children);
    return resolved;
  });
}

/**
 * ★★★ assertBuckets — AND IT DID NOT EXIST UNTIL NOW.
 *
 * [MEAS 2026-09-13] the string `assertBuckets` appeared EXACTLY ONCE in the entire project: in
 * the comment above, asserting that it enforces something. There was no such function anywhere.
 * ★★ BUILD-UI.md inherited the claim from that comment and repeated it three times —
 * "assertBuckets enforces it" (B2.5), "assertBuckets forbids a row carrying both" (ADD2-5), and
 * ADDENDUM 5's "assertBuckets IS THE OBSTACLE AND IT MUST BE RELAXED IN EXACTLY ONE DIRECTION,
 * NOT REMOVED." ★★★ THERE WAS NO OBSTACLE TO RELAX. There was a comment describing a guard
 * nobody had written, and a rule enforced by nothing.
 *
 * It is written here, with BOTH rules — the one that was claimed, and the inverse ADDENDUM 5
 * asks for:
 *
 *   (a) A ROW MAY NOT CARRY BOTH `termKey` AND `label`. Two competing CONFIGURABLE labels is
 *       one source of truth too many — P4.10 measured what that costs when the PIR portal ended
 *       up with the same seven labels in two disagreeing tables.
 *
 *   (b) ★★★ A ROW CARRYING A `termKey` MUST CARRY A `fallback`. This is the rule that makes the
 *       U30 fix permanent rather than momentary. A `fallback` IS NOT A COMPETING LABEL — it is
 *       what the term resolves to when nothing overrides it. ★ Without this assertion the fix
 *       holds exactly until the next termKey row is added, and then the blank returns with
 *       NOTHING TO CATCH IT, because the source will look correct exactly as it does today.
 *
 * ★ It runs AT MODULE LOAD, so a violation is a startup failure, not a rendering surprise.
 */
function assertBuckets(rows = SECTIONS, trail = []) {
  for (const row of rows) {
    const where = [...trail, row.key ?? row.path ?? '(anonymous)'].join(' → ');
    if (row.termKey && row.label) {
      throw new Error(
        `nav row ${where}: carries BOTH a termKey ("${row.termKey}") and a label ("${row.label}"). ` +
        `Only one may be configurable.`);
    }
    if (row.termKey && !row.fallback) {
      throw new Error(
        `nav row ${where}: carries a termKey ("${row.termKey}") and NO fallback. With no terminology ` +
        `store present this row would render an EMPTY LABEL — U30 forbids it. Add an English default.`);
    }
    if (!row.termKey && row.fallback) {
      throw new Error(
        `nav row ${where}: carries a fallback ("${row.fallback}") but no termKey. A fallback is what a ` +
        `TERM resolves to when unset; on a row with a literal label it is a second label.`);
    }
    if (!row.termKey && !row.label) {
      throw new Error(`nav row ${where}: has neither a label nor a termKey — it would render blank.`);
    }
    if (row.children) assertBuckets(row.children, [...trail, row.key ?? row.path]);
  }
  return true;
}

/** Flatten to every leaf, for guards and for route generation. */
export function allRows(rows = SECTIONS) {
  return rows.flatMap((r) => [r, ...(r.children ? allRows(r.children) : [])]);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★★★ RUN AT MODULE LOAD. A rule that is only checked by a test is a rule that holds until
// somebody adds a row without running the tests. Importing this module is enough to enforce it,
// and every entry point in the system imports it.
// ★ Both buckets are checked: SECTIONS carries no `children` key (the children live in a
//   separate frozen object), so walking SECTIONS alone would miss all 62 non-section rows —
//   the same shape-trap as F15's allRows() default argument.
// ═══════════════════════════════════════════════════════════════════════════════════════════
assertBuckets(SECTIONS);
for (const [sectionKey, children] of Object.entries(SECTION_CHILDREN)) {
  assertBuckets(children, [sectionKey]);
}
