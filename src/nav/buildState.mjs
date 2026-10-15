// P14.11 / B2.3 — WHICH NAV ROWS HAVE SOMETHING BEHIND THEM.
//
// ★★★ WHY THIS IS A SEPARATE FILE AND NOT A FLAG IN sections.mjs.
// B2.3: "the nav is data, so the RENDERER reads a build-state flag per row — EDITING sections.mjs
// TO HIDE UNBUILT ROWS WOULD DESTROY THE RULED §A1 INFORMATION ARCHITECTURE TO SOLVE A RENDERING
// PROBLEM." `sections.mjs` says what the product IS. This file says what is FINISHED. They change
// on completely different schedules and for completely different reasons, and merging them would
// mean a shipping decision could silently alter the architecture.
//
// ★★ AND THE HONESTY RULE, WHICH IS THE POINT: a row with nothing behind it renders
// `SectionNotBuilt`, BY NAME. Never a dead link, never quietly deleted. Same rule as
// `CapabilityLocked` (U23) and as §A3's ruling for the Accounts sub-tabs — "Not connected renders
// as an EMPTY ROW, NEVER A HIDDEN TAB."
// ★ A shell that draws all 75 rows as live links ships 23 dead links on day one, and a dead link
//   is indistinguishable from a bug.
//
// ★★★ A MEASURED CORRECTION TO PART B'S OWN PROSE. B2.3 and P14.11 both say "NINETEEN of 75 rows
// are ❌". [MEAS 2026-09-13, by parsing Part B's 75-row table programmatically rather than by eye]
// THE COUNT IS **23**: ⚠️ 47 · ❌ 23 · ✅ 5. The set below is derived from that parse, not
// transcribed — a hand-copied list of 23 paths is a second source of truth that drifts.
// ★ (The ✅ count of 5 is consistent with B2.2's "exactly four have a real read path": the fifth
//   is `/platform/health`, which B2.2 itself flags as "✅ as a module and F2 as behaviour".)

