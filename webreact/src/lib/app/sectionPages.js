// webui/src/lib/app/sectionPages.js — Stage 11 task 11.21 (CT-F49).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE GENERIC PAGE HOOK — one shared, ordered table maps a URL PATTERN to a section-barrel
// component, so a stage that adds twenty-five screens adds twenty-five ROWS instead of twenty-five
// `{:else if}` branches in `Screen.svelte`, a file eight builders share.
//
// ★ EMPTY IN STAGE 11 BY DESIGN. Stage 14's task 14.75 adds the items and documents rows; no other
//   stage adds rows without adding itself to this file's owner list.
//
// ★ IMPORTS NOTHING. That is deliberate — it is what keeps `db/gates/wiring.mjs`'s orphan ratchet
//   honest and this module trivially loadable from a bare `node -e` check.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const SECTION_PAGES = Object.freeze([
  // ─── Stage 14 task 14.75 — items rows ─────────────────────────────────────────────────────
  { pattern: "/items/services", section: "items", component: "CatalogueTabs" },
  { pattern: "/items/packages", section: "items", component: "CatalogueTabs" },
  { pattern: "/items/plans", section: "items", component: "CatalogueTabs" },
  { pattern: "/items/services/new", section: "items", component: "ServiceEditor" },
  { pattern: "/items/services/:id", section: "items", component: "ServiceEditor" },
  { pattern: "/items/packages/new", section: "items", component: "PackageEditor" },
  { pattern: "/items/packages/:id", section: "items", component: "PackageEditor" },
  { pattern: "/items/plans/new", section: "items", component: "PlanEditor" },
  { pattern: "/items/plans/:id", section: "items", component: "PlanEditor" },
  // F97: discounts ARE coupons in this product ("A coupon is the rule") — the old discount addresses redirect to the coupon screens; there is no DiscountEditor.
  { pattern: "/items/discounts", section: "items", component: "Redirect" },
  { pattern: "/items/discounts/new", section: "items", component: "Redirect" },
  { pattern: "/items/discounts/:id", section: "items", component: "Redirect" },
  { pattern: "/items/categories", section: "items", component: "CategoriesPage" },
  // ★ Programs follow-up brief (30 Sep 2026, Parts 1/3) — mirrors categories' own two-row shape.
  // 2 Oct 2026 — the list moved to Settings → Programs & client types; the old address redirects (the record page below stays).
  { pattern: "/items/programs", section: "items", component: "Redirect" },
  // the old Booking links tab: its pages are Custom pages now (23 Oct 2026); it reuses the shared Redirect screen
  { pattern: "/engagements/booking/links", section: "engagements", component: "Redirect" },
  { pattern: "/settings/booking-link", section: "settings", component: "Redirect" },
  { pattern: "/items/programs/:id", section: "items", component: "ProgramRecord" },
  { pattern: "/items/modifiers", section: "items", component: "ModifiersPage" },
  { pattern: "/items/options", section: "items", component: "OptionsPage" },
  { pattern: "/items/units", section: "items", component: "UnitsPage" },
  { pattern: "/items/images", section: "items", component: "ImageLibraryPage" },
  { pattern: "/items/loyalty", section: "items", component: "LoyaltyPage" },
  { pattern: "/items/gift-cards", section: "items", component: "GiftCardsPage" },
  { pattern: "/items/defaults", section: "items", component: "ItemsDefaultsPage" },
  // ★★★ RUN-2 C3 (26 Sep 2026) — screens that were built, exported from their barrel and rendered
  //     by NOTHING (their nav rows drew "not built" or the generic list). Every API they call was
  //     checked against the live route table first (scratchpad all_routes.txt). A screen whose API
  //     does not exist (CampaignGroupList's GET list, FormBuilder's /api/custom-fields) is NOT here.
  { pattern: "/items/coupons", section: "items", component: "CouponsPage" },
  { pattern: "/items/coupons/new", section: "items", component: "CouponEditor" },
  { pattern: "/items/coupons/:id", section: "items", component: "CouponEditor" },
  { pattern: "/money/account", section: "money", component: "MoneyAccountManagement" },
  { pattern: "/money/settings/tax", section: "money", component: "SetTax" },
  // ★ the maintainer, 23 Oct 2026 — the 11 Run marketing screens, SAMPLE DATA on the beta only (screens/run/kit/sample.js); the real
  //   wiring comes through a spec. Owner and Admins only: a Coach gets the refusal page (kit/RunPage.jsx runAllowed).
  { pattern: "/run/dashboard", section: "run", component: "RunDashboard" },
  { pattern: "/run/website", section: "run", component: "RunWebsite" },
  { pattern: "/run/search", section: "run", component: "RunSearch" },
  { pattern: "/run/ai-visibility", section: "run", component: "RunAiVisibility" },
  { pattern: "/run/listings", section: "run", component: "RunListings" },
  { pattern: "/run/reviews", section: "run", component: "RunReviews" },
  { pattern: "/run/social", section: "run", component: "RunSocial" },
  { pattern: "/run/ads", section: "run", component: "RunAds" },
  { pattern: "/run/calls", section: "run", component: "RunCalls" },
  { pattern: "/run/competitors", section: "run", component: "RunCompetitors" },
  { pattern: "/run/connections", section: "run", component: "RunConnections" },
  { pattern: "/run/pages", section: "run", component: "LandingPages" },
  { pattern: "/run/templates", section: "run", component: "TemplateList" },
  // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: TemplateList's rows and "New template" both navigated to
  //   `/run/templates/${key}` (or `/run/templates/null` for "New"), and neither pattern was
  //   registered — every click was a dead link to a URL nothing matched. Same two-literal-routes
  //   shape as `/items/coupons/new` + `/items/coupons/:id` just above.
  { pattern: "/run/templates/new", section: "run", component: "TemplateEditor" },
  { pattern: "/run/templates/:key", section: "run", component: "TemplateEditor" },
  { pattern: "/run/campaigns", section: "run", component: "Campaigns" },
  { pattern: "/run/campaigns/new", section: "run", component: "CampaignEditor" },
  { pattern: "/run/lists", section: "run", component: "Segments" },

  // ─── Square Contracts rebuild, 29 Sep 2026 — three tabs: Documents, Templates, Clauses ───────
  // ★ "Documents" is the new default landing (every copy made from a template, Draft through
  //   Expired, both builders — status/template/date are filter chips inside DocsHome.jsx, not
  //   separate routes). "Templates" is both builders + retired together the same way.
  { pattern: "/documents", section: "documents", component: "DocsHome" },
  { pattern: "/documents/templates", section: "documents", component: "DocsTemplates" },
  // ★ Every retired address redirects. DocPipeline.jsx, the old per-sub-tab DocsList/DocsSent
  //   mounts, and the two per-builder "all" screens are retired as pages a person lands on; their
  //   own API paths are untouched (the descriptors still exist in documents.mjs) — nothing here
  //   deletes data or breaks an internal consumer, it only stops routing a person to the old page.
  { pattern: "/documents/pipeline", section: "documents", component: "Redirect" },
  { pattern: "/documents/contracts", section: "documents", component: "Redirect" },
  { pattern: "/documents/contracts/all", section: "documents", component: "Redirect" },
  { pattern: "/documents/forms", section: "documents", component: "Redirect" },
  { pattern: "/documents/executed", section: "documents", component: "Redirect" },
  { pattern: "/documents/sent", section: "documents", component: "Redirect" },
  { pattern: "/documents/sent/all", section: "documents", component: "Redirect" },
  { pattern: "/documents/sent/waiting", section: "documents", component: "Redirect" },
  { pattern: "/documents/sent/signed", section: "documents", component: "Redirect" },
  { pattern: "/documents/sent/declined", section: "documents", component: "Redirect" },
  { pattern: "/documents/sent/expired", section: "documents", component: "Redirect" },
  { pattern: "/documents/templates/all", section: "documents", component: "Redirect" },
  { pattern: "/documents/templates/agreements", section: "documents", component: "Redirect" },
  { pattern: "/documents/templates/forms", section: "documents", component: "Redirect" },
  { pattern: "/documents/templates/retired", section: "documents", component: "Redirect" },
  // ★ No separate "New template" screen any more (§3 of the rebuild ruling) — DocTemplateEditor
  //   itself renders a blank page with a dismissible Blank/Coaching-agreement strip when `isNew`.
  //   Same path, same component, rebuilt internals.
  { pattern: "/documents/write", section: "documents", component: "SourceWriter" },
  { pattern: "/documents/templates/new", section: "documents", component: "DocTemplateEditor" },
  // ★ F899: a literal row must come BEFORE the :id capture row below, or the capture eats it (first match wins)
  { pattern: "/documents/templates/pdf", section: "documents", component: "DocsPdfTemplates" },
  { pattern: "/documents/templates/:id", section: "documents", component: "DocTemplateEditor" },
  // ★ the maintainer, 29 Sep 2026 (Docustay brief) — AI checking's own screen (R6.003); the backend
  //   (/api/documents/ai/check) was already built and wired, this route was the missing half.
  { pattern: "/documents/templates/:id/check", section: "documents", component: "DocsAICheck" },
  { pattern: "/documents/clauses", section: "documents", component: "DocsClauses" },
  { pattern: "/documents/forms/builder/:id", section: "documents", component: "DocsFormBuilder" },
  { pattern: "/documents/import", section: "documents", component: "DocsPdfImport" },
  // QUEUE §23.4 — the upload flow: steps 1–2, then the draft (steps 3–6) or Track/Done for one that was sent
  { pattern: "/documents/upload", section: "documents", component: "DocsUpload" },
  { pattern: "/documents/kiosk", section: "documents", component: "DocsKiosk" },
  { pattern: "/documents/bulk", section: "documents", component: "DocsBulk" },
  { pattern: "/documents/developers", section: "documents", component: "DocsDeveloper" },
  { pattern: "/documents/templates/pdf/:id", section: "documents", component: "DocsPdfTemplate" },
  { pattern: "/documents/pdf/:id", section: "documents", component: "DocsPdf" },
  { pattern: "/documents/:id/certificate", section: "documents", component: "DocsCertificate" },
  { pattern: "/documents/:id/declined", section: "documents", component: "DocsDeclined" },
  { pattern: "/documents/:id/preview", section: "documents", component: "DocPreview" },
  // ★ DOCUSTAY BUILD (29 Sep 2026) — DocsSettings.frame.html, backed by /api/settings/documents
  //   (src/routes/settings.mjs) and src/nav/sections.mjs's new 'doc-settings' nav row.
  { pattern: "/documents/settings", section: "documents", component: "DocsSettings" },
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// validatePages(rows) — the self-check. Throws `Error` naming the offending pattern when a row is
// malformed. Runs at module load, on the real table, below. Exported so its five negative cases
// (test 11.21g) have somewhere to call it directly.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export function validatePages(rows) {
  const seenPatterns = new Set();
  for (const row of rows) {
    const { pattern, section, component } = row;
    if (typeof pattern !== "string" || !pattern.startsWith("/")) {
      throw new Error(`sectionPages: pattern must start with "/" — got ${JSON.stringify(pattern)}`);
    }
    if (seenPatterns.has(pattern)) {
      throw new Error(`sectionPages: duplicate pattern "${pattern}"`);
    }
    seenPatterns.add(pattern);
    const expectedSection = pattern.split("/")[1];
    if (section !== expectedSection) {
      throw new Error(
        `sectionPages: pattern "${pattern}" has section "${section}", expected "${expectedSection}"`
      );
    }
    if (typeof component !== "string" || component.length === 0) {
      throw new Error(`sectionPages: pattern "${pattern}" has an empty component name`);
    }
    const captureNames = pattern
      .split("/")
      .filter((seg) => seg.startsWith(":"))
      .map((seg) => seg.slice(1));
    const seenCaptures = new Set();
    for (const name of captureNames) {
      if (seenCaptures.has(name)) {
        throw new Error(`sectionPages: pattern "${pattern}" repeats capture name ":${name}"`);
      }
      seenCaptures.add(name);
    }
  }
}

// ★★★ RUNS AT MODULE LOAD, ON THE REAL TABLE — so a bad row added by any later stage fails the
//     first page load rather than rendering the wrong screen. With an empty table it loops zero
//     times and throws nothing, which is correct.
validatePages(SECTION_PAGES);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// pageFor(path, pages = SECTION_PAGES) → { section, component, params } | null
//
// FIRST MATCH WINS, in array order — a literal row placed before a capture row beats it.
// `path` is compared as given (already query-stripped, `+page.svelte:32`). A `path` that is not a
// string, or does not start with "/", returns null rather than throwing — a renderer must never
// crash on a URL.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export function pageFor(path, pages = SECTION_PAGES) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const pathSegs = path.split("/");
  for (const row of pages) {
    const patternSegs = row.pattern.split("/");
    if (patternSegs.length !== pathSegs.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < patternSegs.length; i++) {
      const pSeg = patternSegs[i];
      const vSeg = pathSegs[i];
      if (pSeg.startsWith(":")) {
        if (vSeg.length === 0) { matched = false; break; }
        params[pSeg.slice(1)] = vSeg;
      } else if (pSeg !== vSeg) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { section: row.section, component: row.component, params: Object.freeze(params) };
    }
  }
  return null;
}
