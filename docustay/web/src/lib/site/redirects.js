// Old public addresses and where they live now. Used twice: a prerendered stub for each (the static handler answers before the hooks run) and a 301 in hooks.server.js for anything else.
import { TEMPLATES } from "./pages/templates.js";
const exact = {
    // 14 Oct 2026 (V2): Product became Features; each old address goes to its new home in ONE hop (no chains)
    "/product": "/features/how-it-works", "/product/sending": "/features/how-it-works#send", "/product/signing-order": "/features/how-it-works#send", "/product/signing": "/features/how-it-works#sign", "/product/tracking": "/features/how-it-works#prove", "/product/proof": "/features/proof", "/product/payments": "/features/payments", "/product/scribe": "/features/scribe", "/product/teams": "/pricing#teams", "/product/templates": "/free-templates", "/product/forms": "/free-templates", "/sign-pdf/ruby": "/sign-pdf", "/sign-pdf/java": "/sign-pdf",
    "/product/api-and-sdks": "/developers/api", "/product/embedding": "/developers/embedding", "/product/text-tags": "/docs/templates-and-text-tags", "/product/templates-and-fields": "/free-templates",
  "/template-library": "/free-templates", "/developers/ai-tools": "/developers/agents", "/tools/signature-maker": "/tools/signature-generator", "/tools/signature": "/tools/signature-generator",
  "/use-cases/consent-and-waivers": "/use-cases/waivers-and-consent", "/legal/privacy": "/legal/privacy-policy", "/legal/licensing": "/licensing",
  // 13 Oct 2026: the healthcare pages were removed from the site (not marketed); the library templates themselves are untouched
  "/use-cases/healthcare-intake": "/use-cases", "/templates/patient-intake-form": "/free-templates", "/templates/medical-consent-form": "/free-templates", "/template-library/intake-form": "/free-templates", "/template-library/consent-to-treatment": "/free-templates",
};
for (const t of TEMPLATES) { exact[`/template-library/${t.old}`] = `/templates/${t.slug}`; if (t.old !== t.slug) exact[`/templates/${t.old}`] = `/templates/${t.slug}`; }   // the built-in library's own name for a template (the in-app Templates page used it) leads to its page, in one hop
exact["/templates/intake-form"] = "/free-templates"; exact["/templates/consent-to-treatment"] = "/free-templates";   // two built-ins have no website page (the healthcare pages are not marketed)
// Run 7 part 7: the nine Trust pages became one Trust centre (plus /trust/legal-validity and /verify); each retired page goes to its part
Object.assign(exact, { "/trust/security": "/trust#security", "/trust/privacy": "/trust#privacy", "/trust/data-handling": "/trust#privacy", "/trust/audit-trail": "/trust#proof", "/trust/signature-standards": "/trust#proof", "/trust/sub-processors": "/trust#sub-processors" });
// 17 Oct 2026 (V1): the Forms system, Automations and the translated docs are gone; the two template indexes became one; Facts folded into About. Every old address goes to its new home in ONE hop.
import { FORMS } from "./pages/formTemplates.js";
Object.assign(exact, { "/features/automations": "/whats-next", "/facts": "/about#facts", "/docs/languages": "/docs/index", "/docs/email-templates": "/docs/email-api", "/docs/contracts-payments-playbooks": "/docs/payments-and-playbooks",
  "/form-templates": "/free-templates", "/document-templates": "/free-templates", "/templates": "/free-templates" });
for (const f of FORMS) exact[`/form-templates/${f.slug}`] = `/templates/${f.slug}`;
export const REDIRECTS = exact;
// The website is English only (12 Oct 2026): the translated pages that used to live under /es, /fr, /de, /pt, /it, /nl, /pl, /tr, /ru, /ar, /ja, /zh and /ko (home, /product and /trust in each) now answer 301 with their English page. Browsers translate pages for people; the PRODUCT stays in 13 languages.
export const REMOVED_LOCALES = ["en", "es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko"];
const LOCALE_PATH = new RegExp(`^/(${REMOVED_LOCALES.join("|")})(/.*)?$`);
const LOCALIZED_TAILS = new Set(["/product", "/trust"]);   // the only pages that ever existed in more than the home page
/** The new address for an old one, or null. A trailing slash and a query string are tolerated. */
export function movedTo(pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/compare" || p.startsWith("/compare/")) return "/";   // the whole retired /compare section goes to the home page
  const loc = LOCALE_PATH.exec(p); if (loc) return LOCALIZED_TAILS.has(loc[2] ?? "") ? (REDIRECTS[loc[2]] ?? loc[2]) : "/";
  return REDIRECTS[p] ?? null;
}