// ★★★ D-17.5 — THIS LIST HAD ALREADY DRIFTED, EXACTLY AS THIS FILE'S OWN HEADER WARNED.
// [MEAS 2026-09-13] It was a hand-written array of FIVE paths. `LIST_VIEWS` (src/records/lists.mjs:64)
// holds **29** entries, every one a real `SELECT` built and gate-proven in PHASE 15 — and NONE of
// the five overlaps it. So `stateFor()` was returning `no_read_path` with the words *"the table
// exists; the read query is PHASE 15"* for **24 rows whose PHASE 15 read query was already
// shipped**, and the sidebar was telling the user that a working screen did not exist yet.
// ★★ The header above says it in advance: *"a hand-copied list of 23 paths is a second source of
//    truth that drifts."* It drifted within one phase of being written. The fix is therefore NOT a
//    longer hand-written list — it is to stop hand-writing it.
// ★ DERIVED, IN BOTH HALVES: the 29 come from LIST_VIEWS by key, and the 5 are the routes that
//   predate it and are named here because they genuinely are a separate mechanism (their own
//   handlers at routes/index.mjs:186-231, not LIST_VIEWS descriptors). Adding a 30th list view now
//   updates the sidebar with no edit here.
// ★★ `lists.mjs` has ZERO imports [MEAS], so this file stays pure data and the browser bundle can
//    still import it. That property is load-bearing — see the note on /api/nav.
import { LIST_VIEWS } from "../records/lists.mjs";
// ★ `knownPaths()` is the independent cross-check on the nav's size — the same one P14.10 uses.
//   authorise.mjs imports only sections.mjs, so this file stays pure and browser-bundleable.
import { knownPaths } from "./authorise.mjs";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P6.0 / `F110` — THIS LIST WAS WRONG IN BOTH DIRECTIONS, AND IT IS NOW ENFORCED, NOT TRUSTED.
//
//   THREE ROWS WITH LIVE READ ROUTES WERE DRAWN DEAD:
//     · `/settings/documents`            GET /api/settings/documents      — said `no_read_path`
//     · `/settings/developer/api-keys`   GET /api/developer/api-keys      — said `not_built`, and
//       `Sidebar.jsx` **preventDefault()s the click over a working API** (P0.4 is why that matters)
//     · `/settings/developer/audit-log`  GET /api/developer/audit-log     — said `no_read_path`
//   AND ONE ROW WITH NO ROUTE AT ALL WAS DRAWN LIVE:
//     · `/platform/health` — there is no `/api/platform/health`. Only `/healthz` and `/readyz`
//       exist; both are PRE-AUTH and excluded from the SPA fallback, so they are not this row.
//
// ★★★ AND THE TOTALS AGREED BY COINCIDENCE — an independent pass also counted BUILT 35, because the
//     two sets differ by exactly ONE SWAP. **A probe that checks only the total confirms itself.**
//
// ★★ WHY THIS IS STILL DATA AND NOT AN IMPORT OF THE ROUTER. Deriving it here would mean importing
//    `createApp`, and `src/http/app.mjs → src/routes/index.mjs → this file` is already an import
//    chain — so the "derivation" would be a CYCLE. ★★★ The anti-drift property is therefore supplied
//    by `db/gates/p6_build_state_map.mjs`, which enumerates `app.routes` AT RUNTIME and fails on any
//    divergence in EITHER direction. The list cannot drift silently; that was the whole defect.
// ★ The NAV spells the Developer rows `/settings/developer/*` and the SERVER spells them
//   `/api/developer/*`. That alias is declared in the gate, once.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const DEDICATED_READ_ROUTES = Object.freeze([
  // ★ /home is GET /api/home — HOME_TILES (lists.mjs:492), a count and a destination per tile.
  //   It was absent from the old five and so reported "no read path" on the landing screen itself.
  "/home",
  "/settings/notifications",
  // ★★★ Task 17.2 — `GET /api/settings/fields-required` (src/routes/settings.mjs), backing the
  //     `set-fields-required` nav row added in this stage.
  "/settings/fields-required",
  "/settings/integrations",
  "/settings/documents",              // ★ P6.0 — GET /api/settings/documents + DocumentAxes.jsx + 2 writes
  "/settings/developer/api-keys",     // ★ P6.0 — GET + POST + POST /:id/revoke, all live
  "/settings/developer/audit-log",    // ★ P6.0 — GET /api/developer/audit-log
  // ★★★ F688 — the PARENT row. Its 3 already-`built` children (this one, `audit-log` above, and
  //     `/settings/developer/sandbox` further down this same list) made it look reachable, but the
  //     parent itself fell through `stateFor`'s default `no_read_path` — `GET /api/settings/
  //     developer` (`src/routes/developer.mjs`) is its first landing.
  "/settings/developer",
  // ★★★ P6.B12 — EIGHT SETTINGS ROWS, each with a live GET measured over a real socket and a
  //     mounted, DOM-asserted screen. `/settings/practice` is the row `HelpAction` and `AvatarMenu`
  //     both link to (`F234`), so it was a locked door behind two chrome controls.
  //   ★★ `/settings/billing` and `/settings/developer/sandbox` are the two worth a second thought,
  //      and both belong here: **a row that REFUSES IN WORDS WITH ITS REAL REASON is built.** That
  //      is the standard's own wording. Neither is "not built" — both are "blocked on something
  //      that is not code" (a merchant-of-record decision; a second data instance), and
  //      `SectionNotBuilt` cannot say that for them.
  "/settings/practice",
  "/settings/branding",
  "/settings/roles",
  // ★★★ Task 1.3 — TeamRoles, the plain-language presets screen. `GET /api/settings/roles/presets`
  //     (`src/routes/settings.mjs`, shares `loadRolesView` with `/settings/roles`) went in the SAME
  //     build as this row and `TeamRolesScreen.svelte` — the same discipline every other row in this
  //     list is annotated with: the route lands, THEN the row.
  "/settings/roles/presets",
  "/settings/client-app",
  "/settings/money",
  "/settings/billing",
  // ★★★ Task 6.5 / 06-settings.md §11 — new row, added the same build as its route
  //     (`GET /api/settings/plans`, `src/routes/settings.mjs`) and its nav entry
  //     (`src/nav/sections.mjs`'s `set-plans`), never landed ahead of either.
  "/settings/plans",
  // ★★★ Task 17.18 — `GET /api/settings/usage` (src/routes/settings.mjs), backing the
  //     `set-usage` nav row added in this stage.
  "/settings/usage",
  // ★★★ Task 6.4 / 06-settings.md §2.5, §11 — new row, added the same build as its route
  //     (`GET /api/settings/import`, `src/routes/settings.mjs`) and its nav entry
  //     (`src/nav/sections.mjs`'s `set-import`), never landed ahead of either.
  "/settings/import",
  // ★★★ Task 6.4 / 06-settings.md §2.6 — `set-data-audit`'s own row (`src/nav/sections.mjs`) has
  //     existed since before this task with NO route behind it (measured: absent from every list
  //     here and from `NOT_BUILT` below, so it read as `no_read_path`). `GET /api/settings/data`
  //     (`src/routes/settings.mjs`) is that route's first landing — moved here only now that it
  //     exists, same discipline as every other row in this list.
  "/settings/data",
  "/settings/terminology",            // ★ see the NOT_BUILT note — this is a RECORDED REVERSAL
  "/settings/developer/sandbox",
  "/settings/sign-in",                // ★ 6.12 — GET /api/settings/sign-in, every staff rank's own devices
  // ★★★ Task 17.20 — `GET /api/settings/mine` (src/routes/settings.mjs), backing the `set-mine`
  //     nav row added in this stage.
  "/settings/mine",
  // ★★★ A11.2 / F428 — `/tasks/automations` WAS `{cut: true}` with the reason *"Tenants get the
  //     automations we built, switched on or off"*. That sentence described a screen nobody had
  //     built; `GET /api/tasks/automations` (`src/routes/settings.mjs`) now serves it and
  //     `AutomationsPage.svelte` draws it. ★ The row moved only AFTER the route existed — the same
  //     discipline `/platform/health` is annotated with above.
  "/tasks/automations",
  // ★★★ A11.2 / F427+F428 — `GET /api/settings/email` and `POST /api/settings/email/routing` both
  //     exist now. Listed only because BOTH do: until this session the page existed and neither
  //     route did, which is the state this list is supposed to make impossible.
  "/settings/email",
  // ★ Stage 18 (18.11, 18.16) — route-backed
  "/platform/overview",
  "/platform/usage",
  "/platform/tenants",
  "/platform/provisioning",
  // ★ P6.82 — `GET /api/platform/health` (`src/routes/platform.mjs`) now exists, so the row is
  //   genuinely route-backed. It was `built` with NO route before P6.0 caught it, then `not_built`
  //   while the route did not exist, and is `built` again now that it does — for the first time
  //   truthfully. Each move was made only after the ROUTER was measured, never to match the label.
  "/platform/health",
  // ★★ `/platform/health` DELIBERATELY ABSENT — see the header. It moved to NOT_BUILT.
  // ★★★ Task 9.13 — `GET /api/platform/flags` (`src/routes/platform.mjs`) now exists, and
  //     `PlatFlags.svelte` reads it, so this row is genuinely route-backed. Moved here from
  //     NOT_BUILT below, the same discipline `/platform/health` (P6.82, above) was moved with: only
  //     after the ROUTE was measured, never to match a label. `db/gates/p6_platform_rows_say_why.mjs`
  //     is 9.13's "what not to touch" (field 5) and is NOT edited by this task — its own hardcoded
  //     `honest.cut === true` assertion (line 79) will need updating in a follow-up once this row is
  //     no longer cut; flagged for step 3/4 rather than fixed here.
  "/platform/flags",
  // ★★★ Task 12.35 — three dedicated screens with their own GETs, mounted the same build.
  //     `/people/archived` and `/network/referrals` are NOT here: they are built by their
  //     LIST_VIEWS descriptors instead (tasks 12.17, 12.8) and so are covered via `BUILT` below.
  "/people/scheduling",       // ★ GET /api/people/scheduling (src/routes/scheduling.mjs, task 12.3)
  "/network/releases",        // ★ dedicated screen (task 12.7); no live GET yet — see 12.36's own
                               //   `() => Promise.resolve({})` data source for this row.
  "/accounts/all",            // ★ GET /api/staff/payer-groups (src/routes/payerGroups.mjs, C3.4) —
                               //   moved here from a LIST_VIEWS descriptor, which this task removes.
  // ★★★ Task 16.57 — Reports' children, each backed by a real GET added in 16.30
  //     (`src/routes/reports.mjs`, MEASURED). Five share the generic `GET /api/reports/:name`
  //     route (money/people/sessions/found/coaches — `reportNames` there); `receipt` has its own
  //     dedicated GET. The row moves only because the route exists — same discipline as every
  //     other entry in this list. ★ [TY, 2 Oct 2026] `/reports/accountant` removed entirely.
  "/reports/money",
  "/reports/people",
  "/reports/sessions",
  "/reports/found",
  `/reports/coaches`,
  "/reports/receipt",
  // ★★★ Task 17.25 — What's new section: two screens backing the home feed and the activity log.
  //     Both routes already exist as of the routes task (`GET /api/whats-new` in src/routes/index.mjs).
  "/whats-new",
  "/whats-new/log",
  // ★★★ RUN-2 C3 (26 Sep 2026) — nine rows the P6.0 gate measured WITH a live `GET /api<path>` and
  //     a mounted screen, still drawn `no_read_path` ("the data is stored but this screen cannot
  //     read it yet") — a working screen the sidebar called unbuilt. Each renderer was confirmed in
  //     Screen.svelte / sectionPages.js / PlatformScreen before it was listed.
  "/engagements/waitlist",
  "/items/defaults",
  "/items/loyalty",
  "/money/estimates",
  "/money/payouts",
  "/money/disputes",
  "/settings",
  "/platform/automations",
  "/platform/branding",
]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ RUN-2 C3 (26 Sep 2026) — ROWS WHOSE SCREEN READS A ROUTE NOT NAMED AFTER THE ROW.
//   The P6.0 gate decided "route-backed" by looking for `GET /api<path>` literally. A screen that
//   fetches its own data from a differently-named route (a Stripe component session, the templates
//   API, another section's list view) could never satisfy that — so it was either drawn dead, or
//   listed above with no route the gate could see and drawn live UNCHECKED. This map DECLARES the
//   route each such screen actually calls, and the gate checks every declared route EXISTS in the
//   live route table (or, for `list:<path>`, in LIST_VIEWS). A typo, or a route that is removed,
//   turns the gate red — the declaration is data the gate verifies, not a claim it trusts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const SCREEN_READS = Object.freeze({
  "/accounts/all":        "GET /api/staff/payer-groups",
  "/network/releases":    "list:/documents/contracts/all",
  "/whats-new/log":       "GET /api/whats-new",
  "/money/account":       "GET /api/money/account",
  "/money/settings/tax":  "GET /api/money/tax",
  "/run/pages":           "list:/growth/pages",
  "/run/templates":       "GET /api/growth/templates",
  "/run/campaigns":       "list:/growth/campaigns",
  "/run/lists":           "list:/growth/lists",
});

