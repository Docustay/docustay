// Cream proof: the reduced-motion and phone views keep the regenerated stills and posters (no live WebGL).
// node scripts/cream/reduced.mjs <base> <out-dir>
import { chromium } from "playwright";
const [base, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
for (const [name, opts] of [["reduced-1440", { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }], ["phone-390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }]]) {
  const c = await b.newContext(opts); await c.addCookies([{ name: "docustay-consent", value: "denied", url: base }]); const p = await c.newPage();
  for (const path of ["/", "/pricing", "/verify", "/self-host/requirements", "/templates/nda-template"]) {
    await p.goto(base + path, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
    const live = await p.evaluate(() => document.querySelectorAll("canvas").length);
    const imgs = await p.evaluate(() => [...document.querySelectorAll("img")].filter((i) => /\/(stills|3d)\//.test(i.currentSrc || i.src) && i.getBoundingClientRect().top < innerHeight).map((i) => (i.currentSrc || i.src).replace(/^.*\/(stills|3d)\//, "$1/")));
    console.log(name, path, "canvases", live, "stills above the fold", imgs.join(" "));
    await p.screenshot({ path: `${out}/${name}${path.replace(/\//g, "_") || "_home"}.png` });
  }
  await c.close();
}
await b.close();
