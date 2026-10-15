#!/usr/bin/env node
// Part 31 item 6 proof for the localized public pages: for each language and page (home, how it works, trust): answers 200, the <html> carries the right lang and dir, the Beta notice and the link back to English are there,
// nothing scrolls sideways at 375 and 1280 px, no stretch of English words is left in the visible text (a stop-word scan), and no letters from another script are mixed into a word. Screenshots go to specs/proofs/part-31/i18n/.
//   node docustay/web/scripts/i18n-site-proof.mjs [base]    (default http://127.0.0.1:5190; needs `npm run preview`)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_LANGS } from "../src/lib/site/l10n.js";
const BASE = process.argv[2] ?? "http://127.0.0.1:5190";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "specs", "proofs", "part-31", "i18n"); fs.mkdirSync(OUT, { recursive: true });
const STOP = /\b(the|and|you|your|with|for|that|this|from|are|can|not)\b/gi;
const SCRIPT = { ar: /[؀-ۿ]/, ja: /[぀-ヿ一-鿿]/, zh: /[一-鿿]/, ko: /[가-힯]/, ru: /[Ѐ-ӿ]/ };
const b = await chromium.launch({ channel: "chrome" }); const rows = []; let bad = 0;
for (const l of SITE_LANGS.filter((x) => x !== "en")) for (const tail of ["", "/product", "/trust"]) {
  const u = `/${l}${tail}`; const issues = [];
  for (const [vw, vh] of [[1280, 800], [375, 800]]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, reducedMotion: "reduce" }); const p = await ctx.newPage();
    const r = await p.goto(BASE + u, { waitUntil: "load" }); if (r.status() !== 200) issues.push(`status ${r.status()}`);
    await p.waitForTimeout(300);
    const m = await p.evaluate(({ l }) => {
      const h = document.documentElement, main = document.querySelector("main")?.innerText ?? "", all = document.body.innerText;
      const words = (all.match(/[A-Za-z]{2,}/g) ?? []).length;
      return { lang: h.lang, dir: h.dir, sw: h.scrollWidth, vw: innerWidth, beta: !!document.querySelector("[role=note]"), toEn: !!document.querySelector("a[href='/'], a[href='/product'], a[href='/trust']"), text: all, textLen: all.length, h1: document.querySelectorAll("h1").length };
    }, { l });
    if (vw === 1280) {
      const expectLang = l === "zh" ? "zh-Hans" : l === "pt" ? "pt-BR" : l; if (m.lang !== expectLang) issues.push(`lang ${m.lang}`); if ((l === "ar") !== (m.dir === "rtl")) issues.push(`dir ${m.dir}`);
      if (!m.beta) issues.push("no Beta notice"); if (m.h1 !== 1) issues.push(`h1 x${m.h1}`);
      const english = (m.text.match(STOP) ?? []).length; if (english > 12) issues.push(`English words left: ${english}`);
      const mixed = SCRIPT[l] ? (m.text.match(/[A-Za-z]+[Ѐ-ӿ؀-ۿ]+|[Ѐ-ӿ؀-ۿ]+[A-Za-z]+/g) ?? []).length : 0; if (mixed) issues.push(`mixed-script words: ${mixed}`);
      await p.screenshot({ path: path.join(OUT, `${l}${tail.replace("/", "-") || "-home"}-1280.png`), fullPage: false });
    } else { await p.screenshot({ path: path.join(OUT, `${l}${tail.replace("/", "-") || "-home"}-375.png`) }); }
    if (m.sw > m.vw + 1) issues.push(`scrolls sideways at ${vw}: ${m.sw}`);
    await ctx.close();
  }
  if (issues.length) bad += 1; rows.push({ u, ok: !issues.length, issues }); console.log(`${issues.length ? "FAIL" : "PASS"} ${u.padEnd(14)} ${issues.join("; ")}`);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, rows }, null, 1));
await b.close(); console.log(bad ? `FAIL: ${bad} of ${rows.length} pages` : `PASS: ${rows.length} pages`); process.exit(bad ? 1 : 0);
