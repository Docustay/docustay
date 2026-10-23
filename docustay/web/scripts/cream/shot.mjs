// quick look: node scripts/cream/shot.mjs <url> <out.png> [width] [height-cap]
import { chromium } from "playwright";
const [url, out, w = "1440", cap = "4000"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: +w, height: 900 } });
await c.addCookies([{ name: "docustay-consent", value: "denied", url }]);
const p = await c.newPage(); await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(2500);
await p.evaluate(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < Math.min(H, 12000); y += innerHeight * .7) { scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 180)); } scrollTo({ top: 0, behavior: "instant" }); await new Promise((r) => setTimeout(r, 600)); });
const h = Math.min(+cap, await p.evaluate(() => document.documentElement.scrollHeight));
await p.screenshot({ path: out, fullPage: true, clip: { x: 0, y: 0, width: +w, height: h } }); await b.close();