/** Rows with a table AND a read path in src/. ★ DERIVED — never transcribed. */
export const BUILT = Object.freeze([
  ...DEDICATED_READ_ROUTES,
  ...Object.keys(LIST_VIEWS),
  ...Object.keys(SCREEN_READS),
]);

/**
 * Rows with NO table at all. Each renders SectionNotBuilt, named, with the reason and the phase
 * that delivers it — so the screen answers "when", not merely "not yet".
 * ★ `cut` means it is never coming. Part G: "explicitly out of scope, written down so it is not
 *   discovered later." A CUT row must not say "coming soon".
 */
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SIX ENTRIES WERE REMOVED FROM `NOT_BUILT` BY P6.B12, AND TWO OF THEM WERE A LIVE DEFECT.
//
//   ★★ `COUNTS` SUMMED TO **85 OVER AN 83-ROW NAV**. [MEASURED] built 54 + notBuilt 17 +
//      noReadPath 14 = 85, because `/settings/developer/webhooks` and `/settings/developer/embeds`
//      were in BOTH `BUILT` (derived, they now have LIST_VIEWS descriptors) and `NOT_BUILT`.
//      **This is exactly the defect P6.0 caught when COUNTS summed to 84** — `stateFor` prefers
//      BUILT and says nothing, while COUNTS counts the row twice and explains it never.
//
//   ★ The other four were WRONG EXPLANATIONS rather than broken screens, which is the more
//     expensive kind: somebody reads "no store yet" and spends a day building a store that exists.
//       · /settings/money            — the store exists and is writable through POST /api/settings
//       · /settings/developer        — all five children are served, AND it is a redirect header,
//                                      so it never renders; no other redirecting header was listed
//       · /settings/developer/sandbox— served; the screen refuses creation with the real boundary
//       · /settings/terminology      — see the reversal below
//
//   ★★★ `/settings/terminology` IS A RECORDED REVERSAL, NOT A QUIET EDIT. It was
//        `{cut: true, reason: "the terminology STORE is out of scope (Part G)"}` — and P1.5 BUILT
//        the store anyway: `terminology.overrides` is a catalogued key with a closed validator and
//        `resolveTerms()` reads it. §OPEN-QUESTIONS Q6 anticipates this and rules the default —
//        build the screen and RECORD the reversal, rather than leave two documents contradicting
//        each other. ★★ A row whose stated reason for being cut is a thing that was subsequently
//        built is the same class of defect as the three reasons corrected on 2026-09-14.
//     ★ AND THE SAFETY PROPERTY IS STRUCTURAL, NOT A CONVENTION. The sibling project deleted its
//       terminology layer because i18next ECHOES THE KEY ON A MISS — a miss printed a dotted token
//       on screen. Keystone's resolver cannot do that: `sections.mjs` resolves
//       `terms[key] || fallback`, where the fallback is the English word carried on the row itself.
//       `db/gates/p1_terminology.mjs` asserts it. **KEEP THAT ASSERTION.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const NOT_BUILT = Object.freeze({
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ `missingTable` IS THE MACHINE-CHECKABLE CLAIM. `reason` IS WHAT A PERSON READS. TWO FIELDS,
//     ON PURPOSE, AND THE SPLIT WAS FORCED BY A GATE CATCHING A MISTAKE.
//
// These four reasons used to read *"no invite table until ADDENDUM 4 A4.7"*. U3.3 rewrote them into
// plain English because **build-tracker jargon in the product is the clearest possible signal that
// nobody looked at the screen** — `ADDENDUM 4 A4.7` means nothing to a coach.
//
// ★★★ AND THAT REWRITE SILENTLY DISARMED `p21_not_built_reasons_true.mjs`, WHICH PARSED THE PHRASE
//     "no <x> table" OUT OF THE ENGLISH and checked the catalog to see whether that table had since
//     been built. With the phrase gone the gate matched nothing and said so: *"either the wording
//     convention changed or the parser broke; either way this gate is no longer checking anything."*
//   ★★ **THE GATE WAS RIGHT AND THE FIX WAS NOT TO RESTORE THE JARGON.** A user-facing sentence and
//      a falsifiable assertion are two different jobs, and they were being done by one string — so
//      improving either one broke the other. ★ Now the sentence is free to be good prose and the
//      claim is free to be exact, and the gate reads the field instead of the paragraph.
//   ★★★ IT IS STRICTLY STRONGER THAN WHAT IT REPLACED: a typo in prose no longer silently drops a
//       row out of the check, because the check no longer depends on prose at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Task 8.15 — `/people/team/invites` IS GONE FROM HERE, AND THAT IS THE POINT OF THE ITEM.
  //     `keystone.invite` (8.1), `resendInvite`/`revokeInvite` (8.6/8.14b) and the new descriptor in
  //     `src/records/lists/people.mjs` mean this row is genuinely served now — a served row declared
  //     here too would break `db/gates/p6_all_83_rows.mjs` §5's BUILT/served identity, exactly the
  //     way `/platform/flags`'s own removal (task 9.13, immediately above) did for the same reason.
  // ★★★ Task 13.27b — "/engagements/waitlist" REMOVED FROM HERE, AND THAT IS THE POINT OF THE ITEM.
  //     `registerWaitlistRoutes` is now mounted (`GET /api/engagements/waitlist`, `src/http/
  //     app.mjs`), so this row would break `db/gates/p6_all_83_rows.mjs` §5's BUILT/served identity
  //     the same way `/people/team/invites`'s own removal above did for the same reason. The F689
  //     correction this comment used to carry (missingTable's real name) no longer applies to
  //     anything — the row it described is gone.
  // ★★★ Task 2.5 (02-items.md §11) — "/items/discounts" LEFT `NOT_BUILT`: it has a LIST_VIEWS
  //     descriptor now (`src/records/lists/items.mjs`), so `BUILT` derives it, same discipline as
  //     `/growth/campaigns`/`/tasks/mine`/`/reports` below. The migration (0265, task 2.1) built
  //     `keystone.coupon` (renamed from discount in task 20.7); this is the read-path half that makes the row genuinely served.
  "/growth":                         { phase: "20",  reason: "Growth is cut down to segments and campaigns" },
  // ★★★ CORRECTED 2026-09-14. These three used to read "no campaign table until ADDENDUM 4 A4.6"
  //     and "no task table until ADDENDUM 4 A4.4". BOTH TABLES NOW EXIST — `campaign` and
  //     `segment` were built by P20.11, `task` by P20.3 — and I MEASURED all three in the DEPLOYED
  //     catalog before changing a word. A reason string is the answer the product gives to "why
  //     can I not do this yet", and these three were pointing whoever read them at ADDENDUM 4 work
  //     that is already finished. Same defect class as the 409 that named an email nobody held:
  //     not a broken screen, a WRONG EXPLANATION, which costs someone a day before they discover
  //     it was never true.
  // ★ THE STATE IS UNCHANGED AND THAT IS DELIBERATE — `not_built` is still correct, because no
  //   read path exists for any of them (MEASURED: no entry in records/lists.mjs or queries.mjs).
  //   The table existing makes the row BUILDABLE, not built. Changing the state to match the
  //   corrected reason would be exactly the "weaken it until it passes" move that is banned.
  // ★ P6.B9 — "/growth/campaigns" left NOT_BUILT: it has a LIST_VIEWS descriptor now, so
  //   `BUILT` derives it. The reason string it carried said exactly what was missing
  //   ("no read path/list descriptor is written yet") and this is that descriptor.
  // ★ P6.B9 — "/growth/lists" left NOT_BUILT: it has a LIST_VIEWS descriptor now, so
  //   `BUILT` derives it. The reason string it carried said exactly what was missing
  //   ("no read path/list descriptor is written yet") and this is that descriptor.
  "/growth/funnels":                 { cut: true,    reason: "CUT (Part G). The Astro sites do this; rebuilding Listmonk one ruling after cutting Listmonk would be the wrong lesson learned twice" },
  // ★★★ RUN-2 C3 (26 Sep 2026) — "/growth/pages" REMOVED FROM HERE. It was `cut` ("Landing pages are
  //     the Astro sites' job", Part G) while Stage 20 (F17 §1.1) built its LIST_VIEWS descriptor, five
  //     write routes, LandingPages.svelte and a Run › Reach "Landing pages" nav row — so the row sat
  //     in BUILT and NOT_BUILT at once (P6.0 §5 red). Ruling: the later build governs; recorded in
  //     specs/stage-20/RUN-2-TRACKER.md with what it costs if wrong.
  "/tasks":                          { phase: "20",  reason: "a task is what an event chain leaves behind; six of nine topics do not exist yet (P20.3a)" },
  // ★ P6.B10 — "/tasks/mine" left NOT_BUILT: it has a LIST_VIEWS descriptor now, so
  //   `BUILT` derives it. The reason string it carried said exactly what was missing
  //   ("no read path/list descriptor is written yet") and this is that descriptor.
  // ★ P6.B10 — "/tasks/team" left NOT_BUILT: it has a LIST_VIEWS descriptor now, so
  //   `BUILT` derives it. The reason string it carried said exactly what was missing
  //   ("no read path/list descriptor is written yet") and this is that descriptor.
  // ★ P6.B11 — "/reports" left NOT_BUILT: the four `security_invoker` views have existed
  //   since 0059/0060 and now have a descriptor, so `BUILT` derives it.
  // ★★★ P6.0 — `/settings/developer/api-keys` REMOVED FROM HERE. It is route-backed (GET + POST +
  //     POST /:id/revoke, all live) and is now in DEDICATED_READ_ROUTES. Leaving it in BOTH made
  //     `COUNTS` sum to 84 over an 83-row nav — the double-count that proves the two sets must
  //     be DISJOINT, which the P6.0 gate now asserts.
  // ★★★ P6.82 — `/platform/health` IS GONE FROM HERE, AND THAT IS THE POINT OF THE ITEM.
  //     P6.0 moved it IN because it was marked `built` with no route behind it. P6.82 built the
  //     route (`GET /api/platform/health`, `src/routes/platform.mjs`), so it is route-backed now and
  //     `BUILT` derives it automatically. ★★ Leaving it here as well would put one row in BOTH sets —
  //     `stateFor` prefers BUILT and says nothing, while `COUNTS` counts it twice. That is exactly
  //     the defect the P6.0 gate caught when `COUNTS` summed to 84 over an 83-row nav.
  // ★★★ Task 9.13 — `/platform/flags` IS GONE FROM HERE, AND THAT IS THE POINT OF THE ITEM. It was
  //     `cut` with reason "No table" (0213 made that literally false — see 0213's own header
  //     comment); this task built the table's seed data, the route and the screen, so it moved to
  //     DEDICATED_READ_ROUTES above and `stateFor` now derives `built` for it automatically.
  "/platform/impersonation":         { cut: true,    reason: "OUT OF SCOPE (Part G). No mechanism — and §A9 requires audit-log writing AND tenant visibility BEFORE it may exist at all" },
});

