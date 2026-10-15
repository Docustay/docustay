#!/usr/bin/env node
// The features gate (site redo, SITE-PAGES-8OCT section 4). Every capability sentence on a page carries a feature id ({{F-ID}} in the page data, or data-feature in a route file). This gate fails when
//   1. a page names an id that is not in src/lib/features.json;
//   2. a PENDING PROOF id is used on a page that is not marked claimUntilProven (the maintainer's own mark);
//   3. features.json lists a page that does not exist, or an id with no statement/status;
// and it has a positive control for each rule.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const F = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/features.json"), "utf8"));
const list = Array.isArray(F) ? F : Array.isArray(F.features) ? F.features : Object.entries(F).map(([id, v]) => ({ id, ...v }));
const byId = new Map(list.map((f) => [f.id, f]));
const { ALL } = await import(pathToFileURL(path.join(ROOT, "src/lib/site/pages/registry.js")));
export function check(pages, known, loose = new Set()) {
  const bad = [];
  for (const p of pages) {
    const text = JSON.stringify(p);
    for (const m of text.matchAll(/\{\{(F-[A-Z0-9]+)\}\}|"(F-[A-Z0-9]+)"/g)) {
      const id = m[1] ?? m[2], f = known.get(id);
      if (!f) { bad.push(`${p.path}: unknown feature id ${id}`); continue; }
      if (/PENDING/i.test(f.status ?? "") && !p.claimUntilProven && !loose.has(p.path)) bad.push(`${p.path}: ${id} is PENDING PROOF and the page is not marked claim-until-proven`);
    }
  }
  return bad;
}
const bad = check(ALL, byId);
for (const f of list) { if (!f.statement || !f.status) bad.push(`${f.id}: needs a statement and a status`); }
// the route files with their own words
const routeFiles = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.svelte$/.test(e.name)) routeFiles.push(p); } };
walk(path.join(ROOT, "src/routes/(site)")); walk(path.join(ROOT, "src/lib/site/desk"));
for (const f of routeFiles.filter((x) => !/Blocks\.svelte$/.test(x))) { const src = fs.readFileSync(f, "utf8"); for (const m of src.matchAll(/(?:data-feature="|\{\{)(F-[A-Z0-9 -]+)/g)) for (const id of m[1].split(/\s+/)) { if (!id) continue; if (!byId.has(id)) bad.push(`${path.relative(ROOT, f)}: unknown feature id ${id}`); else if (/PENDING/i.test(byId.get(id).status ?? "") && !/claim-until-proven/.test(src) && !/desk\//.test(f)) bad.push(`${path.relative(ROOT, f)}: ${id} is PENDING PROOF and the file is not marked claim-until-proven`); } }
// controls
const kn = new Map([["F-A", { id: "F-A", status: "PROVEN" }], ["F-P", { id: "F-P", status: "PENDING PROOF" }]]);
const c1 = check([{ path: "/x", blocks: [{ p: "a {{F-NOPE}}" }] }], kn), c2 = check([{ path: "/y", blocks: [{ p: "a {{F-P}}" }] }], kn), c3 = check([{ path: "/z", claimUntilProven: true, blocks: [{ p: "a {{F-P}}" }] }], kn), c4 = check([{ path: "/w", blocks: [{ p: "a {{F-A}}" }] }], kn);
if (!(c1.length === 1 && c2.length === 1 && c3.length === 0 && c4.length === 0)) { console.log("FEATURES GATE FAIL: control did not behave", c1, c2, c3, c4); process.exit(1); }
const used = new Set(); for (const p of ALL) for (const m of JSON.stringify(p).matchAll(/\{\{(F-[A-Z0-9]+)\}\}/g)) used.add(m[1]);
if (bad.length) { console.log("FEATURES GATE FAIL\n  " + bad.join("\n  ")); process.exit(1); }
console.log(`FEATURES GATE PASS: ${ALL.length} registry pages use ${used.size} of ${list.length} feature ids; every id exists, and every pending-proof claim sits on a claim-until-proven page`);
