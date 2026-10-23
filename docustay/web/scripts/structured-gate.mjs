#!/usr/bin/env node
// Structured-data gate: every page in the sitemap, served by a real preview of the build, carries valid JSON-LD: Organization + WebSite + a typed page node on every page, Product + Offers on pricing, TechArticle on every docs page, and every FAQ, breadcrumb and application block complete.
import fs from "node:fs";
import path from "node:path";
import { startPreview } from "./crawl-gate.mjs";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PAGE_TYPES = new Set(["WebPage", "AboutPage", "ContactPage", "TechArticle", "CollectionPage"]);
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
export function nodesOf(html) {
  const out = [], errs = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { const j = JSON.parse(m[1]); for (const n of arr(j["@graph"] ?? j)) out.push(n); } catch { errs.push("a JSON-LD block does not parse"); } }
  return { nodes: out, errs };
}
export function validate(path0, html) {
  const { nodes, errs } = nodesOf(html), bad = [...errs]; const T = (t) => nodes.filter((n) => arr(n["@type"]).includes(t));
  const need = (ok, msg) => { if (!ok) bad.push(msg); };
  const org = T("Organization"), site = T("WebSite");
  need(org.length === 1 && org[0].name && org[0].url && org[0].logo?.url, "needs exactly one Organization with name, url and logo");
  need(site.length === 1 && site[0].name && site[0].url && site[0].inLanguage === "en", "needs exactly one WebSite in English");
  const canon = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const pg = nodes.filter((n) => arr(n["@type"]).some((t) => PAGE_TYPES.has(t)));
  need(pg.length >= 1 && pg.every((n) => n.url === canon && n.inLanguage === "en" && (n.name || n.headline) && n.description), `needs a page node whose url is the canonical (${canon}) with name, description and inLanguage en`);
  if (path0.startsWith("/docs/")) { const a = T("TechArticle")[0]; need(a && a.headline && a.author && a.publisher && a.description, "docs page needs a complete TechArticle"); }
  if (path0 === "/pricing") { const p = T("Product")[0]; need(p && p.name && arr(p.offers).length >= 4 && arr(p.offers).every((o) => /^\d+(\.\d\d)?$/.test(String(o.price)) && o.priceCurrency === "USD"), "pricing needs a Product with at least four Offers (price, USD)"); }
  for (const f of T("FAQPage")) need(arr(f.mainEntity).length >= 1 && arr(f.mainEntity).every((q) => q.name && q.acceptedAnswer?.text), "a FAQPage has a question without an answer");
  for (const b of T("BreadcrumbList")) need(arr(b.itemListElement).length >= 1 && arr(b.itemListElement).every((it, i) => it.position === i + 1 && it.name && /^https:\/\//.test(it.item)), "a BreadcrumbList is malformed");
  for (const s of T("SoftwareApplication")) need(s.name && (s.offers || s.applicationCategory), "a SoftwareApplication lacks name and offers/category");
  if (/lang="(?!en")/.test(html.match(/<html[^>]*>/)?.[0] ?? "")) bad.push("html lang is not en");
  return bad;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  // controls: a good page passes, a docs page without a publisher fails
  const good = `<link rel="canonical" href="https://docustay.app/docs/x"><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Organization", name: "D", url: "u", logo: { url: "l" } }, { "@type": "WebSite", name: "D", url: "u", inLanguage: "en" }, { "@type": "TechArticle", url: "https://docustay.app/docs/x", name: "n", headline: "h", description: "d", inLanguage: "en", author: {}, publisher: {} }] })}</script>`;
  if (validate("/docs/x", good).length) { console.log("FAIL control: a complete page was rejected", validate("/docs/x", good)); process.exit(1); }
  if (!validate("/docs/x", good.replace('"publisher":{}', '"x":1')).length) { console.log("FAIL control: an incomplete page was accepted"); process.exit(1); }
  const sm = fs.readFileSync(path.join(ROOT, "static", "sitemap.xml"), "utf8"); const paths = [...sm.matchAll(/<loc>https:\/\/docustay\.app([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
  const { port, stop } = await startPreview(); process.on("exit", stop); const fails = [];
  for (const p of paths) { const r = await fetch(`http://127.0.0.1:${port}${p}`); const html = await r.text(); if (r.status !== 200) { fails.push(`${p}: status ${r.status}`); continue; } for (const b of validate(p, html)) fails.push(`${p}: ${b}`); }
  stop();
  for (const f of fails.slice(0, 40)) console.log("  FAIL " + f);
  console.log(fails.length ? `STRUCTURED GATE FAIL (${fails.length})` : `STRUCTURED GATE PASS: ${paths.length} pages, every JSON-LD block parses and is complete`); process.exit(fails.length ? 1 : 0);
}
