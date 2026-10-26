// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0c — WHERE A SECTION HEADER SENDS YOU. GENERATED FROM §"THE 83 ITEMS", NOT HAND-TYPED.
//
// ★★★ A SECTION HEADER OWNS NO LIST OF ITS OWN, AND TODAY EVERY ONE OF THESE RENDERS
//     `SectionNotBuilt` **WHILE ITS OWN CHILDREN WORK**. Clicking "People" tells you People is not
//     built, one click above a working list of people. That is the nav calling itself a liar.
//
// ★★ GENERATED, AND THAT IS THE POINT OF P6.0c. Each pair is read out of the BUILD column of the
//    83-item table, which already states the target in words ("Section header. Redirect to
//    `/people/all`"). Hand-typing twelve pairs that are already written down is twelve chances to
//    typo a destination — and a wrong destination is indistinguishable from a working one.
//
// ★ THE TARGET MAY ITSELF BE UNBUILT, AND THAT IS STILL RIGHT. `/growth → /growth/campaigns` lands
//   on an honest "not built, phase 20" screen rather than on a blank section header. A specific
//   explanation beats a generic one; both beat nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** nav path → the child it stands in front of. */
const SECTION_REDIRECTS = Object.freeze({
  "/people": "/people/active",             // P6.2 — the maintainer 1 Oct 2026 (Section C): Active is the default People tab
  "/accounts": "/accounts/all",            // P6.14
  "/engagements": "/engagements/calendar", // P6.24
  "/items": "/items/services",             // P6.30
  // ★ the maintainer, 29 Sep 2026 (Square Contracts rebuild) — "/documents" is a REAL destination now (the
  //   Documents tab itself), not a section header standing in front of a first child. Removed here
  //   so it falls through to the route table and actually renders instead of redirecting away from
  //   itself. Its own retired children (pipeline, contracts, forms) fall through the same way, to
  //   sectionPages.js's Redirect rows (webreact/src/lib/app/routes.js's OLD_DOCUMENT_ADDRESSES) —
  //   this table fires FIRST (CatchAll.jsx's useEffect, before the route table is ever consulted),
  //   so an entry left here for any of them would always win and the Redirect component would never
  //   get a chance to run — found live once already tonight for /documents/contracts and
  //   /documents/forms, the same reasoning extended to /documents itself.
  "/money": "/money/invoices",             // P6.44
  "/money/settings": "/settings/money",    // Task 15.38
  "/growth": "/growth/campaigns",          // P6.49
  "/tasks": "/tasks/mine",                 // P6.54
  "/settings": "/settings/practice",       // P6.59
  "/settings/developer": "/settings/developer/api-keys", // P6.71
  "/platform": "/platform/tenants",        // P6.77
});

/** ★ `null` when a path is not a redirecting header, so callers need no membership test. */
export const redirectFor = (path) => SECTION_REDIRECTS[path] ?? null;
