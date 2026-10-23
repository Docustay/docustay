#!/usr/bin/env node
// THE TEMPLATE LINKS GATE (V1 redo, 20 Oct 2026): every built-in template (the 24 documents and the 30 forms) must have a printed form, a thumbnail, every page picture, its field map and a
// website address that is not a 404 — and nothing in the app may open a template's raw picture or a retired /form-templates/ address in a new tab.
//   node scripts/template-links-gate.mjs                 files and source (no network; part of check:site)
//   node scripts/template-links-gate.mjs --base URL      also asks the running site for every address (use it after a deploy)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STARTERS, FORM_STARTERS } from "../../../src/documents/starters/index.mjs";
import { fingerprint } from "../../../src/documents/starters/fingerprint.mjs";
import { TEMPLATES } from "../src/lib/site/pages/templates.js";
import { FORMS } from "../src/lib/site/pages/formTemplates.js";
import { movedTo } from "../src/lib/site/redirects.js";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, "..");
const baseArg = process.argv.indexOf("--base"), BASE = baseArg > 0 ? process.argv[baseArg + 1].replace(/\/+$/, "") : null;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "starters", "manifest.json"), "utf8"));
const bad = []; let checked = 0;
const all = [...STARTERS, ...FORM_STARTERS];
const siteAddress = (slug) => (FORMS.some((f) => f.slug === slug) ? `/templates/${slug}` : TEMPLATES.find((t) => t.old === slug) ? `/templates/${TEMPLATES.find((t) => t.old === slug).slug}` : null);
const known = (p) => TEMPLATES.some((t) => `/templates/${t.slug}` === p) || FORMS.some((f) => `/templates/${f.slug}` === p) || ["/free-templates", "/"].includes(p);
for (const s of all) {
  const m = manifest[s.slug];
  if (!m) { bad.push(`${s.slug}: no printed form in starters/manifest.json (run scripts/starters/render-all.mjs)`); continue; }
  if (m.sha !== fingerprint(s)) bad.push(`${s.slug}: its printed form is out of date (the template changed)`);
  if (!fs.existsSync(path.join(ROOT, "starters", `${s.slug}.pdf`))) bad.push(`${s.slug}: starters/${s.slug}.pdf is missing`);
  // the address a person gets for the library's own name for it: a page, or one redirect hop to a page
  const direct = siteAddress(s.slug), moved = movedTo(`/templates/${s.slug}`);
  const landing = direct && known(`/templates/${s.slug}`) ? `/templates/${s.slug}` : moved;
  if (!landing || !known(landing.replace(/#.*$/, ""))) bad.push(`${s.slug}: /templates/${s.slug} goes nowhere (no website page and no redirect to one)`);
  const dir = path.join(ROOT, "static", "starters", s.slug);
  if (fs.existsSync(path.join(ROOT, "static", "starters"))) {
    for (const f of ["meta.json", ...Array.from({ length: m.pages }, (_, i) => [`p${i + 1}-sm.webp`, `p${i + 1}-lg.webp`, `p${i + 1}-sm.jpg`, `p${i + 1}-lg.jpg`]).flat()]) if (!fs.existsSync(path.join(dir, f))) bad.push(`${s.slug}: static/starters/${s.slug}/${f} is missing (run node scripts/build-starter-images.mjs)`);
  }
  checked += 1;
}
// source: the app must not open a raw page picture or a retired address, and a tile's Preview must not be a new tab
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(path.join(ROOT, "src")).filter((x) => /\.(svelte|js)$/.test(x))) {
  const src = fs.readFileSync(f, "utf8"), rel = path.relative(ROOT, f);
  if (/redirects\.js$/.test(rel)) continue;
  if (/["'`]\/form-templates\//.test(src)) bad.push(`${rel}: links to the retired /form-templates/ address`);
  if (/href=\{?[`"'][^>]*\/starters\/[^>]*p\d+-lg/.test(src) && /target=["']_blank/.test(src.match(/<a[^>]*\/starters\/[^>]*>/)?.[0] ?? "")) bad.push(`${rel}: opens a template's raw page picture in a new tab (use the in-app Preview)`);
}
// the running site
if (BASE) {
  const get = async (p) => { const r = await fetch(BASE + p, { redirect: "manual" }); if (r.status >= 300 && r.status < 400) { const to = r.headers.get("location") ?? ""; const r2 = await fetch(new URL(to, BASE + p), { redirect: "manual" }); return r2.status; } return r.status; };
  for (const s of all) {
    const m = manifest[s.slug]; if (!m) continue;
    const paths = [`/templates/${s.slug}`, `/starters/${s.slug}/meta.json`, ...Array.from({ length: m.pages }, (_, i) => [`/starters/${s.slug}/p${i + 1}-sm.webp`, `/starters/${s.slug}/p${i + 1}-lg.webp`]).flat()];
    for (const p of paths) { const code = await get(p); checked += 1; if (code !== 200) bad.push(`${BASE}${p} answered ${code}`); }
  }
}
if (bad.length) { console.error(`TEMPLATE LINKS GATE FAIL (${bad.length}):\n  ${bad.slice(0, 40).join("\n  ")}`); process.exit(1); }
console.log(`TEMPLATE LINKS GATE PASS: ${all.length} templates, ${checked} checks${BASE ? ` (site ${BASE})` : ""}`);
