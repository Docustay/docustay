// Structured data for every page of the public site, built on the server from the page's own path, title and description and written into <head> by hooks.server.js (no script reaches the browser for it).
// One @graph per page: Organization + WebSite + the page itself (typed by what the page is), linked by @id. FAQ and breadcrumb blocks stay where they are, next to the content they describe. check:site (scripts/structured-gate.mjs) parses every block.
import { DEFAULT_PLANS, SELFHOST_PRO_YEARLY_MINOR, FACTS_CHECKED } from "./plans.js";
import { CHANGES } from "./changelog.js";
import { TEMPLATES } from "./pages/templates.js";
const BASE = "https://docustay.app";
const ORG = `${BASE}/#organization`, SITE = `${BASE}/#website`;
export const organization = () => ({ "@type": "Organization", "@id": ORG, name: "Docustay", url: BASE, logo: { "@type": "ImageObject", url: `${BASE}/brand/docustay-icon-192.png`, width: 192, height: 192 }, email: "hello@docustay.app", contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: "hello@docustay.app", availableLanguage: "English" }, { "@type": "ContactPoint", contactType: "security", email: "security@docustay.app", availableLanguage: "English" }] });
export const website = () => ({ "@type": "WebSite", "@id": SITE, name: "Docustay", url: BASE, inLanguage: "en", publisher: { "@id": ORG } });
const money = (minor) => (minor / 100).toFixed(2);
const offer = (name, minor, extra = {}) => ({ "@type": "Offer", name, price: money(minor), priceCurrency: "USD", availability: "https://schema.org/InStock", url: `${BASE}/pricing`, ...extra });
const monthly = (minor) => ({ "@type": "UnitPriceSpecification", price: money(minor), priceCurrency: "USD", billingDuration: "P1M", unitCode: "MON" });
export const pricingOffers = () => [
  offer("Free", 0, { description: `${DEFAULT_PLANS.free.docsPerMonth} documents and ${DEFAULT_PLANS.free.templatesPerMonth} new templates a month, API, webhooks and embedding included` }),
  offer("Pro", DEFAULT_PLANS.pro.monthlyMinor, { description: "Flat per workspace, unlimited team members, signers, documents and templates", priceSpecification: monthly(DEFAULT_PLANS.pro.monthlyMinor) }),
  offer("Pro, founders price", DEFAULT_PLANS.pro.foundersMonthlyMinor, { description: "For as long as the subscription stays active, for those who subscribe before the cut-off", priceValidUntil: DEFAULT_PLANS.foundersUntil.slice(0, 10), priceSpecification: monthly(DEFAULT_PLANS.pro.foundersMonthlyMinor) }),
  offer("Self-host Community", 0, { description: "Free under the AGPL-3.0, on your own server" }),
  offer("Self-host Pro", SELFHOST_PRO_YEARLY_MINOR, { description: "Per install, per year, for your own business", priceSpecification: { "@type": "UnitPriceSpecification", price: money(SELFHOST_PRO_YEARLY_MINOR), priceCurrency: "USD", billingDuration: "P1Y", unitCode: "ANN" } }),
];
const app = (name, url, extra = {}) => ({ "@type": "SoftwareApplication", name, url, applicationCategory: "BusinessApplication", operatingSystem: "Web", inLanguage: "en", publisher: { "@id": ORG }, ...extra });
const FREE = [offer("Free", 0)];
/** The @graph for one page. `kind` is chosen from the path alone, so a new page of an existing kind needs no code. */
export function siteGraph({ path, title, description, hasCrumbs = true }) {
  const url = BASE + (path === "/" ? "" : path.replace(/\/$/, ""));
  const name = String(title ?? "").replace(/\s*[|·]\s*Docustay$/, "") || "Docustay";
  const page = (type, extra = {}) => ({ "@type": type, "@id": `${url}#webpage`, url, name, description, inLanguage: "en", isPartOf: { "@id": SITE }, publisher: { "@id": ORG }, ...extra });
  const nodes = [organization(), website()];
  if (path.startsWith("/docs/") || /^\/developers\/[^/]+$/.test(path)) nodes.push({ "@type": "TechArticle", "@id": `${url}#article`, url, headline: name.slice(0, 110), name, description, inLanguage: "en", isPartOf: { "@id": SITE }, author: { "@id": ORG }, publisher: { "@id": ORG }, proficiencyLevel: "Beginner", about: { "@type": "SoftwareApplication", name: "Docustay", url: BASE } });
  else if (path === "/" || path === "/features") nodes.push(page("WebPage", { about: { "@id": `${url}#software` } }), app("Docustay", url, { "@id": `${url}#software`, description: "An open-source (AGPL-3.0) e-signature API and app: send from code, sign on any device, keep a sealed PDF with a certificate of completion.", offers: path === "/" ? [offer("Free", 0), offer("Pro", DEFAULT_PLANS.pro.monthlyMinor, { priceSpecification: monthly(DEFAULT_PLANS.pro.monthlyMinor) }), offer("Self-host Pro", SELFHOST_PRO_YEARLY_MINOR)] : [offer("Free", 0), offer("Self-host Community", 0)] }));
  else if (path === "/changelog") nodes.push(page("WebPage"), ...CHANGES.map((c) => ({ "@type": "Article", headline: c.title, datePublished: new Date(`${c.date.split(" ")[0]} 1, ${c.date.split(" ")[1]}`).toISOString().slice(0, 7), author: { "@id": ORG }, publisher: { "@id": ORG }, isPartOf: { "@id": SITE }, mainEntityOfPage: url })));
  else if (/^\/use-cases\/[^/]+$/.test(path)) { const list = TEMPLATES.filter((t) => t.use === path.split("/")[2] || t.use === path.split("/")[2].replace(/-and-.*/, "")); nodes.push(page("CollectionPage"), { "@type": "ItemList", "@id": `${url}#templates`, name: `${name} templates`, numberOfItems: list.length, itemListElement: list.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.title, url: `${BASE}/templates/${t.slug}` })) }); }
  else if (path === "/contact") nodes.push(page("ContactPage"));
  else if (path === "/about") nodes.push(page("AboutPage", { about: { "@id": ORG } }));
  else if (path === "/pricing") nodes.push(page("WebPage"), { "@type": "Product", "@id": `${BASE}/pricing#product`, name: "Docustay", description: "Document signing with a free plan, a flat-price Pro plan, and a free self-hosted edition under the AGPL-3.0.", brand: { "@id": ORG }, url, offers: pricingOffers() });
  else if (path === "/self-host") nodes.push(page("WebPage", { about: { "@id": `${url}#software` } }), app("Docustay, self-hosted", url, { "@id": `${url}#software`, license: "https://www.gnu.org/licenses/agpl-3.0.html", offers: [offer("Self-host Community", 0, { url }), offer("Self-host Pro", SELFHOST_PRO_YEARLY_MINOR, { url })] }));
  else if (path === "/open-source") nodes.push(page("WebPage", { about: { "@id": `${url}#software` } }), app("Docustay (AGPL-3.0 edition)", url, { "@id": `${url}#software`, license: "https://www.gnu.org/licenses/agpl-3.0.html", offers: FREE }));
  else if (path === "/verify" || path.startsWith("/tools/")) nodes.push(page("WebPage", { about: { "@id": `${url}#software` } }), app(name, url, { "@id": `${url}#software`, applicationCategory: "UtilitiesApplication", isAccessibleForFree: true, featureList: "Runs in the browser; the file is never uploaded", offers: FREE }));
  else if (path === "/about") nodes.push(page("WebPage", { dateModified: "2026-10-12", about: { "@id": ORG }, description: `${description} Last checked ${FACTS_CHECKED}.` }));
  else nodes.push(page("WebPage"));
  if (!hasCrumbs && path !== "/") {   // a page that draws no breadcrumb of its own still tells search engines where it sits
    const segs = path.replace(/\/$/, "").split("/").filter(Boolean), HUBS = { docs: "Docs", developers: "Developers", features: "Features", "self-host": "Self-host", trust: "Trust" };
    const trail = [["Docustay", BASE + "/"]]; if (segs.length > 1 && HUBS[segs[0]]) trail.push([HUBS[segs[0]], `${BASE}/${segs[0]}`]); trail.push([name, url]);
    nodes.push({ "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: trail.map(([n, h], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: h })) });
  }
  return { "@context": "https://schema.org", "@graph": nodes };
}
/** Safe to place inside a <script> element. */
export const jsonldScript = (g) => `<script type="application/ld+json">${JSON.stringify(g).replace(/</g, "\\u003c")}</script>`;
