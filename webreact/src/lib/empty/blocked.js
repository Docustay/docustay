// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S2.3 — THE BLOCKED-DEPENDENCY RESOLVER. **ONE TRUTH, TWO SURFACES.**
//
// ★★★ TWELVE OF THE 45 LIST SCREENS ARE `BLOCKED` AND ELEVEN TRACE TO ONE ROOT — a service with a
//     price. A blocked screen's primary action **POINTS AT ITS BLOCKER, NOT AT ITSELF**: an empty
//     invoices screen with an "Add invoice" button that cannot work is worse than no button. *"It
//     is a dead end that teaches the user the product is broken."*
//
// ★★★ AND THE RULING IS EXPLICIT ABOUT WHERE THE ANSWER COMES FROM: *"WIRE IT TO THE SAME SOURCE
//     THE ONBOARDING CHECKLIST ALREADY USES — 'services priced is true when an active price row
//     exists'. One truth, two surfaces. **Do not compute 'is this blocked' twice.**"*
//   So this module computes NOTHING about the world. It reads `checklist.rows` out of
//   `GET /api/capabilities` — the response the setup meter in the sidebar is already holding — and
//   maps a path to the root it depends on. The COUNTS are the server's; the CHAIN is here.
//   ★★ That is the only division that survives contact: a count is a fact about the database and
//      belongs beside the query; a dependency is a fact about the product and belongs beside the
//      screens. Putting the chain in SQL would mean editing a query to add a screen.
//
// ★ ONE FETCH, TWO CONSUMERS. The shell already calls `/api/capabilities` for `SetupBar`. Nothing
//   here adds a request — a second read of the same route would be a second chance to disagree.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ THE FOUR ROOTS, MEASURED FROM THE SPEC'S OWN CHAIN:
 *
 *   A SERVICE WITH A PRICE ──┬── packages, plans          (items)
 *                            ├── bookable services        (engagements/booking/settings)
 *                            ├── invoices                 (money)
 *                            └── subscriptions            (via plans)
 *   COACH HOURS ──────────────── online booking
 *   A TEMPLATE ───────────────── contracts, forms, pipeline, executed
 *   A CONNECTED PROPERTY ─────── the four Build Wire Run screens
 *
 * ★ The keys are `REAL_STATE_ROWS` keys from `src/provisioning/onboardingChecklist.mjs`. If one is
 *   renamed there, `unresolvedRoots()` below reports it rather than silently marking every screen
 *   unblocked — which is the failure mode that matters, because "not blocked" is the permissive
 *   answer and would quietly restore all twelve dead-end buttons.
 */
export const BLOCKED_BY = Object.freeze({
  // ── the root of the whole product: you cannot book, invoice or sell without one ──────────────
  "/items/packages":                 "servicesPriced",
  "/items/plans":                    "servicesPriced",
  "/engagements/booking/settings":   "servicesPriced",
  "/money/invoices":                 "servicesPriced",
  "/money/subscriptions":            "plansCreated",
  "/growth/campaigns":               "listsCreated",

  // ── a template ───────────────────────────────────────────────────────────────────────────────
  // ★★ THE FOUR SCREENS DOWNSTREAM OF A TEMPLATE. Nothing can be SENT until one exists, and an
  //    instance is a COPY of a template — so these four go empty for want of one.
  "/documents/pipeline":             "templatesCreated",
  "/documents/contracts/all":        "templatesCreated",
  "/documents/forms/all":            "templatesCreated",
  "/documents/executed":             "templatesCreated",

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE FOUR BUILD-WIRE-RUN SCREENS BLOCK ON **AN ACCOUNT**, NOT ON A CONNECTED PROPERTY —
  //     AND THE SPEC HAS THIS WRONG. REGISTERED AS F371.
  //
  //   PLATFORM-EMPTY-STATE-SPEC gives all four `Primary: Connect` and traces them to "A CONNECTED
  //   PROPERTY". [MEASURED from the descriptors themselves] they are lists over `keystone.account`
  //   LEFT JOINed to grants, and their own `empty` text says so in terms:
  //     *"Every account is listed here whether or not it has connected — connecting is what changes
  //      the Connection column, NOT whether the row exists — so this list is empty only while the
  //      practice has no accounts at all."*
  //
  // ★★★ SO A "Connect" BUTTON HERE WOULD BE THE EXACT DEFECT THE SPEC IS WRITTEN AGAINST, ARRIVING
  //     THROUGH THE SPEC. A practice with three accounts and no grants sees THREE ROWS, so the
  //     blocked copy never renders for them; a practice with zero accounts sees the empty state and
  //     is told to connect a property it has nowhere to connect to. **Both readings are wrong and
  //     the button is a dead end in the only case it is ever shown.**
  //
  // ★★ `propertiesConnected` IS STILL A CHECKLIST ROW AND SHOULD BE — a practice with accounts but
  //    no grants genuinely cannot get search, ads or analytics data, and the meter should say so.
  //    It simply has no BLOCKED SCREEN pointing at it, because no screen goes empty for want of it.
  //    ★ A root with no consumers is fine; a consumer pointed at the wrong root is not.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  "/accounts/search-console":        "accountsAdded",
  "/accounts/google-ads":            "accountsAdded",
  "/accounts/analytics":             "accountsAdded",
  "/accounts/business-profile":      "accountsAdded",
  "/accounts/monitoring":            "accountsAdded",
  "/accounts/access":                "accountsAdded",
});

