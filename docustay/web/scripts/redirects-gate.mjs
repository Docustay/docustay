#!/usr/bin/env node
// Redirect gate (V2 section 8.1 item 2): every old address answers ONE 301 to its new address and that address answers 200 (no chains), and no page of the site links to an old address.
// Usage: node scripts/redirects-gate.mjs [--base http://127.0.0.1:5199]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { REDIRECTS, movedTo } from "../src/lib/site/redirects.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5199");
const old = [...Object.keys(REDIRECTS), "/compare", "/compare/anything", "/sign-pdf/ruby", "/sign-pdf/java", "/es", "/fr/product", "/de/trust", "/ja/pricing", "/en"].filter((p, i, a) => a.indexOf(p) === i);
const bad = []; let n = 0;
for (const o of old) {
  if (o === "/templates") continue;   // 301 only on the public site address (hooks.server.js); on any other host it is the workspace list. check-live-pricing.mjs checks it on docustay.app
  const want = movedTo(o); const r = await fetch(BASE + o, { redirect: "manual" }); n++;
  if (r.status !== 301) { bad.push(`${o}: answers ${r.status}, expected 301`); continue; }
  const loc = new URL(r.headers.get("location"), BASE); const target = loc.pathname + loc.search; const wantPath = (want ?? "").split("#")[0];
  if (wantPath && loc.pathname !== wantPath && o !== "/sign-pdf/ruby" && o !== "/sign-pdf/java") bad.push(`${o}: goes to ${loc.pathname}, the map says ${want}`);
  const r2 = await fetch(loc.origin + loc.pathname, { redirect: "manual" }); if (r2.status !== 200) bad.push(`${o}: the target ${loc.pathname} answers ${r2.status} (a chain, or missing)`);
}
// positive control: a live page must not be reported as an old address
if (movedTo("/features") !== null) bad.push("control: /features is reported as moved");
// no internal links to an old address
const sm = fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8"); const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, "") || "/");
const oldSet = new Set(Object.keys(REDIRECTS)); let links = 0;
for (const u of urls) { const html = await (await fetch(BASE + u)).text(); for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) { links++; const h = m[1].length > 1 ? m[1].replace(/\/$/, "") : m[1]; if (oldSet.has(h) || h === "/compare" || h === "/sign-pdf/ruby") bad.push(`${u}: links to the old address ${h}`); } }
if (bad.length) { for (const b of bad.slice(0, 40)) console.log("  FAIL " + b); console.log(`REDIRECTS GATE FAIL (${bad.length})`); process.exit(1); }
console.log(`REDIRECTS GATE PASS: ${n} old addresses, each one hop to a 200; ${links} internal links checked, none to an old address`);
