// axe-core (WCAG 2 A/AA, 2.1 AA) at 1440 and 390, plus the sideways-scroll scan at 320, 390 and 768, over every page of the sitemap.
// Usage: NODE_PATH=~/keystone/node_modules node scripts/check-a11y.mjs --base http://127.0.0.1:5199 [--only /a,/b] [--enforce]
import { chromium } from "playwright";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5199"), ONLY = arg("--only", "").split(",").filter(Boolean), ENFORCE = process.argv.includes("--enforce");
const urls = ONLY.length ? ONLY : [...fs.readFileSync(new URL("../static/sitemap.xml", import.meta.url), "utf8").matchAll(/<loc>https:\/\/docustay\.app([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
const root = `${process.env.HOME}/Library/Caches/ms-playwright`;
const dir = fs.readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell")).sort().at(-1);
const b = await chromium.launch({ executablePath: `${root}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell` });
const bad = [];
for (const w of [1440, 768, 390, 320]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 500 });
  const page = await ctx.newPage();
  for (const u of urls) {
    process.stderr.write(`${w} ${u}\n`);
    try {
      await page.goto(BASE + u, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(700);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) bad.push(`${u} @${w}: sideways scroll ${over}px`);
      if (w === 1440 || w === 390) {
        await page.evaluate(axeSrc);
        const r = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ").slice(0, 70)}`));
        for (const v of r) bad.push(`${u} @${w}: ${v}`);
      }
    } catch (e) { bad.push(`${u} @${w}: load ${String(e).slice(0, 60)}`); }
  }
  await ctx.close();
}
await b.close();
console.log(`${urls.length} pages, 4 widths: ${bad.length} findings`); for (const x of bad.slice(0, 80)) console.log("  " + x);
if (ENFORCE && bad.length) process.exit(1);
