#!/usr/bin/env node
// Part 31 proof: for one page of each type, (1) with reduced motion nothing is hidden or still moving, (2) the whole page can be used from the keyboard.
//   node docustay/web/scripts/motion-keyboard-proof.mjs [base]     default http://127.0.0.1:5190   (needs `npm run preview`)
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5190";
const PAGES = ["/", "/pricing", "/product", "/use-cases", "/use-cases/contracts", "/trust", "/trust/security", "/developers", "/docs/api-reference", "/document-templates", "/templates/nda-template", "/verify", "/tools/signature-generator", "/contact", "/about", "/login", "/es"];
const b = await chromium.launch({ channel: "chrome" }); let bad = 0;
for (const u of PAGES) {
  // --- reduced motion
  const rc = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" }); const rp = await rc.newPage();
  await rp.goto(BASE + u, { waitUntil: "load" }); await rp.waitForTimeout(500);
  const rm = await rp.evaluate(async () => {
    const hidden = []; for (const e of document.querySelectorAll("main *, header *, footer *")) { const s = getComputedStyle(e); if (e.closest("[aria-hidden=true], details:not([open]), .sr-only, [hidden]")) continue; if (+s.opacity === 0 && e.textContent.trim().length > 2 && s.display !== "none" && s.visibility !== "hidden") hidden.push(e.tagName + "." + String(e.className).slice(0, 30)); }
    const running = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity).length;
    const video = [...document.querySelectorAll("video")].filter((v) => !v.paused).length;
    return { hidden: hidden.slice(0, 3), running, video };
  });
  await rc.close();
  // --- keyboard
  const kc = await b.newContext({ viewport: { width: 1280, height: 800 } }); const kp = await kc.newPage();
  await kp.goto(BASE + u, { waitUntil: "load" }); await kp.waitForTimeout(400);
  const seen = new Set(); let noRing = 0, trapped = false, first = null;
  for (let i = 0; i < 60; i += 1) {
    await kp.keyboard.press("Tab");
    const f = await kp.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none"; return { k: e.tagName + "|" + (e.getAttribute("href") ?? "") + "|" + (e.getAttribute("aria-label") ?? "") + "|" + e.textContent.trim().slice(0, 30) + "|" + e.id, ring, onscreen: e.getBoundingClientRect().bottom > -2 }; });
    if (!f) continue; if (first === null) first = f.k; if (!f.ring) noRing += 1; if (seen.has(f.k) && seen.size > 3) { trapped = seen.size < 6; break; } seen.add(f.k);
  }
  await kc.close();
  const ok = rm.hidden.length === 0 && rm.running === 0 && rm.video === 0 && noRing === 0 && seen.size >= 5 && !trapped;
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${u.padEnd(30)} reduced: hidden=${rm.hidden.length}${rm.hidden.length ? " " + rm.hidden.join(",") : ""} loops=${rm.running} video=${rm.video} | keyboard: stops=${seen.size} noFocusRing=${noRing} trapped=${trapped}`);
}
await b.close(); console.log(bad ? `FAIL: ${bad} pages` : `PASS: ${PAGES.length} pages`); process.exit(bad ? 1 : 0);
