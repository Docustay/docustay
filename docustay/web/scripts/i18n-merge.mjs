#!/usr/bin/env node
// Turns i18n/work/<lang>.tsv (one "index<TAB>translation" line per source sentence, in the order of i18n/work/source-list.json) into i18n/locales/<lang>.json (English sentence -> translation).
//   node scripts/i18n-merge.mjs de           merge one language
// Refuses to write unless every index 0..N-1 appears exactly once and every translation has the same placeholders as its English sentence (so a shifted line is caught, not saved).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "../src/lib/i18n/format.js";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lang = process.argv[2]; if (!lang) { console.error("usage: i18n-merge.mjs <lang>"); process.exit(2); }
const src = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n/work/source-list.json"), "utf8"));
const lines = fs.readFileSync(path.join(ROOT, `i18n/work/${lang}.tsv`), "utf8").split("\n").filter((l) => l.trim());
const out = {}, seen = new Set(), problems = [];
for (const line of lines) {
  const tab = line.indexOf("\t"); const i = Number(line.slice(0, tab)); const v = line.slice(tab + 1).replace(/\\n/g, "\n").trim();
  if (!Number.isInteger(i) || i < 0 || i >= src.length) { problems.push(`bad index in: ${line.slice(0, 40)}`); continue; }
  if (seen.has(i)) { problems.push(`index ${i} twice`); continue; } seen.add(i);
  if (!v) { problems.push(`${i}: empty`); continue; }
  try { const a = inspect(src[i]), b = inspect(v); if (a.names.join() !== b.names.join()) problems.push(`${i}: placeholders ${a.names} vs ${b.names}  (${src[i].slice(0, 40)})`); } catch (e) { problems.push(`${i}: ${e.message.slice(0, 80)}`); }
  if (/'\{/.test(v)) problems.push(`${i}: an apostrophe before a brace (use ’)`);
  out[src[i]] = v;
}
for (let i = 0; i < src.length; i += 1) if (!seen.has(i)) problems.push(`${i}: missing (${src[i].slice(0, 40)})`);
if (problems.length) { console.log(`${lang}: ${problems.length} problem(s), nothing written:`); for (const p of problems.slice(0, 40)) console.log("  " + p); process.exit(1); }
fs.mkdirSync(path.join(ROOT, "i18n/locales"), { recursive: true });
fs.writeFileSync(path.join(ROOT, `i18n/locales/${lang}.json`), JSON.stringify(out, null, 1) + "\n");
console.log(`${lang}: ${Object.keys(out).length} sentences written`);
