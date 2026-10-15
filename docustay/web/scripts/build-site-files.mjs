#!/usr/bin/env node
// Writes the public site's machine files from src/lib/site/pages.js: static/sitemap.xml, static/robots.txt, and a Markdown copy of every page (served at <page>.md). `--check` fails if what is on disk differs.
import fs from "node:fs";
import path from "node:path";
import { allPages } from "../src/lib/site/pages.js";
import { SITE_LANGS } from "../src/lib/site/l10n.js";
import { readPages } from "./build-docs.mjs";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const BASE = process.env.DOCUSTAY_SITE_BASE ?? "https://docustay.app";
const out = new Map();
const pages = allPages();
const docs = readPages().map((p) => `/docs/${p.slug}`).concat(["/docs/api-reference"]);
const loc = ["es", "fr", "de"].flatMap((l) => [`/${l}`, `/${l}/product`, `/${l}/trust`]);
const urls = [...pages.map((p) => p.path), ...docs, ...loc];
// the localized overview pages (home, how it works, trust) are in the sitemap with their alternates, so a search engine can offer the right language
const ALT = ["", "/product", "/trust"], LOC = SITE_LANGS.filter((l) => l !== "en");
const alternates = (tail) => [...SITE_LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${BASE}${l === "en" ? tail : "/" + l + tail}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${BASE}${tail}"/>`].join("");
const langUrls = LOC.flatMap((l) => ALT.map((tail) => `  <url><loc>${BASE}/${l}${tail}</loc>${alternates(tail)}</url>`));
out.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.map((u) => `  <url><loc>${BASE}${u === "/" ? "" : u}</loc>${ALT.includes(u === "/" ? "" : u) ? alternates(u === "/" ? "" : u) : ""}</url>`).concat(langUrls).join("\n")}\n</urlset>\n`);
// the AI search crawlers are named and welcome on the public pages (FP-B3); the app, the API and the signing pages stay out of every index
const KEEP_OUT = "Disallow: /api/\nDisallow: /sign/\nDisallow: /documents\nDisallow: /settings\n";
const BOTS = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "Bingbot", "GPTBot", "ClaudeBot"];
out.set("robots.txt", `${BOTS.map((b) => `User-agent: ${b}\nAllow: /\n${KEEP_OUT}`).join("\n")}\nUser-agent: *\nAllow: /\n${KEEP_OUT}Sitemap: ${BASE}/sitemap.xml\n`);
for (const p of pages) if (p.path !== "/") out.set(`${p.path.slice(1)}.md`, `---\ntitle: ${p.title}\ndescription: ${p.desc}\n---\n\n${p.md.trim()}\n`);
out.set("index.md", `---\ntitle: ${pages[0].title}\ndescription: ${pages[0].desc}\n---\n\n${pages[0].md.trim()}\n`);
const check = process.argv.includes("--check"); let bad = 0, n = 0;
for (const [rel, text] of out) { const f = path.join(ROOT, "static", rel); n += 1;
  if (check) { if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text) { console.error("stale:", rel); bad += 1; } }
  else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } }
if (check) { if (bad) { console.error(`${bad} stale — run: node scripts/build-site-files.mjs`); process.exit(1); } console.log(`site files current (${n})`); }
else console.log(`wrote ${n} site files`);
