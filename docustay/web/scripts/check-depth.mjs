#!/usr/bin/env node
// THE MINIMUM-DEPTH GATE (BUILD-BLUEPRINT §4). Renders every sitemap page at 1440 and 390 in a real browser and fails (in enforce mode) when a page is thinner than its type's minimum.
//   node scripts/check-depth.mjs --base http://127.0.0.1:5191            report mode: writes the CSV, exits 0
//   node scripts/check-depth.mjs --base http://127.0.0.1:5191 --enforce  exits 1 when any page fails
//   options: --only /path,/path   --out research/depth-report.csv
// COVERAGE (changed 13 Oct 2026, the maintainer's ruling): any element with its own background or border (a glass card, panel, table, code window, figure, list row), 24 to 1600 px tall and at most 1290 px wide, that CONTAINS text or media counts as covered across its whole surface (the card's padding is part of the card), not only the inner text lines. Full-width section backdrops are NOT counted. Every other check is unchanged.
// Also (13 Oct 2026): coverage is measured over the page's content area, which starts below the 140 px the fixed header takes (the empty-gap check still counts that stretch).
// A paragraph inside a link (a template card listing its one-line summary on the index and on related pages) is a listing, not body copy, and is left out of the duplicate check.
// Checks: 1 height · 2 visible words (code, nav, footer excluded) · 3 sections with an H2 · 4 required elements (data-req="code,frame,faq,table,why-grid") · 5 no empty vertical gap above 320 px at 1440 ·
// 6 at least 70% of the page covered by text, media, code or tables · 7 a paragraph of 25+ words on more than two pages (filler or copy-paste) · 8 heading order (one H1, no skipped level).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5191").replace(/\/$/, ""), ENFORCE = process.argv.includes("--enforce");
const OUT = arg("--out", path.join(ROOT, "..", "..", "specs/proofs/stage-t/launch-site/research/depth-report.csv"));
const ONLY = arg("--only", "") ? arg("--only").split(",") : null;