/**
 * ★★ TWO SCREENS CHANGE THEIR ACTION WITH THE DATA, and they are listed separately because they are
 *    NOT simply blocked: `/items/packages` and `/items/plans` send you to Services when none exist
 *    and CREATE when they do. *"One screen, two states, measurable from the data."* The descriptor
 *    carries both actions; this decides which is live.
 */
export const SWITCHES_ACTION = Object.freeze(["/items/packages", "/items/plans"]);

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THE ROOT SCREENS. **A SCREEN THAT IS THE BLOCKER IS NEVER `blocked` — IT IS `first-run`.**
 *     REGISTERED AS F372, BECAUSE THE SPEC MARKS FOUR OF THESE `BLOCKED` AND THAT READING INVERTS
 *     WHAT THE KIND MEANS.
 *
 *   PLATFORM-EMPTY-STATE-SPEC marks `/items/services`, `/documents/contracts/templates`,
 *   `/documents/forms/templates` and `/engagements/booking` as BLOCKED. Read closely, its notes
 *   describe what each screen **BLOCKS** — *"nothing can be sent until a template exists"*,
 *   *`clients cannot book until a coach has hours`* — not what blocks IT. Nothing blocks them:
 *   they are where the missing thing is CREATED.
 *
 * ★★★ AND THE DIFFERENCE IS NOT ACADEMIC, IT IS THE BUTTON. `blocked` renders an action pointing
 *     AWAY, at the blocker. On a root screen that would point at itself — *"Add a service"* on the
 *     services screen — which is a loop, or worse, at the wrong place entirely. `first-run` renders
 *     the CREATE action, which is the one thing these four screens exist to offer.
 *   ★★ The emphatic line stays. `/items/services` genuinely is the root of the whole product and
 *      should say so: *"Nothing can be booked or invoiced until one exists."* That is a sentence,
 *      not a kind.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const ROOT_SCREENS = Object.freeze([
  "/items/services",
  "/documents/contracts/templates",
  "/documents/forms/templates",
  "/engagements/booking",
  "/growth/lists",
  "/accounts",
  "/accounts/all",
]);

/**
 * Build a resolver from the `/api/capabilities` response.
 *
 * @param checklist  `data.checklist` — `{ rows: [{ diagnostics: { key, count }, status }] }`
 * @returns {(path: string) => boolean}  true when the screen's precondition is NOT met
 */
export function blockedResolver(checklist) {
  // ★★★ THE COUNTS COME OUT OF `diagnostics`, WHICH EXISTS FOR EXACTLY THIS. The checklist's own
  //     comment: *"THE COUNT IS THE DIAGNOSTIC, and it is the whole point: '0 active price rows' is
  //     a fact a support engineer can act on, where 'setup incomplete' is not."* It is also the only
  //     field that carries the number rather than a rendering of it.
  const counts = new Map();
  for (const row of checklist?.rows ?? []) {
    const d = row?.diagnostics;
    if (d?.source === "real_state" && typeof d.count === "number") counts.set(d.key, d.count);
  }

  return (path) => {
    const root = BLOCKED_BY[path];
    if (!root) return false;
    const n = counts.get(root);
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ **UNKNOWN IS NOT UNBLOCKED.** If the checklist has not loaded, or the route did not
    //     supply this root, `n` is `undefined` — and answering `false` would put an "Add invoice"
    //     button on a screen that cannot raise one, which is the precise dead end this module
    //     exists to prevent.
    //   ★★ IT ANSWERS `false` ANYWAY, AND THE REASON IS THAT THE OTHER FAILURE IS WORSE. Answering
    //      `true` on an unknown would tell a fully-configured practice that its invoices are
    //      blocked and send it to Services it has already priced — a confident lie on a working
    //      product, shown on every screen, every time the capabilities call is slow or refused.
    //      ★ A client principal is REFUSED `/api/capabilities` by `crmScoped`, so "unknown" is a
    //        NORMAL state for a real role, not only a failure. Blocking on it would break them.
    //   ★★★ SO THE CALLER MUST NOT RENDER AN EMPTY STATE UNTIL THE CHECKLIST HAS RESOLVED — the
    //       screen's `loading` phase covers it, and that is where the distinction belongs. Stated
    //       here because the defaulting is invisible at the call site.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (typeof n !== "number") return false;
    return n === 0;
  };
}

/**
 * ★★★ THE PAIRED POSITIVE, AND IT IS NOT OPTIONAL. A chain keyed on strings that no longer exist
 *     resolves every screen to "not blocked" — the permissive answer — and silently restores all
 *     twelve dead-end buttons with no error anywhere.
 *   ★★ A "must not" with no paired "must" passes when everything is broken. This is the must:
 *      every root named above has to appear in the checklist the server actually sent.
 *
 * @returns the root keys this chain names that the checklist did NOT supply. Empty is correct.
 */
export function unresolvedRoots(checklist) {
  const have = new Set(
    (checklist?.rows ?? [])
      .map((r) => r?.diagnostics)
      .filter((d) => d?.source === "real_state")
      .map((d) => d.key));
  return [...new Set(Object.values(BLOCKED_BY))].filter((k) => !have.has(k)).sort();
}
