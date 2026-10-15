// Old public addresses and where they live now. Used twice: a prerendered stub for each (the static handler answers before the hooks run) and a 301 in hooks.server.js for anything else.
import { TEMPLATES } from "./pages/templates.js";
const exact = {
    "/features": "/product", "/product/api-and-sdks": "/developers/api", "/product/embedding": "/developers/embedding", "/product/text-tags": "/docs/templates-and-text-tags", "/product/templates-and-fields": "/product/templates",
  "/template-library": "/document-templates", "/developers/ai-tools": "/developers/agents", "/tools/signature-maker": "/tools/signature-generator",
  "/use-cases/consent-and-waivers": "/use-cases/waivers-and-consent", "/legal/privacy": "/legal/privacy-policy", "/legal/licensing": "/licensing",
};
for (const t of TEMPLATES) exact[`/template-library/${t.old}`] = `/templates/${t.slug}`;
// Run 7 part 7: the nine Trust pages became one Trust centre (plus /trust/legal-validity and /verify); each retired page goes to its part
Object.assign(exact, { "/trust/security": "/trust#security", "/trust/privacy": "/trust#privacy", "/trust/data-handling": "/trust#privacy", "/trust/audit-trail": "/trust#proof", "/trust/signature-standards": "/trust#proof", "/trust/sub-processors": "/trust#sub-processors" });
export const REDIRECTS = exact;
/** The new address for an old one, or null. A trailing slash and a query string are tolerated. */
export function movedTo(pathname) { const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname; if (p === "/compare" || p.startsWith("/compare/")) return "/"; return REDIRECTS[p] ?? null; }   // the whole retired /compare section goes to the home page
