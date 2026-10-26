#!/usr/bin/env node
// Part 31 translation gate: finds literal English words typed straight into the markup of a signed-in screen (text between tags that is not a {t("…")} call), which no catalogue can ever translate. It reads every .svelte file under src/routes/(app), src/routes/(auth) and the app's own components, strips <script>, <style> and every {…} expression, then flags any remaining run of two or more words made of letters. Words that are product or file names are allowed (listed below). A file may be exempted on purpose by listing it with a reason in EXEMPT.
// Positive control: the gate is run on a one-line fixture with a known literal and must flag it, and on a fixture with only t() calls and must not.
import fs from "node:fs";
import path from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["src/routes/(app)", "src/routes/(auth)", "src/routes/sign", "src/routes/download", "src/lib/editor", "src/lib/ui"];
const FILES = ["src/lib/TeamPicker.svelte", "src/lib/UsagePanel.svelte", "src/lib/AuditPanel.svelte", "src/lib/EmbedPanel.svelte", "src/lib/TeamPanel.svelte", "src/lib/TeamsPanel.svelte", "src/lib/EmailPanel.svelte", "src/lib/PaymentsPanel.svelte", "src/lib/SettingsForm.svelte", "src/lib/SecurityPanel.svelte", "src/lib/DeveloperPanel.svelte"];
const ALLOW = /^(docustay|stripe|pdf|csv|zip|api|json|smtp|html|webhook|webhooks|google|microsoft|react|vue|angular|docx|xlsx|pptx|jpg|png|mb|ip|id|http|https|url|dns|tls|ssl|qr|ok|e-?mail|and|or|the|of|to|a|in|on|at|by|for|with|as|is|via)$/i;
const EXEMPT = {};   // "src/path.svelte": "why this file may keep literal words"
function scan(src) {
  const body = src.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  let flat = body, prev; do { prev = flat; flat = flat.replace(/\{[^{}]*\}/g, " "); } while (flat !== prev);
  const found = [];
  for (const m of flat.matchAll(/>([^<>]+)</g)) { const text = m[1].replace(/&[a-z#0-9]+;/gi, " ").trim(); if (!text) continue; const words = text.split(/[^A-Za-z'’-]+/).filter((w) => w.length >= 3 && !ALLOW.test(w)); if (words.length >= 2) found.push(text.replace(/\s+/g, " ").slice(0, 70)); }
  for (const m of body.matchAll(/\s(?:placeholder|aria-label|title|alt|label)="([^"{}]+)"/g)) { const words = m[1].split(/[^A-Za-z'’-]+/).filter((w) => w.length >= 3 && !ALLOW.test(w)); if (words.length >= 1 && /[a-z]/.test(m[1]) && !/[\/.*_@:]|\d/.test(m[1])) found.push(`attribute: ${m[1].slice(0, 60)}`); }
  return found;
}
// control
const control1 = scan(`<p>Send your first document today</p><input placeholder="Search here">`), control2 = scan(`<p>{t("Send your first document today")}</p><b>{n}</b><input placeholder={t("Search")}>`);
if (control1.length !== 2 || control2.length !== 0) { console.error(`FAIL  control: the scanner must flag a literal sentence (${control1.length}) and ignore a t() call (${control2.length})`); process.exit(1); }
console.log("PASS  control: flags a literal sentence, ignores a t() call");
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".svelte")) files.push(p); } };
for (const d of DIRS) walk(d); files.push(...FILES);
let bad = 0;
for (const f of files) { if (EXEMPT[f]) continue; const hits = scan(fs.readFileSync(path.join(ROOT, f), "utf8")); if (hits.length) { bad += hits.length; console.log(`FAIL  ${f}: ${hits.length} literal text run(s): ${hits.map((h) => `"${h}"`).join(" | ")}`); } }
console.log(bad ? `\nI18N LITERAL GATE FAIL (${bad} runs in ${files.length} files)` : `\nI18N LITERAL GATE PASS (${files.length} files, 0 literal runs)`); process.exit(bad ? 1 : 0);
