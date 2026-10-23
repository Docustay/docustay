#!/usr/bin/env node
// Structured-data gate (V2 section 8.1 item 5): every page carries the types its kind needs, and every property matches visible text. Fails when a required type disappears.
//   all pages: Organization + WebSite · below the top level: BreadcrumbList · a visible FAQ: FAQPage whose questions are the visible ones · home, /features, /self-host: SoftwareApplication with offers
//   /pricing: Product with Offers for Free, Pro (and the founders offer with its end date) and Self-host Pro at $390 · template hub and collections: ItemList · docs and developer pages: TechArticle
//   changelog: Article for its entries · home: VideoObject · every price in an Offer appears in the page's visible text
// Usage: node scripts/jsonld-gate.mjs [--base http://127.0.0.1:5199]   (a running dev server or preview; reads static/sitemap.xml)
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5199");
const sm = fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8"); const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, "") || "/");
const blocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
const flat = (b) => b.flat().flatMap((x) => (x["@graph"] ? x["@graph"] : [x]));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const types = (n) => [].concat(n["@type"] ?? []);
const bad = []; const need = (u, ok, msg) => { if (!ok) bad.push(`${u}: ${msg}`); };
const sample = async (u) => { const r = await fetch(BASE + u); return { status: r.status, html: await r.text() }; };
// positive control: a page with no JSON-LD must fail the "Organization" rule
need("control", flat(blocks("<html></html>")).some((n) => types(n).includes("Organization")) === false, "control broke"); const controlBad = flat(blocks("<html></html>")).some((n) => types(n).includes("Organization")); if (controlBad) { console.log("FAIL control"); process.exit(1); }
console.log("PASS  control: a page without structured data is caught");
for (const u of urls) {
  const { status, html } = await sample(u); if (status !== 200) { bad.push(`${u}: HTTP ${status}`); continue; }
  const nodes = flat(blocks(html)), all = new Set(nodes.flatMap(types)), vis = text(html);
  need(u, all.has("Organization") && all.has("WebSite"), "Organization and WebSite are missing");
  if (u !== "/") need(u, all.has("BreadcrumbList"), "BreadcrumbList is missing");
  const faqVisible = /<details[^>]*class="[^"]*(d-faq|faq)/.test(html) || html.includes('class="d-faq"') || html.includes("data-faq");
  if (faqVisible) { const faq = nodes.find((n) => types(n).includes("FAQPage")); need(u, !!faq, "a visible FAQ has no FAQPage"); for (const q of faq?.mainEntity ?? []) need(u, vis.includes(q.name.replace(/&amp;/g, "&").slice(0, 40)), `FAQ question not visible: ${q.name.slice(0, 50)}`); }
  if (["/", "/features", "/self-host"].includes(u)) need(u, all.has("SoftwareApplication") && nodes.some((n) => types(n).includes("SoftwareApplication") && n.offers), "SoftwareApplication with offers is missing");
  if (u === "/pricing") { const p = nodes.find((n) => types(n).includes("Product")); need(u, !!p, "Product is missing"); const o = (p?.offers ?? []).map((x) => x.name + "=" + x.price); for (const w of ["Free=0.00", "Pro=", "Pro, founders price=", "Self-host Pro=390.00"]) need(u, o.some((x) => x.startsWith(w)), `Offer ${w} is missing`); need(u, (p?.offers ?? []).some((x) => x.priceValidUntil), "the founders offer has no end date"); need(u, vis.includes("$390"), "$390 is not in the visible text"); }
  if (u === "/free-templates" || /^\/use-cases\/[^/]+$/.test(u)) need(u, all.has("ItemList"), "ItemList is missing");
  if (u.startsWith("/docs/") || /^\/developers\/[^/]+$/.test(u)) need(u, all.has("TechArticle"), "TechArticle is missing");
  if (u === "/changelog") need(u, all.has("Article"), "Article for the entries is missing");
  if (u === "/") need(u, all.has("VideoObject"), "VideoObject is missing");
  for (const n of nodes) for (const off of [].concat(n.offers ?? [])) if (off.price && Number(off.price) > 0) need(u, vis.includes("$" + Number(off.price).toLocaleString("en-US")) || vis.includes("$" + off.price), `price ${off.price} in an Offer is not visible on the page`);
}
if (bad.length) { for (const b of bad.slice(0, 60)) console.log("  FAIL " + b); console.log(`JSON-LD GATE FAIL (${bad.length})`); process.exit(1); }
console.log(`JSON-LD GATE PASS: ${urls.length} pages`);
