// @ts-check
// src/routes/legal.mjs — PLATFORM'S OWN LEGAL PAGES. Site-readiness brief, Part 3, 1 Oct 2026.
//
// ★★★ Registered like `registerPublicLeadsRoutes`/`registerSignupRoutes` — a plain, unauthenticated
//     GET, no tenant context (there IS no tenant for "the platform's own policy", by definition), and
//     registered BEFORE the SPA catch-all (`app.get("*", ...)` in src/http/app.mjs) so these three
//     paths never fall through to the React shell. Content lives in src/legal/policies.mjs, not
//     here — this file is only the HTTP edge around it, same split as every other public route.

import { renderLegalPage } from "../legal/policies.mjs";

export function registerLegalRoutes(app) {
  for (const slug of ["privacy", "terms", "dpa"]) {
    app.get(`/legal/${slug}`, (c) => {
      const html = renderLegalPage(slug);
      // ★ Cacheable, unlike the SPA shell — this page does not name any hashed asset file, so a
      //   cached copy is never stale in the way the shell's no-store comment warns about.
      c.header("cache-control", "public, max-age=3600");
      return c.html(html);
    });
  }
}