// type: [min height 1440, min height 390, min words, min H2 sections, required elements]
const TYPES = {
  home: [13000, 18500, 1700, 15, ["code", "why-grid"]],
  devhub: [9000, 13500, 1900, 12, ["code", "faq"]],
  devpage: [5500, 8000, 900, 4, ["code"]],
  pricing: [6800, 9500, 1200, 5, ["table", "faq"]],
  featuresHub: [6000, 8800, 1000, 4, ["faq"]],
  howItWorks: [9500, 14000, 1500, 7, ["faq"]],
  featureBig: [6500, 9500, 1100, 4, ["faq"]],       // Scribe, Payments
  featureMid: [6000, 8800, 1000, 4, ["faq"]],       // Proof and verify, Automations
  featureBuilt: [5500, 8000, 900, 4, ["faq"]],      // Embedded signing, Test mode, Agent-ready, White-label
  usecase: [5800, 8200, 950, 4, ["faq"]],           // the collection pages
  usecaseIndex: [4500, 6500, 600, 3, []],
  templatesHub: [7000, 10500, 600, 3, ["faq"]],
  templatesIndex: [5500, 8500, 500, 2, []],
  template: [4200, 6000, 600, 3, ["faq"]],
  signpdf: [4800, 6800, 800, 4, ["code", "faq"]],
  selfhost: [6500, 9000, 1300, 5, ["code", "table", "faq"]],
  selfhostChild: [4500, 6500, 900, 4, []],
  osLicence: [4500, 6500, 900, 4, []],
  trust: [6500, 8500, 1200, 6, []],
  legalValidity: [3500, 5000, 800, 4, []],
  about: [3500, 5000, 700, 3, []],
  demo: [0, 0, 0, 0, []],
  changelog: [3500, 5500, 400, 1, []],
  changelogEntry: [1800, 2800, 250, 0, []],
  facts: [2000, 3000, 500, 3, ["table"]],
  tool: [3500, 5000, 700, 3, []],
  guide: [3000, 4500, 700, 3, []],
  contact: [1800, 2600, 150, 0, []],
  status: [1400, 2000, 150, 0, []],
  legal: [0, 0, 1500, 0, []],
  legalShort: [0, 0, 150, 0, []],   // refunds and renewal: one short policy each, padding them would make them worse
  docs: [0, 0, 400, 0, []],
  notFound: [900, 900, 60, 0, []],
  other: [0, 0, 150, 0, []],
};
import { typeOf } from "./page-types.mjs";
export { typeOf };
const measure = () => {
  const main = document.querySelector("main") ?? document.body; const H = document.documentElement.scrollHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
  let words = 0; const paras = []; const boxes = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    const e = n.parentElement; if (!e || e.closest("pre,code,script,style,noscript,[hidden],footer,nav,[aria-hidden=true],.dh")) continue; const t = n.textContent.trim(); if (!t) continue;
    if (!vis(e)) continue; words += t.split(/\s+/).length; const r = e.getBoundingClientRect(); boxes.push([r.top + scrollY, r.bottom + scrollY]);
  }
  for (const p of main.querySelectorAll("p")) { if (p.closest("footer,nav,pre,[hidden],a")) continue; const t = p.textContent.replace(/\s+/g, " ").trim(); if (t.split(" ").length >= 25) paras.push(t); }
  const hasBg = (cs) => { const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/); const alpha = m ? (m[1].split(",").length > 3 ? parseFloat(m[1].split(",")[3]) : 1) : 0; return alpha > 0.02 || cs.backgroundImage !== "none"; };
  for (const e of main.querySelectorAll("*")) { if (e.closest("[aria-hidden=true],footer,nav,pre,code,script,style,[hidden]") || !vis(e)) continue; const r = e.getBoundingClientRect(); if (r.height < 24 || r.height > 1600 || r.width > 1290) continue; const cs = getComputedStyle(e); if (!(hasBg(cs) || cs.borderTopWidth !== "0px" || cs.borderBottomWidth !== "0px")) continue; if (e.textContent.trim().length < 20 && !e.querySelector("img,svg,video,canvas")) continue; boxes.push([r.top + scrollY, r.bottom + scrollY]); }
  for (const e of main.querySelectorAll("img,svg,video,canvas,pre,table,figure,iframe,.cw,.tm,.et")) { if (e.closest("[aria-hidden=true]") && !e.closest("figure,.cw,.tm,.et")) continue; if (!vis(e)) continue; const r = e.getBoundingClientRect(); if (r.height < 24) continue; boxes.push([r.top + scrollY, r.bottom + scrollY]); }
  const mr = main.getBoundingClientRect(), top0 = mr.top + scrollY, bot0 = mr.bottom + scrollY, HDR = 140, MH = Math.max(1, bot0 - top0 - HDR);   // the first 140 px of a page are the fixed header's clearance, not content area
  boxes.sort((a, b) => a[0] - b[0]); let cover = 0, cur = null, gap = 0, last = top0;
  for (const [a, b] of boxes) { if (!cur) { cur = [a, b]; gap = Math.max(gap, a - top0); continue; } if (a <= cur[1]) cur[1] = Math.max(cur[1], b); else { cover += cur[1] - cur[0]; gap = Math.max(gap, a - cur[1]); cur = [a, b]; } }
  if (cur) { cover += cur[1] - cur[0]; last = cur[1]; }
  const heads = [...main.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((h) => +h.tagName[1]);
  let order = true; for (let i = 1; i < heads.length; i++) if (heads[i] > heads[i - 1] + 1) order = false;
  const req = new Set([...document.querySelectorAll("[data-req]")].flatMap((e) => e.getAttribute("data-req").split(",").map((s) => s.trim()).filter(Boolean)));
  const have = { code: !!main.querySelector("pre code, .cw pre"), frame: !!main.querySelector(".fr"), faq: !!main.querySelector("details, .d-faq"), table: !!main.querySelector("table"), "why-grid": !!main.querySelector("[data-why]") };
  const secs = [...main.querySelectorAll("section")].filter((s) => s.querySelector("h2")).length || [...main.querySelectorAll("h2")].length;
  return { H, words, secs, paras, cover: cover / MH, gap: Math.max(gap, bot0 - last), h1: heads.filter((x) => x === 1).length, order, req: [...req], have };
};
const sm = fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8"); let urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, "") || "/");
if (ONLY) urls = urls.filter((u) => ONLY.includes(u));
const shellRoot = `${process.env.HOME}/Library/Caches/ms-playwright`, shellDir = fs.existsSync(shellRoot) ? fs.readdirSync(shellRoot).filter((d) => d.startsWith("chromium_headless_shell")).sort().at(-1) : null;
const b = await chromium.launch(shellDir && !fs.existsSync(chromium.executablePath()) ? { executablePath: `${shellRoot}/${shellDir}/chrome-headless-shell-mac-arm64/chrome-headless-shell` } : {}); const rows = []; const paraPages = new Map();
for (const w of [1440, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, isMobile: w === 390 }); const page = await ctx.newPage();
  for (const u of urls) {
    try { await page.goto(BASE + u, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(600); await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < Math.min(h, 40000); y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); }); await page.waitForTimeout(300);
      const m = await page.evaluate(measure); const r = rows.find((x) => x.page === u) ?? (rows.push({ page: u, type: typeOf(u), fail: [] }), rows.at(-1));
      if (w === 1440) { Object.assign(r, { h1440: m.H, words: m.words, secs: m.secs, cover: Math.round(m.cover * 100), gap: Math.round(m.gap), h1: m.h1, order: m.order }); r.req = m.req.filter((q) => !m.have[q]).join("|"); for (const t of new Set(m.paras)) { const k = t.slice(0, 160); paraPages.set(k, (paraPages.get(k) ?? new Set()).add(u)); } } else r.h390 = m.H;
    } catch (e) { rows.push({ page: u, type: typeOf(u), fail: [`load: ${String(e).slice(0, 60)}`] }); }
  }
  await ctx.close();
}
await b.close();
const dup = new Map(); for (const [k, set] of paraPages) if (set.size > 2) for (const p of set) if (!/^\/(legal|docs)/.test(p)) dup.set(p, (dup.get(p) ?? 0) + 1);
for (const r of rows) {
  const [h14, h39, words, secs] = TYPES[r.type] ?? TYPES.other; const f = r.fail;
  if (r.h1440 < h14) f.push(`height1440 ${r.h1440}<${h14}`); if (r.h390 < h39) f.push(`height390 ${r.h390}<${h39}`); if (r.words < words) f.push(`words ${r.words}<${words}`); if (r.secs < secs) f.push(`sections ${r.secs}<${secs}`);
  if (r.req) f.push(`missing ${r.req}`); if (r.gap > 320 && r.type !== "docs") f.push(`gap ${r.gap}px`); if (r.cover < 70 && !["docs", "legal", "legalShort"].includes(r.type)) f.push(`coverage ${r.cover}%`); if (dup.get(r.page)) f.push(`duplicate paragraphs ${dup.get(r.page)}`);
  if (r.h1 !== 1) f.push(`h1 count ${r.h1}`); if (r.order === false) f.push("heading order");
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, ["page,type,height1440,height390,words,sections,cover%,gap,failures", ...rows.map((r) => [r.page, r.type, r.h1440 ?? "", r.h390 ?? "", r.words ?? "", r.secs ?? "", r.cover ?? "", r.gap ?? "", `"${r.fail.join("; ")}"`].join(","))].join("\n"));
const bad = rows.filter((r) => r.fail.length);
console.log(`${rows.length} pages · ${bad.length} below the minimum · report: ${path.relative(process.cwd(), OUT)}`); for (const r of bad.slice(0, 40)) console.log(`  ${r.page} [${r.type}] ${r.fail.join("; ")}`);
if (ENFORCE && bad.length) process.exit(1);
