#!/usr/bin/env node
// Screenshots every public route (desktop 1280 and phone 375, light; dark for the page-type representatives) into the ignored folder .design-shots/, for the design critique.
// Serves from a copy of the build (see preview.mjs). Not part of the build. node scripts/shoot-all.mjs [--only substring]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { routePaths, startPreview } from "./crawl-gate.mjs";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".design-shots"); fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const { port, stop } = await startPreview(); process.on("exit", stop);
const REPS = new Set(["/", "/product", "/use-cases/contracts", "/templates/nda-template", "/trust/security", "/pricing", "/docs/webhooks", "/verify", "/tools/signature-generator", "/contact", "/legal/terms", "/developers"]);
const paths = routePaths().filter((p) => !/\.(txt|xml|json|svg)$/.test(p) && (!only || p.includes(only)));
const b = await chromium.launch({ channel: "chrome" });
const rows = [];
for (const [tag, scheme, vw, vh] of [["d", "light", 1280, 800], ["m", "light", 375, 800], ["dk", "dark", 1280, 800]]) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, colorScheme: scheme }); const p = await ctx.newPage();
  for (const u of paths) {
    if (tag === "dk" && !REPS.has(u)) continue;
    const errors = []; p.removeAllListeners("pageerror"); p.on("pageerror", (e) => errors.push(String(e).slice(0, 100)));
    try { await p.goto(`http://127.0.0.1:${port}${u}`, { waitUntil: "load", timeout: 20000 }); await p.waitForTimeout(500);
      const m = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, anim: document.getAnimations().length, bg: getComputedStyle(document.body).backgroundColor }));
      await p.screenshot({ path: path.join(OUT, `${tag}${u.replace(/\//g, "_") || "_home"}.png`), fullPage: tag !== "dk" });
      rows.push({ path: u, view: tag, ...m, errors });
    } catch (e) { rows.push({ path: u, view: tag, error: String(e).slice(0, 100) }); }
  }
  await ctx.close();
}
await b.close(); stop();
fs.writeFileSync(path.join(OUT, "measures.json"), JSON.stringify(rows, null, 1));
console.log(`${rows.length} shots; overflow>0: ${rows.filter((r) => r.over > 0).length}; errors: ${rows.filter((r) => r.errors?.length || r.error).length}`);
