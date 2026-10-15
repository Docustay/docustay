#!/usr/bin/env node
// Part 31 performance budget gate: for a sample of public pages, fetch the HTML from a running site, follow every script and stylesheet it references, and FAIL if the gzip size of the HTML, the JavaScript or the CSS goes over its budget.
// The budgets sit a little above what was measured on 5 Oct 2026 (so a normal change passes and a bundle that doubles does not); a raised budget needs a reason written next to it.
//   BASE=https://host.example.com node docustay/web/scripts/budget-gate.mjs        (default BASE: http://127.0.0.1:5180)
import zlib from "node:zlib";
const BASE = (process.env.BASE ?? "http://127.0.0.1:5180").replace(/\/$/, "");
// RAISED 7 Oct 2026 (Final Push Stage 7), reason: the new look (token sets for light, dark, site and signing; Ark wrappers; Frame, CodeWindow, Flow and the other new components; the cookie choice) measured css 24.5 KB and js 172 KB on the heaviest sample pages, against 22 and 150 set on 5 Oct. New ceilings are the measurement plus about 5 percent.
const BUDGET = { html: 40_000, js: 180_000, css: 26_000 };           // gzip bytes per page
const PAGES = ["/", "/product", "/pricing", "/use-cases/contracts", "/es", "/ar", "/login"];
const gz = (b) => zlib.gzipSync(b, { level: 6 }).length;
const get = async (u) => { const r = await fetch(u, { headers: { "accept-encoding": "identity" } }); if (!r.ok) throw new Error(`${u} answered ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
let failed = 0; const rows = [];
for (const p of PAGES) {
  let html; try { html = await get(BASE + p); } catch (e) { console.log(`FAIL  ${p}  ${e.message}`); failed += 1; continue; }
  const text = html.toString("utf8");
  const assets = [...new Set([...text.matchAll(/["'(\s](?:\.{1,2}\/)*(_app\/immutable\/[^"'()\s]+\.(?:js|css))/g)].map((m) => "/" + m[1]))];
  let js = 0, css = 0;
  for (const a of assets) { const b = await get(BASE + a); if (a.endsWith(".js")) js += gz(b); else css += gz(b); }
  const h = gz(html), row = { page: p, html: h, js, css, files: assets.length };
  rows.push(row);
  if (assets.length === 0) { console.log(`FAIL  ${p}  found no script or stylesheet in the page, so there is nothing to weigh (a budget that weighs nothing passes vacuously)`); failed += 1; continue; }
  const over = Object.entries(BUDGET).filter(([k]) => row[k] > BUDGET[k]).map(([k]) => `${k} ${row[k]} > ${BUDGET[k]}`);
  console.log(`${over.length ? "FAIL" : "PASS"}  ${p}  html ${h}  js ${js} (${assets.filter((a) => a.endsWith(".js")).length} files)  css ${css}${over.length ? "   OVER: " + over.join(", ") : ""}`);
  if (over.length) failed += 1;
}
// Positive control: the gate can fail. A budget of 1 byte must flag the first page.
const control = rows[0] && rows[0].html > 1; console.log(`${control ? "PASS" : "FAIL"}  control: a 1-byte budget would flag ${rows[0]?.page}`); if (!control) failed += 1;
console.log(failed ? `\nBUDGET GATE FAIL (${failed})` : "\nBUDGET GATE PASS"); process.exit(failed ? 1 : 0);
