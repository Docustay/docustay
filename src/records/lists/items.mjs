// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b / P6.B6 — THE ITEMS SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P6.B6 — THE HAND-WRITTEN PREDICATE HAD ALREADY COST WHAT `_shared.mjs` SAID IT WOULD.
//
//   All three queries below read `WHERE $1::uuid IS NOT NULL` — the fail-closed viewer check
//   copied out of `scoped()` WITHOUT the archive filter that rides with it. `_shared.mjs`'s own
//   header names this exact failure: *"twenty-eight chances to miss one, and the one that is
//   missed is the list where a departed client keeps appearing."*
//
//   [MEASURED 2026-09-15, through the real routes, against a real practice]
//     · POST /api/records/archive {object:"service"} → 200 `{archived:true}`
//     · GET  /api/list/items/services                → the archived service is STILL A ROW,
//                                                      and its Sellable cell reads **"Yes"**.
//     · the same, for `plan`.
//   ★★ THE ARCHIVED ROW DID NOT MERELY LINGER — IT PRESENTED AS SELLABLE. `service` and `plan`
//      are both in `ARCHIVABLE` (src/records/archive.mjs:36-37), so archiving is a supported act
//      with a route, an event topic and a gate; the catalogue simply never honoured it. A
//      practice that retires a service keeps being offered it, at a price, on the screen they
//      price work from.
//   ★ THE FIX IS TO STOP HAND-WRITING IT: `scoped('item', alias)` emits the viewer check AND
//     `alias.archived_at IS NULL`, derived from `ARCHIVABLE` rather than from anybody remembering.
//     `item`'s table is `service` (permissions/ownership.mjs:72) and it is un-ownable — the
//     catalogue is the practice's — so the predicate is the fail-closed one plus the archive
//     filter, which is precisely what these three lists needed and two of them now get.
//
// ★★ `/items/packages` IS THE EXCEPTION AND IT IS A DECLARED ONE, NOT AN OVERSIGHT.
//    [MEASURED] `keystone.package` HAS NO `archived_at` COLUMN and no `OWNERSHIP` entry, so
//    `scoped('item', 'pk')` would emit `pk.archived_at IS NULL` against a column that does not
//    exist and the list would 500. A package is genuinely not archivable today, so the viewer
//    check alone IS the whole correct predicate — but it is written by hand here only because
//    the helper cannot be asked about an object the map does not know. Filed for the main
//    session in `~/example-rebuild/handoffs/p6-items.md`; do not "tidy" it into `scoped()` until
//    `package` is in OWNERSHIP.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { scoped, emptyOf,
} from "./_shared.mjs";

