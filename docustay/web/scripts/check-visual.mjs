// Visual gate (V3, VISUAL-DIRECTION-V3 section 7). For every page of the sitemap at 1440 and 390:
//   - no sideways scroll, no console errors, no failed local requests
//   - GROUND (cream, 16 Oct 2026; specs/SITE-CREAM-RESTYLE.md): the page ground is the cream GROUND (palette.js), the same on every page; every area accent is at least 4.5:1 on it
//   - SHARPNESS: every raster image on the page is at least 1.8x its drawn width, measured in real pixels at 2x (SVG exempt)
//   - HERO VISUAL: a page that should have one (visuals/registry.js) has one, and no two pages of the same section share one
//   - MOTION BUDGET: at most ONE moving thing above the fold (running animations, a live canvas, a video)
//   - WEBGL: at most one live WebGL context on a page
//   - NO OVERLAP: the hero visual never covers text or code (bounding boxes, first two screens)
//   - ACCENT: the first eyebrow on the page is the colour of the page's area (palette.js)
// The dark-site WHITE WASH rule (a dark page may not be more than 12% light) is retired with the dark ground.
// The old rules (a live 3D scene on every page, animation and gradient minimums) are withdrawn.
// Usage: NODE_PATH=~/keystone/node_modules node scripts/check-visual.mjs --base http://127.0.0.1:5199 [--only /a,/b] [--out file.csv] [--enforce]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createRequire } from "node:module"; import { typeOf } from "./page-types.mjs";
import { heroIdFor, sectionOf } from "../src/lib/site/visuals/registry.js"; import { AREA, areaOf, GROUND } from "../src/lib/site/3d/palette.js";
const require = createRequire(import.meta.url); const { chromium } = require("playwright"); const { PNG } = require("pngjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5199"), ONLY = arg("--only", "")?.split(",").filter(Boolean), OUT = arg("--out", "/tmp/visual.csv"), ENFORCE = process.argv.includes("--enforce");
const MAX_WASH = 0.12;
const exe = process.env.CHROMIUM_PATH ?? ["1248", "1247"].map((v) => `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-${v}/chrome-headless-shell-mac-arm64/chrome-headless-shell`).find((f) => fs.existsSync(f));
const sm = fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8");
let urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, "") || "/");
if (ONLY.length) urls = urls.filter((u) => ONLY.includes(u));
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
// WCAG contrast of two hex colours
const relL = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [relL(a), relL(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const accentFails = Object.entries(AREA).filter(([, a]) => ratio(a.accent, GROUND) < 4.5).map(([k, a]) => `${k} accent ${a.accent} is ${ratio(a.accent, GROUND).toFixed(2)}:1 on ${GROUND}`);
if (accentFails.length) { console.log(`ACCENT CONTRAST FAIL: ${accentFails.join("; ")}`); if (ENFORCE) process.exit(1); } else console.log(`accent contrast: every area accent is at least 4.5:1 on ${GROUND} (lowest ${Math.min(...Object.values(AREA).map((a) => ratio(a.accent, GROUND))).toFixed(2)}:1)`);

// everything measured inside the page
const measure = (fold) => {
  const all = [...document.querySelectorAll("body *")], cs = (e) => getComputedStyle(e);
  const lum = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map(parseFloat); return { l: (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255, a: p.length > 3 ? p[3] : 1 }; };
  const bg = lum(cs(document.body).backgroundColor) ?? { l: 1, a: 0 }, hbg = lum(cs(document.documentElement).backgroundColor) ?? { l: 1, a: 0 };
  const base = bg.a > 0.5 ? bg : hbg;
  const vis = (e) => { const r = e.getBoundingClientRect(), s = cs(e); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
  const top = (e) => e.getBoundingClientRect().top + scrollY;
  // sharp: rasters drawn at least 40 px wide
  const cand = [...document.images].filter((i) => i.complete && i.naturalWidth && !/\.svg(\?|$)/i.test(i.currentSrc || i.src) && i.clientWidth >= 40 && i.naturalWidth < 1.8 * i.clientWidth).map((i) => ({ src: i.currentSrc || i.src, css: i.clientWidth }));
  // moving things above the fold: running animations whose target is on the first screen, live canvases, playing videos
  const movers = new Set();
  for (const a of document.getAnimations()) { if (a.playState !== "running") continue; const t = a.effect?.target; if (!t || !(t instanceof Element) || !vis(t)) continue; if (top(t) > fold) continue; const t2 = a.effect.getComputedTiming(); if (a.transitionProperty) continue; movers.add(((t.closest("[data-hero],.hero-d,.hero,header,[class]")?.getAttribute("class")) ?? t.tagName).split(" ")[0] || t.tagName); }
  for (const c of document.querySelectorAll("canvas[data-gl]")) if (vis(c) && top(c) < fold) movers.add("webgl");
  for (const v of document.querySelectorAll("video")) if (!v.paused && vis(v) && top(v) < fold) movers.add("video");
  // hero visual and overlap
  const heroEl = document.querySelector("[data-hero]") ?? document.querySelector(".hero-d");
  const heroId = document.querySelector("[data-hero]")?.getAttribute("data-hero") ?? (document.querySelector(".hero-d") ? "LIVE" : null);
  let overlap = null;
  if (heroEl && vis(heroEl)) {
    const hb = [...heroEl.querySelectorAll("img, svg, canvas, .v, .ex, .shelf, .sp")].filter(vis).map((e) => e.getBoundingClientRect()); if (heroEl.matches(".hero-d")) hb.push(heroEl.getBoundingClientRect());
    const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    outer: for (let n; (n = walker.nextNode());) { const e = n.parentElement; if (!e || !n.textContent.trim() || !vis(e) || e.closest("[data-hero],.hero-d,header,.dh,.consent,footer,script,style,[aria-hidden=true]")) continue; const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) { if (r.width < 3 || r.top + scrollY > fold * 2) continue; for (const h of hb) { const w = Math.min(h.right, r.right) - Math.max(h.left, r.left), ht = Math.min(h.bottom, r.bottom) - Math.max(h.top, r.top); if (w > 6 && ht > 6) { overlap = `${n.textContent.trim().slice(0, 30)} (${e.tagName.toLowerCase()})`; break outer; } } } }
  }
  const cr = document.querySelector(".d-crumbs"), hd = document.querySelector("header"); const crumbHidden = cr && hd && cr.getBoundingClientRect().top < hd.getBoundingClientRect().bottom - 1 ? Math.round(cr.getBoundingClientRect().top) : null;
  const eb = document.querySelector("main .d-eyebrow, .d-eyebrow"); const eyebrow = eb ? cs(eb).color : null;
  const ground = (() => { const d = document.querySelector(".desk"); const c = d ? cs(d).backgroundColor : (bg.a > 0.5 ? cs(document.body).backgroundColor : cs(document.documentElement).backgroundColor); return c; })();
  return { crumbHidden, cand, ground, dark: base.a > 0.5 && base.l < 0.25, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, height: document.documentElement.scrollHeight, movers: [...movers], heroId, overlap, eyebrow, webgl: window.__gl ?? 0 };
};
const hidePaper = () => { for (const e of document.querySelectorAll("body *")) { const m = getComputedStyle(e).backgroundColor.match(/rgba?\(([^)]+)\)/); if (!m) continue; const p = m[1].split(",").map(parseFloat); if ((p.length < 4 || p[3] > 0.85) && p[0] > 225 && p[1] > 225 && p[2] > 225) e.style.visibility = "hidden"; } };
const wash = (buf) => { const png = PNG.sync.read(buf); let n = 0, t = png.width * png.height; for (let i = 0; i < png.data.length; i += 4) if (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2] > 150) n++; return n / t; };