/**
 * Rows whose table exists but whose READ QUERY does not. [MEAS] 47 of 75.
 * ★★ These are NOT SectionNotBuilt — the distinction matters. "There is no such feature" and
 *    "the feature exists and this screen is not written yet" are different promises, and
 *    collapsing them is how a plan stops describing reality.
 */
export function stateFor(path) {
  if (BUILT.includes(path)) return { state: "built" };
  const nb = NOT_BUILT[path];
  if (nb) return { state: nb.cut ? "cut" : "not_built", ...nb };
  // ★★★ RUN-2 C3 (26 Sep 2026) — the default used to say "The data is stored but this screen cannot
  //     read it yet." for EVERY unlisted row, measured for none of them (the /run/* rows have no
  //     table behind most of them). A default may only say what is true of every row it covers.
  return { state: "no_read_path", phase: "15", reason: "This screen isn't built yet." };
}

// ★★★ COUNTS IS NOW COMPUTED, NOT DECLARED — for the same reason BUILT is.
// It was `{ built: 5, notBuilt: 23, noReadPath: 47, total: 75 }`, four literals that could each
// disagree with the data they describe. `notBuilt` was right and `built`/`noReadPath` were wrong by
// 29 rows, and nothing caught it because nothing asserted them.
// ★★ `total` is derived from the NAV ITSELF rather than written as 75, so P20.2 — which adds the
//    eight missing Accounts sub-tab rows and takes the nav to 83 — cannot leave a stale 75 here.
//    [MEAS] knownPaths().length === 75 today; the assertion that these three sum to it lives in
//    the P14 gate and is stricter than what it replaced, per Part F.
const _all = knownPaths();
export const COUNTS = Object.freeze({
  built: _all.filter((p) => BUILT.includes(p)).length,
  notBuilt: _all.filter((p) => p in NOT_BUILT).length,
  noReadPath: _all.filter((p) => !BUILT.includes(p) && !(p in NOT_BUILT)).length,
  total: _all.length,
});
