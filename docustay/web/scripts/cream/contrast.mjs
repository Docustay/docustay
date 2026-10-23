// Cream restyle proof (specs/SITE-CREAM-RESTYLE.md §6): every visible piece of text against the background it really sits on.
// node scripts/cream/contrast.mjs <base> <out.json> <path>... [--w=1440]
// The background is composited from the element up to the page (solid colours and the first stop of a gradient; text over a
// picture or a canvas is listed as "over-image" and checked by eye). Threshold: 4.5:1, or 3:1 at 24px and up (18.66px bold).
import fs from "node:fs";
import { chromium } from "playwright";
const args = process.argv.slice(2);
const w = +(args.find((a) => a.startsWith("--w="))?.slice(4) || 1440);
const [base, out, ...paths] = args.filter((a) => !a.startsWith("--"));
let b, p;
const open = async () => { b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] }); const c = await b.newContext({ viewport: { width: w, height: 900 } }); await c.addCookies([{ name: "docustay-consent", value: "denied", url: base }]); p = await c.newPage(); };
await open();
const report = {};
for (const path of paths) for (let attempt = 0; attempt < 3; attempt++) try {   // a crashed browser (WebGL in software) is relaunched and the page tried again
  await p.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await p.evaluate(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += innerHeight * .7) { scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 120)); } scrollTo({ top: 0, behavior: "instant" }); });
  await p.waitForTimeout(1800);
  report[path] = await p.evaluate(() => {
    const rgba = (s) => { const k = s.match(/color\(srgb ([^)]+)\)/); if (k) { const v = k[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; } const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
    const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
    const lin = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const L = (c) => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const out = { checked: 0, fails: [], overImage: 0 };
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("svg, canvas, script, style, noscript, [hidden]")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el); if (cs.visibility !== "visible" || cs.display === "none") continue;
      if (el.closest(".sr-only, .visually-hidden") || (cs.clip && cs.clip !== "auto" && cs.position === "absolute")) continue;
      let op = 1, layers = [], img = false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n); op *= +s.opacity;
        const clipText = /text/.test(s.backgroundClip + " " + (s.webkitBackgroundClip || ""));
        const bi = clipText ? "none" : s.backgroundImage;
        if (bi && bi !== "none") { if (/url\(/.test(bi) && !/gradient/.test(bi)) img = true; else { const m = bi.match(/rgba?\([^)]+\)/); if (m) { const g = rgba(m[0]); if (g && g[3] > .5) layers.push(g); } } }
        const bc = rgba(s.backgroundColor); if (bc && bc[3] > 0) layers.push(bc);
        if (n.tagName === "IMG" || n.tagName === "VIDEO") img = true;
      }
      if (op < .05) continue;
      let bg = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      if (img) { out.overImage++; continue; }
      let fg = rgba(cs.color);
      // gradient text: the fill is the gradient (its first stop), not the transparent colour
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (/text/.test(s.backgroundClip + " " + (s.webkitBackgroundClip || "")) && fg && fg[3] === 0) { const m = s.backgroundImage.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/); if (m) fg = rgba(m[0]); break; } }
      if (!fg) { out.unparsed = (out.unparsed || 0) + 1; continue; } fg = [fg[0], fg[1], fg[2], fg[3] * op]; const eff = over(fg, bg);
      const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, big = px >= 24 || (bold && px >= 18.66);
      const need = big ? 3 : 4.5, got = ratio(eff, bg);
      out.checked++;
      if (got + 1e-6 < need) {
        const key = `${el.tagName}.${String(el.className).split(" ")[0]}|${cs.color}|${bg.map(Math.round).join(",")}`;
        if (seen.has(key)) continue; seen.add(key);
        out.fails.push({ ratio: +got.toFixed(2), need, px, color: cs.color, opacity: +op.toFixed(2), bg: `rgb(${bg.slice(0, 3).map(Math.round).join(" ")})`, el: `${el.tagName.toLowerCase()}.${String(el.className).replace(/svelte-\w+/g, "").trim().replace(/\s+/g, ".")}`, text: el.textContent.trim().slice(0, 50) });
      }
    }
    return out;
  });
  const r = report[path]; console.log(path, "checked", r.checked, "fails", r.fails.length, "over-image", r.overImage);
  break;
} catch (e) { console.error("retry", path, e.message.split("\n")[0]); await b.close().catch(() => {}); await open(); }
fs.writeFileSync(out, JSON.stringify(report, null, 1));
await b.close();