const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); const rows = [];
for (const w of [1440, 390]) {
  const H = w === 390 ? 844 : 900;
  const ctx = await b.newContext({ viewport: { width: w, height: H }, isMobile: w === 390, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { window.__gl = 0; const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) { window.__gl++; this.dataset.gl = '1'; } return g.call(this, t, ...a); }; });
  const page = await ctx.newPage(); let errs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|403|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 80)); });
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 80)));
  for (const u of urls) {
    errs = []; const r = rows.find((x) => x.page === u) ?? (rows.push({ page: u, type: typeOf(u), section: sectionOf(u), want: heroIdFor(u), fail: [] }), rows.at(-1));
    process.stderr.write(`${w} ${u}\n`);
    try {
      await page.goto(BASE + u, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(1600);
      await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 400)); });
      let m; for (let k = 0; k < 3; k++) { try { m = await page.evaluate(measure, H); break; } catch (e) { if (k === 2) throw e; await page.waitForTimeout(1200); } }
      // an image with srcset and sizes reports its width in CSS pixels, not its real pixels: measure the real file
      m.blurry = []; for (const c of m.cand) { const real = await page.evaluate(async (u) => { try { const bm = await createImageBitmap(await (await fetch(u)).blob()); return bm.width; } catch { return 0; } }, c.src); if (real && real < 1.8 * c.css) m.blurry.push(`${c.src.split("/").pop()} ${real}px for ${c.css}`); }
      r[`hero${w}`] = m.heroId; r[`movers${w}`] = m.movers.length; r.gl = Math.max(r.gl ?? 0, m.webgl);
      if (m.crumbHidden !== null && m.crumbHidden !== undefined) r.fail.push(`breadcrumb sits under the header (top ${m.crumbHidden}) at ${w}`);
      if (m.overflow > 1) r.fail.push(`sideways scroll ${m.overflow}px at ${w}`);
      if (m.blurry.length) r.fail.push(`soft image at ${w}: ${m.blurry[0]}`);
      if (m.movers.length > 1) r.fail.push(`${m.movers.length} moving things above the fold at ${w}: ${m.movers.join(", ")}`);
      if (m.webgl > 1) r.fail.push(`${m.webgl} WebGL contexts at ${w}`);
      if (w === 1440) {
        const want = r.want === "LIVE" ? "LIVE" : r.want;
        if (want && m.heroId !== want) r.fail.push(`hero visual is ${m.heroId ?? "missing"}, expected ${want}`);
        if (!want && m.heroId) r.fail.push(`has hero visual ${m.heroId} but the registry says none`);
        if (m.overlap) r.fail.push(`hero visual covers text: ${m.overlap}`);
        const ac = rgb(AREA[areaOf(u)].accent); if (m.eyebrow && m.eyebrow !== ac && !/^\/(docs|legal)/.test(u)) r.fail.push(`eyebrow ${m.eyebrow} is not the ${areaOf(u)} accent ${ac}`);
      }
      if (m.ground !== rgb(GROUND)) r.fail.push(`ground is ${m.ground}, not the cream ${GROUND} at ${w}`);
      if (m.dark) { await page.evaluate(hidePaper); const buf = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(m.height, H * 2) } }); const f = wash(buf); r[`wash${w}`] = Math.round(f * 1000) / 10; if (f > MAX_WASH) r.fail.push(`white wash ${Math.round(f * 100)}% at ${w}`); }
      if (errs.length) r.fail.push(`console: ${errs[0]}`);
    } catch (e) { r.fail.push(`load: ${String(e).slice(0, 60)}`); }
  }
  await ctx.close();
}
await b.close();
// no two pages of one section share a hero visual (the data-hero id; sign-pdf languages carry the language in the id)
const bySec = new Map(); for (const r of rows) { const id = r.hero1440; if (!id || id === "LIVE") continue; const key = `${r.section}|${id === "s-lang" ? id + ":" + r.page : id}`; (bySec.get(key) ?? bySec.set(key, []).get(key)).push(r); }
for (const [k, list] of bySec) if (list.length > 1) for (const r of list) r.fail.push(`hero visual ${k.split("|")[1]} is shared by ${list.map((x) => x.page).join(", ")}`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, ["page,section,hero,movers1440,webgl,wash1440,wash390,failures", ...rows.map((r) => [r.page, r.section, r.hero1440 ?? "", r.movers1440 ?? "", r.gl ?? "", r.wash1440 ?? "light", r.wash390 ?? "light", `"${r.fail.join("; ")}"`].join(","))].join("\n") + "\n");
const bad = rows.filter((r) => r.fail.length); console.log(`${rows.length} pages · ${bad.length} failing · report: ${OUT}`);
for (const r of bad.slice(0, 60)) console.log(`  ${r.page} [${r.type}] ${r.fail.join("; ")}`);
if (ENFORCE && bad.length) process.exit(1);
