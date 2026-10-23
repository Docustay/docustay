// Cream restyle proof helper: load timing at phone size with 4x CPU throttling (LCP, CLS, total long-task time, bytes). Median of 3 runs.
// Usage: node scripts/cream/perf.mjs <base-url> <out.json>
import { chromium } from "playwright";
import fs from "node:fs";
const [base, out] = process.argv.slice(2);
const PAGES = ["/", "/pricing", "/docs/quickstart", "/templates/nda-template", "/developers"];
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const res = {};
for (const p of PAGES) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: "docustay-consent", value: "denied", url: base }]);
    const pg = await ctx.newPage(); const cdp = await ctx.newCDPSession(pg);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await pg.addInitScript(() => { window.__lcp = 0; window.__cls = 0; window.__lt = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true }); });
    await pg.goto(base + p, { waitUntil: "networkidle" }); await pg.waitForTimeout(3000);
    runs.push(await pg.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3), tbt: Math.round(window.__lt), kb: Math.round(performance.getEntriesByType("resource").reduce((s, r) => s + (r.transferSize || 0), 0) / 1024) })));
    await ctx.close();
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, c) => a - c)[1];
  res[p] = { lcp_ms: med("lcp"), cls: med("cls"), long_task_ms: med("tbt"), kb: med("kb") };
}
fs.writeFileSync(out, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res));
await b.close();