export const ITEMS_LISTS = Object.freeze({
  '/items/services': {
    title: 'Services', recordType: 'service',
    columns: [
      { field: 'name',             label: 'Service',  format: 'text' },
      // ★ CT-F36 — `requires: 'invoice.view'` is the live gate (task 12.17, `src/routes/
      //   index.mjs:1739-1750`): a viewer without the grant gets neither this column nor these two
      //   row keys. No second mechanism here — `moneyFields` was the wrong shape and is not used.
      { field: 'price_amount_minor', label: 'Price',  format: 'money', currency: 'price_currency', requires: 'invoice.view' },
      { field: 'duration_minutes', label: 'Minutes',  format: 'number' },
      { field: 'bookable',         label: 'Bookable', format: 'boolean' },
      { field: 'sellable',         label: 'Sellable', format: 'text' },
      // ★★★ P6.B6 / P7.15 — THE OVERRIDES ARE COUNTED HERE BECAUSE THE SCREEN OFFERS THE CONTROL
      //     THAT MAKES THEM. A "Contracted price" button whose effect is invisible on the screen
      //     that carries it is unverifiable by the person who pressed it — they cannot tell a
      //     success from a silent no-op, which is the "dead control" rule arriving one step later.
      //   ★★ A COUNT, NOT AN AMOUNT. §Z4: an override says "this ONE party pays THIS"; printing
      //      one of them in a catalogue column would make a per-party rate read as the list price.
      { field: 'contracted',       label: 'Contracted rates', format: 'number' },
      { field: 'category_name',   label: 'Category', format: 'text' },
      { field: 'program_name',    label: 'Program',  format: 'text' },
    ],
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ GROUP A REWORK, WORKSTREAM 2, item 2.3 [TY, RULED 22 Sep 2026] — PORTED FROM
    //     `specs/mockups/EmptyServices.frame.html` (re-read fresh, not from a prior summary).
    //     `headline`/`line`/action label are the frame's OWN words verbatim, not a paraphrase.
    //     `starters` is the "start from a common one" template grid — structurally different from
    //     `/people/clients`'s `example`/`rail` ghost table, so it is its own slot (`_shared.mjs`'s
    //     `emptyOf()` and `EmptyState.svelte` both extended to carry it). The frame has NO photo
    //     on this screen (unlike `ListEmpty.frame.html`) — nothing was omitted here.
    //   ★★ MEASURED (same finding as `/people/clients`, `Screen.svelte`'s `newSurface`/`surfaceFor()`):
    //     no write surface reads a query-string param today, so each card's "Add" is a real
    //     navigation to the real create route — not a dead click — but the typed price does not
    //     prefill the form. Wiring actual prefill is real scope of its own, not assumed here.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconTag',
      headline: 'Add what you sell',
      line: 'Services are the sessions, packages and memberships clients book and pay for. Nothing can be booked or invoiced until one exists.',
      // ★ F-catalogue-tabs-1 — CatalogueTabs (W9.1, 27 Sep 2026) wraps Services/Packages/Plans in
      //   one composite screen mounted outside the generic "list" variant, so `Screen.jsx`'s
      //   `openSectionNew`/`query.new` plumbing never reaches it. `?new=1` here was a real link
      //   before that wrap (this comment's own note, 22 Sep) and silently went dead after — the
      //   real, registered create route is the page at `/new` (sectionPages.js), not a query param.
      action: { label: 'Create a service', href: '/items/services/new' },
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TOUCH-UP · WORKSTREAM 6.1 — THE COACH VARIANT, PORTED FROM
      //     `EmptyServicesCoach.frame.html` (read fresh): headline/line are the frame's own words
      //     verbatim. `action: null` is an ENGINEERING CALL, not an omission — the frame's own CTA
      //     ("Let the owner know") is `href="#"`, a dead link even in the frame itself, and this
      //     project's own rule is that a button with no effect is not done (F401). Building a real
      //     notify-the-owner mechanism is out of this item`s scope; a Coach gets the true statement`
      //     and no button, never a fake one. `notice` is the SEPARATE non-empty-list banner
      //     (`ListNoPermission.frame.html``s pattern) — shown once services DO exist, so a Coach`
      //     Browse:ing a populated catalogue still sees why there is no "Add"/"Edit" here.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      noWrite: {
        headline: 'No services yet',
        line: "The practice owner adds the services you can book. Once they do, they'll show here.",
        action: null,
        notice: 'You can view services. Adding or editing them is done by the practice owner or an admin.',
      },
    }),
    sql: `
      SELECT s.id, s.name, s.duration_minutes, s.bookable, s.active, s.program_id,
             (SELECT cp.amount_minor FROM keystone.current_price('service', s.id) cp) AS price_amount_minor,
             (SELECT cp.currency     FROM keystone.current_price('service', s.id) cp) AS price_currency,
             (SELECT count(*) FROM keystone.contracted_price x
               WHERE x.subject_type = 'service' AND x.subject_id = s.id
                 AND x.effective_to IS NULL)                                AS contracted,
             CASE
               WHEN NOT s.active THEN 'No — definition inactive'
               WHEN NOT EXISTS (SELECT 1 FROM keystone.current_price('service', s.id))
                    THEN 'No — no live price'
               ELSE 'Yes' END AS sellable,
             -- 14.22 — category, status and this-year bookings (0409/0410's new columns).
             sc.name AS category_name,
             -- ★ Programs follow-up (Part 5) — program_id/keystone.program are additive (0543,
             --   pending); this LEFT JOIN returns NULL for every row until that migration applies
             --   and the row is backfilled or re-pointed, same as category_name already does for an
             --   uncategorised service.
             pr.name AS program_name,
             CASE
               WHEN s.archived_at IS NOT NULL THEN 'Archived'
               -- F91: "Stop selling" writes active (setItemActive), not bookable, so a stopped service reads as Hidden here.
               WHEN NOT s.active THEN 'Hidden'
               WHEN s.addon_only THEN 'Add-on only'
               WHEN NOT s.bookable THEN 'Hidden'
               ELSE 'Available' END AS status,
             (SELECT count(*) FROM keystone.booking b
               WHERE b.service_id = s.id AND b.starts_at >= date_trunc('year', now())) AS booked_this_year
        FROM keystone.service s
        LEFT JOIN keystone.service_category sc ON sc.tenant_id = s.tenant_id AND sc.id = s.category_id
        LEFT JOIN keystone.program pr ON pr.tenant_id = s.tenant_id AND pr.id = s.program_id
       WHERE ${scoped('item', 's')}
       ORDER BY s.name, s.id`,
  },
  '/items/packages': {
    title: 'Packages',
    // ★★★ FIX, 30 Sep 2026 ("New package button is hidden" brief) — MEASURED: this view named
    //   neither `recordType` nor `permissionObject`, so it never opted into the `emptyState.noWrite`
    //   mechanism (src/routes/index.mjs's own comment: "OPT-IN: only the descriptors that name
    //   `emptyState.noWrite` pay for the extra round trip"). `canWrite` therefore stayed `null` for
    //   EVERY viewer, including the Owner — `PackagesList.jsx` gates its "New package" button and
    //   every row action on `canWrite === true`, which `null` never satisfies. `permissionObject:
    //   'item'` matches the real write routes (`src/routes/itemsCatalogue.mjs` grants packages under
    //   `object: "item"`, never a `'package'` object — there is no such key in OWNERSHIP at all, so
    //   naming `recordType: 'package'` here instead would have thrown at the permission check).
    permissionObject: 'item',
    columns: [
      { field: 'name',          label: 'Package',  format: 'text' },
      { field: 'price_amount_minor', label: 'Price', format: 'money', currency: 'price_currency' },
      { field: 'contents',      label: 'Contents', format: 'text' },
      { field: 'program_name',  label: 'Program',  format: 'text' },
      // ★★★ P6.B6 — `sellable` WAS ON SERVICES AND PLANS AND NOT HERE, AND A PACKAGE IS SOLD.
      //     Without it an unpriced package rendered `—` in the Price column and nothing else: a
      //     blank that is indistinguishable from a zero, a null and a bug (B2.5), on the one
      //     question the screen exists to answer. The conjunction is the SAME conjunction — the
      //     definition is active AND a price row covers now() — and it names which half failed.
      { field: 'sellable',      label: 'Sellable', format: 'text' },
    ],
    // ★ §A4: a Package is services BUNDLED and sold as one item. `contents` is the bundle — a
    //   package list that does not say what is in the package is a price with no product.
    // ★ NO `validity_days` COLUMN ANY MORE. MOCKUPS §0:35 (C2), migration 0264: packages never
    //   expire — the field this list used to show ("Valid for (days)") is retired, not hidden.
    // ★★ `active` IS NOT A COLUMN OF ITS OWN ANY MORE: it is one of the two halves of `sellable`,
    //    and printing it twice invites the reader to believe a `true` there means saleable.
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconPackage',
      headline: 'No packages yet',
      line: 'Several sessions sold together at a better rate.',
      // ★ F-catalogue-tabs-1 — see the note on '/items/services' above: `?new=1` is dead on any of
      //   the three CatalogueTabs paths. The real create route is `/new`.
      action: { label: 'Add package', href: '/items/packages/new' },
      blockedAction: { label: 'Add service', href: '/items/services/new' },
      blockedLine: 'A package is built from services, and none of yours has an active price yet.',
      // ★ FIX, 30 Sep 2026 — same shape as '/items/services'/'/items/coupons' above.
      noWrite: {
        headline: 'No packages yet',
        line: "The practice owner adds packages. Once they do, they'll show here.",
        action: null,
        notice: 'You can view packages. Adding or editing them is done by the practice owner or an admin.',
      },
    }),
    sql: `
      SELECT pk.id, pk.name, pk.active, pk.program_id,
             (SELECT cp.amount_minor FROM keystone.current_price('package', pk.id) cp) AS price_amount_minor,
             (SELECT cp.currency     FROM keystone.current_price('package', pk.id) cp) AS price_currency,
             (SELECT string_agg(pl.quantity || ' × ' || s.name, ', ' ORDER BY s.name)
                FROM keystone.package_line pl
                JOIN keystone.service s ON s.id = pl.service_id
               WHERE pl.package_id = pk.id) AS contents,
             pr.name AS program_name,
             -- Programs follow-up brief Part 9 — package gets archived_at (migration 0544), so
             -- this can finally distinguish "archived" from "turned off" the same way the
             -- services list's own status column already does.
             pk.archived_at IS NOT NULL AS archived,
             CASE
               WHEN NOT pk.active THEN 'No — definition inactive'
               WHEN NOT EXISTS (SELECT 1 FROM keystone.current_price('package', pk.id))
                    THEN 'No — no live price'
               ELSE 'Yes' END AS sellable
        FROM keystone.package pk
        LEFT JOIN keystone.program pr ON pr.tenant_id = pk.tenant_id AND pr.id = pk.program_id
       -- ★★ NOT scoped() — see the file header. The viewer check alone is the whole correct
       --    predicate; package has no OWNERSHIP-scoped column to add to it.
       WHERE $1::uuid IS NOT NULL
       ORDER BY pk.name, pk.id`,
  },
  '/items/plans': {
    title: 'Plans', recordType: 'plan',
    // ★★★ FIX, 30 Sep 2026 ("New package button is hidden" brief — SAME BUG, ALSO FOUND HERE) —
    //   `recordType: 'plan'` alone did not opt this view into `emptyState.noWrite` either: 'plan' is
    //   not a key in OWNERSHIP (src/permissions/ownership.mjs) at all, so
    //   `permissionObjectFor(view.recordType ?? view.permissionObject)` would have THROWN the moment
    //   noWrite was added naively (the exact "RUN-2 C3" failure already recorded for '/items/coupons'
    //   — a view with no matching OWNERSHIP entry 500ing the whole list). `permissionObject: 'item'`
    //   is the actual grant the write routes check (`src/routes/itemsCatalogue.mjs`); the server-side
    //   check (index.mjs) now prefers an explicit `permissionObject` over `recordType`, so this line
    //   and Packages' both resolve correctly without disturbing `recordType`'s OTHER job (routing a
    //   row to its record page).
    permissionObject: 'item',
    columns: [
      { field: 'name',     label: 'Plan',     format: 'text' },
      { field: 'price_amount_minor', label: 'Price', format: 'money', currency: 'price_currency' },
      { field: 'interval', label: 'Interval', format: 'enum' },
      { field: 'sellable', label: 'Sellable', format: 'text' },
      { field: 'live_subscriptions', label: 'Subscribers', format: 'number' },
      { field: 'program_name', label: 'Program', format: 'text' },
    ],
    // ★★★ U13 — A PLAN IS THE RECURRING PRICE DEFINITION. A SUBSCRIPTION IS ONE CLIENT ON ONE
    //     PLAN AND LIVES UNDER MONEY. §A4 keeps the words apart deliberately "so the two never
    //     read as the same page", and P15.7's CI rule refuses routing both paths to one component.
    //     ★ Showing the subscriber COUNT here is the honest link between them — it is a number
    //       about this plan, not a subscription list wearing a plan's heading.
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconRepeat',
      headline: 'No plans yet',
      line: 'Bills on a repeating interval instead of per session.',
      // ★ F-catalogue-tabs-1 — see the note on '/items/services' above.
      action: { label: 'Add plan', href: '/items/plans/new' },
      blockedAction: { label: 'Add service', href: '/items/services/new' },
      // F92: the old line claimed no service had a price — the list never checks that (this `blocked` kind is static) and a plan carries its own price. The one real dependency: sessions a plan includes are sessions OF a service.
      blockedLine: 'A plan has its own repeating price. If it includes sessions, they are sessions of a service, so have a service ready first.',
      // ★ FIX, 30 Sep 2026 — same shape as '/items/services'/'/items/coupons' above.
      noWrite: {
        headline: 'No plans yet',
        line: "The practice owner adds plans. Once they do, they'll show here.",
        action: null,
        notice: 'You can view plans. Adding or editing them is done by the practice owner or an admin.',
      },
    }),
    sql: `
      SELECT p.id, p.name, p.interval, p.active, p.program_id,
             (SELECT cp.amount_minor FROM keystone.current_price('plan', p.id) cp) AS price_amount_minor,
             (SELECT cp.currency     FROM keystone.current_price('plan', p.id) cp) AS price_currency,
             (SELECT count(*) FROM keystone.subscription_effective s
               WHERE s.plan_id = p.id AND s.state <> 'cancelled') AS live_subscriptions,
             pr.name AS program_name,
             p.archived_at IS NOT NULL AS archived,
             CASE
               WHEN NOT p.active THEN 'No — definition inactive'
               WHEN NOT EXISTS (SELECT 1 FROM keystone.current_price('plan', p.id))
                    THEN 'No — no live price'
               ELSE 'Yes' END AS sellable
        FROM keystone.plan p
        LEFT JOIN keystone.program pr ON pr.tenant_id = p.tenant_id AND pr.id = p.program_id
       WHERE ${scoped('item', 'p')}
       ORDER BY p.name, p.id`,
  },

  // ══ `/items/coupons` ═════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 20.30 — COUPONS AND THEIR PROMOTION CODES. Migration 0476 (`db/migrations/
  // 0476_coupon_and_promotion_code.sql`) split the one-code-per-discount assumption into
  // `keystone.coupon` (the rule) and `keystone.promotion_code` (what someone types, 1+ per coupon).
  // This descriptor is the list server, paired with `CouponsPage.svelte`'s fetch on line 74.
  // ★ NESTED CODES — A correlated subquery builds each coupon row's `codes` array of
  //   `{id, code, active, redemption_count}` objects. Every code is returned, even when empty.
  // ★ EMPTY STATES — Coach (no-write) reaches here with `viewData.emptyState` already chosen
  //   server-side; the screen never re-derives one. First-run and filtered-to-nothing are both
  //   built from emptyOf().
  '/items/coupons': {
    title: 'Coupons', recordType: null,
    // ★ RUN-2 C3 — no record page, so no recordType; the noWrite check still needs the permission
    //   object, and `scoped('discount', …)` below emits no user_may() to read it from.
    permissionObject: 'discount',
    columns: [
      { field: 'name',       label: 'Coupon',     format: 'text' },
      { field: 'codes_count', label: 'Codes',     format: 'number' },
      { field: 'active',     label: 'Active',     format: 'boolean' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconDiscount2',
      headline: 'Add your first coupon',
      line: 'A coupon is the rule. Codes are what customers type to redeem it.',
      action: { label: 'New coupon', href: '/items/coupons?new=1' },
      noWrite: {
        headline: 'No coupons yet',
        line: 'The practice owner creates coupons and codes. Once they do, they\'ll show here.',
        action: null,
        notice: 'You can view coupons. Creating or editing them is done by the practice owner or an admin.',
      },
    }),
    sql: `
      SELECT c.id, c.name, c.active,
             (SELECT count(*) FROM keystone.promotion_code pc
               WHERE pc.coupon_id = c.id) AS codes_count,
             (SELECT json_agg(json_build_object(
                'id', pc.id,
                'code', pc.code,
                'active', pc.active,
                'redemption_count', 0
              ) ORDER BY pc.created_at)
                FROM keystone.promotion_code pc
               WHERE pc.coupon_id = c.id) AS codes
        FROM keystone.coupon c
       WHERE ${scoped('discount', 'c')}
       ORDER BY c.name, c.id`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 14.22 — THE SIX NEW ITEM LISTS. `service_category`, `unit`, `image`, `modifier` and
  //     `gift_card` (0409/0408/0411/0415) have NO `OWNERSHIP` ENTRY — `ownerExpr()` THROWS for an
  //     object it does not know (`ownership.mjs:220`), so `scoped()` cannot be called for any of
  //     them. Each is practice-wide, like `/items/packages` (this file's own header, `:34-40`), so
  //     each is the SAME hand-written un-ownable idiom: `$1::uuid IS NOT NULL`, fail-closed on the
  //     viewer and consuming `$1` so every one of the 35 views keeps the same parameter arity.
  //     `/items/options` reuses `keystone.custom_field WHERE record_type = 'engagement'` (14.5) —
  //     not a new table.
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  // ══ `/items/categories` ═══════════════════════════════════════════════════════════════════
  '/items/categories': {
    title: 'Categories',
    columns: [
      { field: 'name',             label: 'Category',            format: 'text' },
      { field: 'service_count',    label: "What's in it",        format: 'number' },
      { field: 'on_booking_page',  label: 'On the booking page', format: 'text' },
      { field: 'booked_this_year', label: 'Booked this year',    format: 'number' },
    ],
    // ★ Empty sentence VERBATIM (field 4): headline "No groups yet", line the rest.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconFolder',
      headline: 'No groups yet',
      line: 'Categories become the headings on your booking page. One is plenty to start.',
      action: { label: 'New category', href: '/items/categories?new=1' },
    }),
    sql: `
      SELECT sc.id, sc.name,
             (SELECT count(*) FROM keystone.service s
               WHERE s.category_id = sc.id AND s.archived_at IS NULL) AS service_count,
             CASE sc.visibility
               WHEN 'first'  THEN 'Shown first'
               WHEN 'shown'  THEN 'Shown'
               WHEN 'hidden' THEN 'Hidden — sold alongside, never on its own'
               WHEN 'last'   THEN 'Shown last'
             END AS on_booking_page,
             (SELECT count(*) FROM keystone.booking b
                JOIN keystone.service s2 ON s2.tenant_id = b.tenant_id AND s2.id = b.service_id
               WHERE s2.category_id = sc.id
                 AND b.starts_at >= date_trunc('year', now())) AS booked_this_year
        FROM keystone.service_category sc
       WHERE $1::uuid IS NOT NULL
       ORDER BY sc.position, sc.name, sc.id`,
  },

  // ══ `/items/modifiers` ════════════════════════════════════════════════════════════════════
  '/items/modifiers': {
    title: 'Modifiers',
    columns: [
      { field: 'name',       label: 'Name',        format: 'text' },
      { field: 'effect',     label: 'What it does', format: 'text' },
      { field: 'applies_to', label: 'Applies to',   format: 'text' },
      { field: 'used_count', label: 'Used',         format: 'number' },
      { field: 'active',     label: 'Active',       format: 'boolean' },
    ],
    // ★ Frame's own subtitle (`ItemsModifiers.frame.html`) as the empty `line`, verbatim.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconAdjustments',
      headline: 'Add your first modifier',
      line: 'Things that change a service without being a different service.',
      action: { label: 'New modifier', href: '/items/modifiers?new=1' },
    }),
    sql: `
      SELECT m.id, m.name, m.active,
             CASE
               WHEN m.price_delta_minor IS NOT NULL AND m.minutes_delta IS NOT NULL THEN
                 (CASE WHEN m.price_delta_minor >= 0 THEN '+$' ELSE '-$' END) ||
                 trim(trailing '0' from trim(trailing '.' from (abs(m.price_delta_minor) / 100.0)::text)) ||
                 ' and ' || (CASE WHEN m.minutes_delta >= 0 THEN '+' ELSE '' END) || m.minutes_delta || ' min'
               WHEN m.price_delta_minor IS NOT NULL THEN
                 (CASE WHEN m.price_delta_minor >= 0 THEN '+$' ELSE '-$' END) ||
                 trim(trailing '0' from trim(trailing '.' from (abs(m.price_delta_minor) / 100.0)::text))
               WHEN m.minutes_delta IS NOT NULL THEN
                 (CASE WHEN m.minutes_delta >= 0 THEN '+' ELSE '' END) || m.minutes_delta || ' min'
               ELSE ''
             END AS effect,
             CASE m.applies
               WHEN 'all'        THEN 'All services'
               WHEN 'one_to_one' THEN 'All 1:1 services'
               WHEN 'list'       THEN (SELECT count(*) FROM keystone.modifier_service ms
                                         WHERE ms.modifier_id = m.id)::text || ' services'
             END AS applies_to,
             (SELECT count(*) FROM keystone.line_item li WHERE li.modifier_id = m.id) AS used_count
        FROM keystone.modifier m
       WHERE $1::uuid IS NOT NULL
       ORDER BY m.name, m.id`,
  },

  // ══ `/items/options` — reuses `keystone.custom_field WHERE record_type = 'engagement'` (14.5) ══
  '/items/options': {
    title: 'Options',
    columns: [
      { field: 'label',         label: 'Question',      format: 'text' },
      { field: 'kind',          label: 'Type',          format: 'enum' },
      { field: 'required',      label: 'Required',      format: 'boolean' },
      { field: 'applies_to',    label: 'Applies to',    format: 'text' },
      { field: 'feeds_reports', label: 'Feeds reports', format: 'boolean' },
      { field: 'active',        label: 'Active',        format: 'boolean' },
    ],
    // ★ Frame's own subtitle (`ItemsOptions.frame.html`) as the empty `line`, verbatim.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconListCheck',
      headline: 'Add your first option',
      line: 'Choices that change nothing about the price. You just need to know.',
      action: { label: 'New option', href: '/items/options?new=1' },
    }),
    sql: `
      SELECT cf.id, cf.label, cf.kind, cf.required, cf.feeds_reports, cf.active,
             CASE WHEN cf.applies_to_service_ids IS NULL OR cardinality(cf.applies_to_service_ids) = 0
                  THEN 'All services'
                  ELSE cardinality(cf.applies_to_service_ids)::text || ' services' END AS applies_to
        FROM keystone.custom_field cf
       WHERE cf.record_type = 'engagement' AND $1::uuid IS NOT NULL
       ORDER BY cf.position, cf.id`,
  },

  // ══ `/items/units` ════════════════════════════════════════════════════════════════════════
  '/items/units': {
    title: 'Units',
    columns: [
      { field: 'name',         label: 'Unit',    format: 'text' },
      { field: 'plural',       label: 'Plural',  format: 'text' },
      { field: 'in_use_count', label: 'In use',  format: 'number' },
      { field: 'is_default',   label: 'Default', format: 'boolean' },
      { field: 'active',       label: 'Active',  format: 'boolean' },
    ],
    // ★ Frame's own subtitle (`ItemsUnits.frame.html`) as the empty `line`, verbatim.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconRuler2',
      headline: 'Add your first unit',
      line: 'What you sell things by.',
      action: { label: 'New unit', href: '/items/units?new=1' },
    }),
    sql: `
      SELECT u.id, u.name, u.plural, u.is_default, u.active,
             (SELECT count(*) FROM keystone.service s WHERE s.unit_id = u.id) AS in_use_count
        FROM keystone.unit u
       WHERE $1::uuid IS NOT NULL
       ORDER BY u.name, u.id`,
  },

  // ══ `/items/images` ═══════════════════════════════════════════════════════════════════════
  '/items/images': {
    title: 'Images',
    columns: [
      { field: 'name',         label: 'Image',    format: 'text' },
      { field: 'used_count',   label: 'Used',     format: 'number' },
      { field: 'content_type', label: 'Type',     format: 'text' },
      { field: 'bytes',        label: 'Size',     format: 'number' },
      { field: 'created_at',   label: 'Uploaded', format: 'date' },
    ],
    // ★ Empty sentence VERBATIM (field 4): headline "No images yet", line the rest.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconPhoto',
      headline: 'No images yet',
      line: "Drop images here. They'll be everywhere you can use one — services, your booking page, posts.",
      action: { label: 'Upload', href: '/items/images?new=1' },
    }),
    sql: `
      SELECT im.id, im.name, im.content_type, im.bytes, im.created_at,
             ( (SELECT count(*) FROM keystone.service s WHERE s.image_id = im.id)
             + (SELECT count(*) FROM keystone.package p WHERE p.image_id = im.id) ) AS used_count
        FROM keystone.image im
       WHERE $1::uuid IS NOT NULL
       ORDER BY im.created_at DESC, im.id`,
  },

  // ══ `/items/gift-cards` ═══════════════════════════════════════════════════════════════════
  // ★★★ NOT the fail-closed viewer idiom the other five above use. `gift_card.manage` is a NAMED
  //     ACTION (`assertMay.mjs`'s NAMED branch, `:147-157`) — this WHERE is that branch's own SQL
  //     (`:148-155`, MEASURED) copied verbatim, with the action inlined as a literal because this
  //     is a static list query rather than a parameterised `assertMay()` call — so a Coach with no
  //     `gift_card.manage` grant gets an EMPTY list server-side, not one merely hidden by the
  //     screen. Money columns (`issued_minor`/`remaining_minor`, "bought"/"left") carry
  //     `requires: 'invoice.view'`, the same CT-F36 gate as every other money column in this file.
  '/items/gift-cards': {
    title: 'Gift cards',
    columns: [
      { field: 'number',          label: 'Number',     format: 'text' },
      { field: 'holder',          label: 'Who has it', format: 'text' },
      { field: 'issued_minor',    label: 'Bought for',  format: 'money', currency: 'currency', requires: 'invoice.view' },
      { field: 'remaining_minor', label: 'Left',        format: 'money', currency: 'currency', requires: 'invoice.view' },
      { field: 'created_at',      label: 'When',       format: 'date' },
      { field: 'state',           label: 'State',      format: 'enum' },
    ],
    // ★ Empty sentence VERBATIM (field 4): headline "No cards sold yet", line the rest.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconGift',
      headline: 'No cards sold yet',
      line: 'put the link on your site and in your email footer.',
      action: { label: 'Issue a gift card', href: '/items/gift-cards?new=1' },
    }),
    sql: `
      SELECT gc.id,
             'GC-' || lpad(gc.number::text, 4, '0') AS number,
             COALESCE(hu.display_name, gc.holder_email, 'Not yet claimed') AS holder,
             gc.issued_minor, gc.currency,
             COALESCE((SELECT sum(e.delta_minor) FROM keystone.gift_card_entry e
                        WHERE e.gift_card_id = gc.id), 0) AS remaining_minor,
             gc.created_at,
             CASE
               WHEN gc.voided_at IS NOT NULL THEN 'Voided'
               WHEN COALESCE((SELECT sum(e.delta_minor) FROM keystone.gift_card_entry e
                               WHERE e.gift_card_id = gc.id), 0) = 0 THEN 'Used up'
               WHEN gc.opened_at IS NULL THEN 'Never opened'
               WHEN COALESCE((SELECT sum(e.delta_minor) FROM keystone.gift_card_entry e
                               WHERE e.gift_card_id = gc.id), 0) = gc.issued_minor THEN 'Unused'
               ELSE 'Half used'
             END AS state
        FROM keystone.gift_card gc
        LEFT JOIN keystone.app_user hu ON hu.tenant_id = gc.tenant_id AND hu.id = gc.holder_user_id
       WHERE EXISTS (
         SELECT 1
           FROM keystone.user_role ur
           JOIN keystone.role_action ra
             ON ra.role_id = ur.role_id AND ra.tenant_id = ur.tenant_id
          WHERE ur.user_id = $1 AND ra.action = 'gift_card.manage')
       ORDER BY gc.created_at DESC, gc.id`,
  },
});
