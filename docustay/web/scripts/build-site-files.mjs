#!/usr/bin/env node
// Writes the public site's machine files from src/lib/site/pages.js: static/sitemap.xml, static/robots.txt, and a Markdown copy of every page (served at <page>.md). `--check` fails if what is on disk differs.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { allPages } from "../src/lib/site/pages.js";
import { readPages, build as buildDocs } from "./build-docs.mjs";
import { llmsTxt, llmsFull } from "./llms.mjs";
import { robotsTxt } from "../src/lib/site/crawlers.js";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const BASE = process.env.DOCUSTAY_SITE_BASE ?? "https://docustay.app";
const out = new Map();
const pages = allPages();
const docs = readPages().map((p) => `/docs/${p.slug}`).concat(["/docs/api-reference"]);
const docPagesSrc = readPages();
const urls = [...pages.map((p) => p.path), ...docs];
// <lastmod> is REAL: a page's date changes only when its own content hash changes. The hashes and dates live in src/lib/site/lastmod.json (committed); a changed page gets today's date when this script is run without --check.
const LASTMOD_FILE = path.join(ROOT, "src/lib/site/lastmod.json"); const lastmod = fs.existsSync(LASTMOD_FILE) ? JSON.parse(fs.readFileSync(LASTMOD_FILE, "utf8")) : {};
const contentOf = (u) => { const pg = pages.find((x) => x.path === u); if (pg) return JSON.stringify([pg.title, pg.desc, pg.md]); const slug = u.replace(/^\/docs\//, ""); const d = docPagesSrc.find((x) => x.slug === slug); return JSON.stringify(d ?? slug); };
const today = new Date().toISOString().slice(0, 10); let lastmodChanged = false; const next = {};
for (const u of urls) { const h = crypto.createHash("sha256").update(contentOf(u)).digest("hex").slice(0, 16); const prev = lastmod[u]; next[u] = prev && prev.hash === h ? prev : { hash: h, date: process.argv.includes("--check") ? (prev?.date ?? "") : today }; if (!prev || prev.hash !== h) lastmodChanged = true; }
out.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${BASE}${u === "/" ? "" : u}</loc><lastmod>${next[u].date}</lastmod></url>`).join("\n")}\n</urlset>\n`);
out.set("robots.txt", robotsTxt(BASE));
{ const { pages: docPages } = buildDocs(); const args = { pages, docs: docPages, base: BASE };
  out.set("llms.txt", llmsTxt(args).text); out.set("llms-full.txt", llmsFull(args)); }
for (const p of pages) if (p.path !== "/") out.set(`${p.path.slice(1)}.md`, `---\ntitle: ${p.title}\ndescription: ${p.desc}\n---\n\n${p.md.trim()}\n`);
out.set("index.md", `---\ntitle: ${pages[0].title}\ndescription: ${pages[0].desc}\n---\n\n${pages[0].md.trim()}\n`);
const check = process.argv.includes("--check"); let bad = 0, n = 0;
if (check) { if (lastmodChanged) { console.error("stale: lastmod.json"); bad += 1; } } else if (lastmodChanged || !fs.existsSync(LASTMOD_FILE)) fs.writeFileSync(LASTMOD_FILE, JSON.stringify(next, null, 1) + "\n");
for (const [rel, text] of out) { const f = path.join(ROOT, "static", rel); n += 1;
  if (check) { if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text) { console.error("stale:", rel); bad += 1; } }
  else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } }
if (check) { if (bad) { console.error(`${bad} stale — run: node scripts/build-site-files.mjs`); process.exit(1); } console.log(`site files current (${n})`); }
else console.log(`wrote ${n} site files`);
