#!/usr/bin/env node
// Part 31 hero contrast gate. White text sits on the home film under a dark scrim, and a film changes every few seconds, so one screenshot proves nothing.
// For each of two viewports (desktop 1280x800, phone 390x844) this loads the page in Chrome and READS where the headline and the lede really are (so the check follows the layout instead of a copy of it), maps those boxes onto the film frames the way object-fit: cover does, takes a frame every 2 s of the real film file, applies the scrim's own gradient (read from src/app.css), and measures the 95th-percentile pixel behind each box. WCAG AA: 3:1 for large text (the headline), 4.5:1 for normal text (the lede, white at 90%). FAILS below that on any frame.
// Needs ffmpeg and Chrome through Playwright (test tools, never shipped).   BASE=<site url> node docustay/web/scripts/hero-contrast.mjs   (default http://127.0.0.1:5180)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { chromium } from "../../../node_modules/playwright/index.mjs";
const BASE = (process.env.BASE ?? "http://127.0.0.1:5180").replace(/\/$/, "");
const css = fs.readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
const stops = [...css.match(/--scrim:\s*linear-gradient\(180deg,([^;]+)\);/)[1].matchAll(/rgb\((\d+) (\d+) (\d+) \/ ([.\d]+)\)\s+(\d+)%/g)].map((m) => ({ rgb: [+m[1], +m[2], +m[3]], a: +m[4], at: +m[5] / 100 }));
if (stops.length < 2) throw new Error("could not read the scrim stops from src/app.css, so the check would measure nothing");
const scrimAt = (y) => { for (let i = 1; i < stops.length; i += 1) if (y <= stops[i].at) { const t = (y - stops[i - 1].at) / (stops[i].at - stops[i - 1].at); return { rgb: stops[i - 1].rgb.map((c, k) => c + (stops[i].rgb[k] - c) * t), a: stops[i - 1].a + (stops[i].a - stops[i - 1].a) * t }; } return stops.at(-1); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const W = 320, H = 180;
async function frames(file, fw, fh) { const r = spawnSync("ffmpeg", ["-v", "error", "-i", new URL(`../static/media/${file}`, import.meta.url).pathname, "-vf", `fps=1/2,scale=${fw}:${fh}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 512 * 1024 * 1024 }); if (r.status !== 0) throw new Error("ffmpeg failed: " + String(r.stderr).slice(0, 200)); const n = Math.floor(r.stdout.length / (fw * fh * 3)); if (n < 10) throw new Error(`only ${n} frames read from ${file}`); return { buf: r.stdout, n }; }
const browser = await chromium.launch({ channel: "chrome" });
let failed = 0;
for (const [name, vw, vh, film, fw, fh] of [["desktop", 1280, 800, "hero.mp4", 320, 180], ["phone", 390, 844, "hero-m.mp4", 320, 180]]) {
  const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
  await page.goto(BASE + "/"); await page.waitForTimeout(1500);
  const boxes = await page.evaluate(() => { const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, px: parseFloat(s.fontSize), bold: +s.fontWeight >= 700 }; }; return { h1: g(".copyin h1"), lede: g(".copyin p.mt-5") }; });
  if (!boxes.h1 || !boxes.lede) { console.log(`FAIL  ${name}: could not find the hero headline and lede on the page`); failed += 1; continue; }
  const { buf, n } = await frames(film, fw, fh), bytes = fw * fh * 3;
  const aspect = fw / fh, scale = Math.max(vw / aspect, vh) / 1, coverW = Math.max(vh * aspect, vw), coverH = Math.max(vw / aspect, vh), offX = (coverW - vw) / 2, offY = (coverH - vh) / 2;
  const toFrame = (vx, vy) => [Math.min(fw - 1, Math.max(0, Math.floor(((vx + offX) / coverW) * fw))), Math.min(fh - 1, Math.max(0, Math.floor(((vy + offY) / coverH) * fh)))];
  for (const [label, b, textL, need] of [["headline", boxes.h1, 1, (boxes.h1.px >= 24 || (boxes.h1.px >= 18.66 && boxes.h1.bold)) ? 3 : 4.5], ["lede", boxes.lede, lum(230, 230, 230), 4.5]]) {
    const [x0, y0] = toFrame(b.x, b.y), [x1, y1] = toFrame(b.x + b.w, b.y + b.h); let worst = { r: 99, f: -1 }, worstRaw = 99;
    for (let f = 0; f < n; f += 1) { const L = [], R = [];
      for (let y = y0; y <= y1; y += 1) { const s = scrimAt(Math.min(1, Math.max(0, (y / fh * coverH - offY) / vh))); for (let x = x0; x <= x1; x += 1) { const o = f * bytes + (y * fw + x) * 3; R.push(lum(buf[o], buf[o + 1], buf[o + 2])); L.push(lum(...[0, 1, 2].map((k) => buf[o + k] * (1 - s.a) + s.rgb[k] * s.a))); } }
      L.sort((a, c) => a - c); R.sort((a, c) => a - c); const r = (textL + 0.05) / (L[Math.floor(L.length * 0.95)] + 0.05), rr = (textL + 0.05) / (R[Math.floor(R.length * 0.95)] + 0.05); if (r < worst.r) worst = { r, f }; worstRaw = Math.min(worstRaw, rr); }
    const ok = worst.r >= need && worstRaw < worst.r;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${label}: worst frame ${worst.r.toFixed(2)}:1 at ${worst.f * 2} s (needs ${need}:1; the same frames with NO scrim: ${worstRaw.toFixed(2)}:1 — the control that the scrim is what is being measured)  [${n} frames, box ${Math.round(b.w)}x${Math.round(b.h)}, ${b.px}px]`);
    if (!ok) failed += 1;
  }
}
await browser.close(); console.log(failed ? `\nHERO CONTRAST FAIL (${failed})` : "\nHERO CONTRAST PASS"); process.exit(failed ? 1 : 0);
