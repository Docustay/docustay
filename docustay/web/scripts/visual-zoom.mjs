#!/usr/bin/env node
// 2x close-ups for the visual review: the header, the hero (first screen) and the footer of a page, at a given width.   node scripts/visual-zoom.mjs --base URL --out DIR --page /pricing --width 1440 [--theme light]
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path";
const pw = createRequire("~/keystone/package.json")("playwright");
const a = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const base = a("base", "http://127.0.0.1:5190"), out = a("out", "."), page0 = a("page", "/"), width = +a("width", 1440), theme = a("theme", "light"); fs.mkdirSync(out, { recursive: true });
const b = await pw.chromium.launch(); const ctx = await b.newContext({ viewport: { width, height: width > 700 ? 900 : 844 }, deviceScaleFactor: 2, colorScheme: theme }); const p = await ctx.newPage();
await p.goto(base + page0, { waitUntil: "load" }); await p.waitForTimeout(1500);
await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 500)); });
const tag = (page0 === "/" ? "home" : page0.slice(1).replace(/\W+/g, "-")) + "-" + width; const H = await p.evaluate(() => document.documentElement.scrollHeight);
const clip = (name, y, h) => p.screenshot({ path: path.join(out, `${tag}.${name}.jpg`), type: "jpeg", quality: 85, fullPage: true, clip: { x: 0, y, width, height: Math.min(h, H - y) } });
await clip("zoom-header", 0, 90); await clip("zoom-hero", 0, width > 700 ? 560 : 640); await clip("zoom-footer", Math.max(0, H - 520), 520); console.log(tag, "zoom files written to", out); await b.close();
