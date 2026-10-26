#!/usr/bin/env node
// Writes src/lib/site/forms.gen.json from the island's thirty form templates (src/documents/starters/forms.mjs), so the website's /form-templates pages describe exactly the sections,
// fields, people and Publish defaults the app creates. Fields are read with the product's own tag parser. `--check` fails when the file is stale (check:site runs it).
import fs from "node:fs";
import { FORM_STARTERS, FORM_CATEGORIES } from "../../../src/documents/starters/index.mjs";
import { findTags } from "../../../src/documents/textTags.mjs";
import { fingerprint } from "../../../src/documents/starters/fingerprint.mjs";
const manifest = JSON.parse(fs.readFileSync(new URL("../starters/manifest.json", import.meta.url), "utf8"));   // the printed form of each template (scripts/starters/render-all.mjs): its pages and where every field sits

const OUT = new URL("../src/lib/site/forms.gen.json", import.meta.url);
const INDEX = new URL("../src/lib/site/forms.index.json", import.meta.url);   // small: sign-up carries a chosen form through with this, not the whole file
const TYPE = { text: "text", number: "number", date: "date", checkbox: "tick box", dropdown: "choice", multiselect: "choose any", file: "file (PDF or picture)", signature: "signature", date_signed: "date signed" };
const word = (sp) => sp.validation === "email" ? "email" : sp.validation === "phone" ? "phone" : sp.validation === "zip" ? "postal code" : (TYPE[sp.type] ?? sp.type);
const unesc = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").trim();
const gen = FORM_STARTERS.map((s) => {
  const sections = []; let cur = null; const roles = [];
  // walk the HTML in order: an <h2> opens a section, each tag lands in the open one
  for (const m of s.html.matchAll(/<h2>([^<]+)<\/h2>|\{\{[^{}]+\}\}/g)) {
    if (m[1]) { cur = { heading: unesc(m[1]), fields: [] }; sections.push(cur); continue; }
    const [t] = findTags(m[0]); const p = t?.parsed; if (!p || p.error) throw new Error(`${s.slug}: ${p?.error ?? "unreadable tag"}`);
    if (!roles.includes(p.role)) roles.push(p.role);
    if (!cur) { cur = { heading: "Before you start", fields: [] }; sections.push(cur); }
    cur.fields.push({ label: p.spec.label ?? p.name, type: word(p.spec), role: p.role, required: p.spec.required !== false, ...(p.spec.tooltip ? { help: p.spec.tooltip } : {}), ...(p.spec.options ? { options: p.spec.options } : {}), ...(p.spec.max_length ? { max: p.spec.max_length } : {}) });
  }
  const consent = [...s.html.matchAll(/<p class="fr">\{\{[^{}]*type=checkbox[^{}]*\}\}&nbsp; ([^<]+)<\/p>/g)].map((m) => unesc(m[1]));
  const all = sections.flatMap((x) => x.fields), filled = all.filter((f) => f.role === roles[0]), counterFields = all.length - filled.length;   // ★ P10-B-8: ONE count everywhere: the boxes the person filling it fills (their signature and date included); the counter-signer's are said separately
  const pr = manifest[s.slug];
  if (!pr || pr.sha !== fingerprint(s)) throw new Error(`${s.slug}: its printed form is missing or out of date. Run: KEYSTONE_GOTENBERG_URL=http://127.0.0.1:13001 node scripts/starters/render-all.mjs`);
  const seatLabel = Object.fromEntries(pr.roles.map((r) => [r.key, r.label]));
  return { slug: s.slug, title: s.title, pages: pr.pages, seats: pr.roles.map((r) => ({ role: r.label, seat: r.key })), pageFields: pr.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, role: seatLabel[f.role] ?? f.role, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })), use: s.use, summary: s.summary, who: s.who, purpose: s.purpose, intro: s.intro, roles, counterSign: roles.length > 1, publish: s.publish,
    sections: sections.filter((x) => x.fields.length), consent, fieldCount: filled.length, counterFields, required: filled.filter((f) => f.required).length, minutes: Math.max(2, Math.round(filled.length * 0.25)) };
});
const json = JSON.stringify({ categories: FORM_CATEGORIES, forms: gen }, null, 1) + "\n";
const index = JSON.stringify(gen.map((f) => ({ slug: f.slug, title: f.title, fields: f.fieldCount, kind: "form" }))) + "\n";
const read = (u) => (fs.existsSync(u) ? fs.readFileSync(u, "utf8") : "");
if (process.argv.includes("--check")) { if (read(OUT) !== json || read(INDEX) !== index) { console.error("forms.gen.json is stale: run node docustay/web/scripts/build-forms.mjs"); process.exit(1); } console.log(`FORMS GEN PASS (${gen.length})`); }
else { fs.writeFileSync(OUT, json); fs.writeFileSync(INDEX, index); console.log(`wrote ${gen.length} forms`); }
