// Cream restyle proof helper (Dashboard, 16 Oct 2026): capture every page's WORDS (for a word-for-word diff) and screenshots of each page type.
// Usage: node scripts/cream/capture.mjs <base-url> <out-dir> [--shots]
import { chromium } from "playwright";
import fs from "node:fs";
const [base, out] = process.argv.slice(2), shots = process.argv.includes("--shots");
fs.mkdirSync(`${out}/shots`, { recursive: true });
const xml = await (await fetch(`${base}/sitemap.xml`)).text();
const paths = [...xml.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
paths.push("/this-page-does-not-exist");
// page types: the first page and one deeper page of every top-level section
const seen = {}, types = [];
for (const p of paths) { const k = p.split("/")[1] || "home"; seen[k] = (seen[k] ?? 0) + 1; if (seen[k] <= (k === "home" ? 1 : 2)) types.push(p); }
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "docustay-consent", value: "denied", url: base }]);
const page = await ctx.newPage();
const text = {};
for (const p of (process.argv.includes("--shots-only") ? [] : paths)) {
  await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => {});
  text[p] = await page.evaluate(() => {
    const meta = [...document.querySelectorAll("meta[name=description],meta[property^='og:title'],meta[property^='og:description'],meta[name^='twitter:title'],meta[name^='twitter:description']")].map((m) => `${m.getAttribute("name") || m.getAttribute("property")}: ${m.content}`);
    const attrs = [...document.querySelectorAll("[alt],[aria-label],[title],[placeholder]")].flatMap((e) => ["alt", "aria-label", "title", "placeholder"].filter((a) => e.hasAttribute(a) && e.tagName !== "TITLE").map((a) => `${a}: ${e.getAttribute(a)}`));
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    return { title: document.title, meta, attrs: attrs.map(norm), body: document.body.innerText.split("\n").map(norm).filter(Boolean) };
  });
}
if (Object.keys(text).length) fs.writeFileSync(`${out}/text.json`, JSON.stringify(text, null, 1));
console.log("pages", paths.length, "types", types.length);
if (shots) for (const [w, h] of [[1440, 900], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await c.addCookies([{ name: "docustay-consent", value: "denied", url: base }]);
  const pg = await c.newPage();
  for (const p of types) {
    await pg.goto(base + p, { waitUntil: "networkidle" }).catch(() => {}); await pg.waitForTimeout(2500);
    await pg.evaluate(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < Math.min(H, 12000); y += innerHeight * .7) { scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 180)); } scrollTo({ top: 0, behavior: "instant" }); await new Promise((r) => setTimeout(r, 600)); }); // fire every scroll reveal first
    const hgt = Math.min(12000, await pg.evaluate(() => document.documentElement.scrollHeight));
    try { await pg.screenshot({ path: `${out}/shots/${w}-${(p.replace(/\//g, "_") || "_home").replace(/^_$/, "_home")}.png`, fullPage: true, clip: { x: 0, y: 0, width: w, height: hgt } }); }
    catch (e) { console.log("shot failed", w, p, e.message.split("\n")[0]); }
  }
  await c.close();
}
await b.close();
