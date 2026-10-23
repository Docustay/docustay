import { chromium } from "playwright"; import fs from "node:fs";
const root = `${process.env.HOME}/Library/Caches/ms-playwright`; const dir = fs.readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell")).sort().at(-1);
const b = await chromium.launch({ executablePath: `${root}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const urls = [...fs.readFileSync("static/sitemap.xml", "utf8").matchAll(/<loc>https:\/\/docustay\.app([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
const S = "https://host.example.com";
fs.writeFileSync("/tmp/rev2/list.txt", urls.join("\n"));
for (const [w, h, m, tag] of [[1440, 900, false, "d"], [390, 844, true, "m"]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: m, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "docustay-consent", value: "denied", url: S }]);
  const p = await ctx.newPage();
  for (const [i, u] of urls.entries()) {
    try { await p.goto(S + u, { waitUntil: "networkidle", timeout: 40000 }); await p.waitForTimeout(900);
      await p.screenshot({ path: `/tmp/rev2/${tag}-${String(i).padStart(3, "0")}-top.png` });
      if (!m) { await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(500); await p.screenshot({ path: `/tmp/rev2/${tag}-${String(i).padStart(3, "0")}-bot.png` }); }
    } catch (e) { console.log("fail", u, String(e).slice(0, 60)); }
  }
  await ctx.close();
}
await b.close();
