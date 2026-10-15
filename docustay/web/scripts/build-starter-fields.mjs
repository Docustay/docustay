#!/usr/bin/env node
// Writes src/lib/site/starter-fields.json: for each of the starter templates, the roles and the fields on its FIRST page (position as a fraction of the page), plus the whole-document field counts. The site draws these over the real first-page picture, so "every field placed" is shown from the data the app itself uses. Run after build-starters.mjs.
import fs from "node:fs";
const src = JSON.parse(fs.readFileSync(new URL("../src/lib/site/starters.gen.json", import.meta.url), "utf8")).starters;
const out = {};
for (const s of src) {
  const roles = [...s.seats.map((x) => x.role), ...(s.fields.some((f) => f.sender) ? [s.fields.find((f) => f.sender).role] : [])], byType = {};   // Run 9: the boxes the sender fills before sending have their own colour and legend line
  for (const f of s.fields) byType[f.type] = (byType[f.type] ?? 0) + 1;
  out[s.slug] = { title: s.title, pages: s.pages, roles, total: s.fields.length, byType, p1: s.fields.filter((f) => f.page === 1).map((f) => ({ t: f.type, r: roles.indexOf(f.role), l: f.label, x: +f.x.toFixed(4), y: +f.y.toFixed(4), w: +f.w.toFixed(4), h: +f.h.toFixed(4) })), sigPage: Math.min(...s.fields.filter((f) => f.type === "signature").map((f) => f.page), s.pages) };
}
fs.writeFileSync(new URL("../src/lib/site/starter-fields.json", import.meta.url), JSON.stringify(out));
console.log("starter-fields.json:", Object.keys(out).length, "templates,", (JSON.stringify(out).length / 1024).toFixed(0), "KB");
