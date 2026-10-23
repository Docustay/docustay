import { chromium } from "playwright";
const base = process.argv[2], out = process.argv[3], paths = process.argv.slice(4);
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
await c.addCookies([{ name: "docustay-consent", value: "denied", url: base }]);
const p = await c.newPage();
for (const path of paths) {
  await p.goto(base + path, { waitUntil: "networkidle" }).catch(() => {}); await p.waitForTimeout(1500);
  await p.evaluate(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < Math.min(H, 12000); y += innerHeight * .7) { scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 150)); } scrollTo({ top: 0, behavior: "instant" }); await new Promise((r) => setTimeout(r, 500)); });
  const h = Math.min(5200, await p.evaluate(() => document.documentElement.scrollHeight));
  const f = `${out}/${(path.replace(/\//g, "_") || "_home")}.png`;
  await p.screenshot({ path: f, fullPage: true, clip: { x: 0, y: 0, width: 1440, height: h } });
}
await b.close();
