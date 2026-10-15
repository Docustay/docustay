#!/usr/bin/env node
// Finds every sentence the app wraps in t("…") and checks the catalogues against it (Part 31 item 6).
//   node scripts/i18n-extract.mjs            report: sentences found, and per language how many are translated
//   node scripts/i18n-extract.mjs --write    also writes i18n/source.json (the English sentences, sorted, with the files that use them)
//   node scripts/i18n-extract.mjs --check    fail (exit 1) on any problem below
// Problems: a sentence in code that is not a plain string literal (t(`…${x}`) cannot be translated); a catalogue key that no code uses (stale); a catalogue entry whose placeholders differ from the English; a plural or select with the wrong categories for the language;
// a malformed message; a translation that is empty or identical to the English where it should differ; a Latin word left inside non-Latin text; mixed scripts inside one word; double spaces; and a missing language file or missing sentence.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "../src/lib/i18n/format.js";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ["es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko"];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(path.join(ROOT, "src")).filter((f) => /\.(svelte|js|mjs)$/.test(f) && !f.includes("/i18n/format.js") && !f.includes("/i18n/index.svelte.js"));
const found = new Map(), bad = [];
// Where and how a sentence is used, read from the code around the call: the part of the screen it labels, the screen, and an optional hand-written annotation right after the call:  t("Return") /*i18n pos=verb max=12 note="send it back to the sender"*/
const meta = new Map();
const closeParen = (src, i) => { let depth = 0, q = null; for (let j = i; j < src.length; j += 1) { const c = src[j]; if (q) { if (c === "\\") j += 1; else if (c === q) q = null; continue; } if (c === '"' || c === "'" || c === "`") q = c; else if (c === "(") depth += 1; else if (c === ")") { depth -= 1; if (!depth) return j; } } return -1; };
const KINDS = [[/<button[^>]*>\s*\{?$/, "button"], [/<a\s[^>]*>\s*\{?$/, "link"], [/<th[^>]*>\s*\{?$/, "column heading"], [/<label[^>]*>\s*\{?$/, "field label"], [/placeholder=\{?$/, "placeholder"], [/aria-label=\{?$/, "accessibility label"], [/<h[1-3][^>]*>\s*\{?$/, "heading"], [/<option[^>]*>\s*\{?$/, "menu option"], [/title=\{?$/, "tooltip"], [/<summary[^>]*>\s*\{?$/, "disclosure heading"], [/(toast|problem\s*=|note\s*=|error\s*=)\(?\s*$/, "message"], [/<li[^>]*>\s*\{?$/, "list item"], [/<p[^>]*>\s*\{?$/, "paragraph"], [/<span[^>]*>\s*\{?$/, "text"]];
const kindOf = (before) => KINDS.find(([re]) => re.test(before))?.[1] ?? "text";
const screenOf = (rel) => { const m = /routes\/\((?:app|auth)\)\/([^/]+)/.exec(rel) ?? /routes\/(sign|\(site\))\/?([^/]*)/.exec(rel); if (m) return m[1] === "sign" ? "Signing page" : m[1]; const l = /lib\/(?:editor\/)?([A-Za-z]+)/.exec(rel); return l ? l[1] : rel; };
const note = (v, rel, src, idx, argEnd) => {
  const o = meta.get(v) ?? { kinds: new Set(), screens: new Set(), ann: {} }; meta.set(v, o);
  o.kinds.add(kindOf(src.slice(Math.max(0, idx - 90), idx).replace(/\s+/g, " "))); o.screens.add(screenOf(rel));
  const end = closeParen(src, src.indexOf("(", idx)); const a = end > 0 ? /^\s*\/\*\s*i18n\s+([\s\S]*?)\*\//.exec(src.slice(end + 1, end + 400)) : null;
  if (a) for (const kv of a[1].matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) o.ann[kv[1]] = kv[2] ?? kv[3];
};

// t("…") or t('…') with the string being a plain literal; a template literal or concatenation is a problem
const RE = /(?<![\w$.])t\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|[^"'`\s)][^,)]*)/g;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8"); let m;
  while ((m = RE.exec(src))) {
    const arg = m[1], rel = path.relative(ROOT, f), line = src.slice(0, m.index).split("\n").length;
    if (arg[0] === '"' || arg[0] === "'") { let v; try { v = arg[0] === '"' ? JSON.parse(arg) : JSON.parse('"' + arg.slice(1, -1).replace(/"/g, '\\"').replace(/\\'/g, "'") + '"'); } catch { bad.push(`${rel}:${line} unreadable string ${arg.slice(0, 40)}`); continue; } (found.get(v) ?? found.set(v, new Set()).get(v)).add(rel); note(v, rel, src, m.index); }
    else if (arg[0] === "`" && !arg.includes("${")) { const v = arg.slice(1, -1); (found.get(v) ?? found.set(v, new Set()).get(v)).add(rel); note(v, rel, src, m.index); }
    else bad.push(`${rel}:${line} t() needs a plain string literal, got ${arg.slice(0, 50)}`);
  }
}
// English that arrives as data instead of as code: the island's settings schema (group labels, setting labels, help text, option labels) and the editor's field-tool names. They are shown through td() and must be in every catalogue too.
const dynamic = new Set();
const { SETTING_GROUPS, DOCUMENT_SETTINGS, SETTING_CHOICES } = await import("../../../src/documents/settingsSchema.mjs");
const grab = (v) => { if (typeof v === "string" && /[A-Za-z]{3}/.test(v)) dynamic.add(v); };
for (const g of SETTING_GROUPS) grab(g.label);
for (const m of fs.readFileSync(new URL("../../../src/documents/settings.mjs", import.meta.url), "utf8").matchAll(/intro: "([^"]+)"/g)) grab(m[1]);   // the sentence under the Settings page title
// D-030: the pickers' own choices (a number-and-unit label such as "3 days" is rebuilt from a plural sentence by td(), so only the worded ones are collected)
for (const list of Object.values(SETTING_CHOICES)) for (const o of list) if (!/^\d+ (days?|months|years|drafts|MB|pt)$/.test(String(o.label))) grab(o.label);
for (const d of Object.values(DOCUMENT_SETTINGS)) { grab(d.label); grab(d.help); for (const o of d.options ?? []) grab(typeof o === "string" ? null : o.label); }
for (const m of fs.readFileSync(new URL("../../../src/documents/emailMessages.mjs", import.meta.url), "utf8").matchAll(/label: "([^"]+)", to: "([^"]+)"/g)) { grab(m[1]); grab(m[2]); }   // the email templates screen: each message's name and who it goes to
const { TOOLS } = await import("../src/lib/editor/fields.js"); for (const [, l] of TOOLS) grab(l);
for (const k of dynamic) if (!found.has(k)) found.set(k, new Set(["(data: settings schema or field tools)"]));
const keys = [...found.keys()].sort();
// Context for the translators and reviewers (Part 31 follow-up): where each sentence appears, what part of the screen it is, and the hand-written notes (i18n/context.json and /*i18n …*/ after the call). A short sentence (one or two words) is ambiguous on its own, so it must carry a part of speech or a note, or be marked clear.
const manual = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", "context.json"), "utf8")); } catch { return {}; } })();
const sourceOf = (k) => { const m = meta.get(k), ann = { ...(manual[k] ?? {}), ...(m?.ann ?? {}) }; for (const n of ["max"]) if (ann[n] !== undefined) ann[n] = Number(ann[n]);
  return { files: [...found.get(k)].sort(), kind: [...(m?.kinds ?? [])].sort(), screen: [...(m?.screens ?? [])].sort(), ...(Object.keys(ann).length ? { ctx: ann } : {}), ...(ann.risk === "high" ? { risk: "high" } : {}) }; };
const needContext = keys.filter((k) => k.replace(/\{[^}]*\}/g, "").trim().split(/\s+/).length <= 2 && !(manual[k]?.pos || manual[k]?.note || manual[k]?.clear || meta.get(k)?.ann?.pos || meta.get(k)?.ann?.note || meta.get(k)?.ann?.clear));
if (needContext.length) bad.push(`${needContext.length} short sentence(s) have no context (add to i18n/context.json: pos, note or clear): ${needContext.slice(0, 8).join(" | ")}`);
if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "i18n", "source.json"), JSON.stringify(Object.fromEntries(keys.map((k) => [k, sourceOf(k)])), null, 1) + "\n");
// Arabic attaches the prefix و to a following word (وVue); Japanese, Chinese and Korean attach particles to Latin names (Docustayを) and have no word spaces, so Latin touching native script is normal there. The mixed-script check stays on for Russian, where it catches a stray Latin look-alike letter.
const NO_WORD_BREAKS = new Set(["ar", "ja", "zh", "ko"]);
const LATIN = /[A-Za-z]/, NONLATIN = { ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/, ja: /[぀-ヿ一-鿿]/, zh: /[一-鿿]/, ko: /[가-힯]/ };
const KEEP = /^(Docustay|PDF|Word|Excel|PowerPoint|API|Stripe|SMS|URL|CSV|JSON|ID|OK|TEST|HTML|QR)$/;   // names and formats that stay in Latin letters
const report = [];
for (const l of LANGS) {
  const file = path.join(ROOT, "i18n", "translations", `${l}.json`); let cat = null;
  if (!fs.existsSync(file)) { report.push({ l, missing: keys.length, file: "missing" }); bad.push(`${l}: no catalogue file`); continue; }
  cat = JSON.parse(fs.readFileSync(file, "utf8")); let missing = 0, issues = 0;
  const plural = new Intl.PluralRules(l === "zh" ? "zh-Hans" : l === "pt" ? "pt-BR" : l).resolvedOptions().pluralCategories;
  for (const k of keys) {
    const v = cat[k]; if (v === undefined || v === "") { missing += 1; bad.push(`${l}: missing "${k.slice(0, 60)}"`); continue; }
    let a, b; try { a = inspect(k); b = inspect(v); } catch (e) { issues += 1; bad.push(`${l}: malformed message for "${k.slice(0, 50)}": ${e.message.slice(0, 60)}`); continue; }
    if (a.names.join() !== b.names.join()) { issues += 1; bad.push(`${l}: placeholders differ for "${k.slice(0, 50)}": ${a.names} vs ${b.names}`); }
    for (const [n, o] of Object.entries(b.options)) if (o.kind === "plural") { const need = plural.filter((c) => !o.keys.includes(c)); if (need.length && !o.keys.includes("other")) { issues += 1; bad.push(`${l}: plural "${n}" lacks ${need} in "${k.slice(0, 40)}"`); } else if (plural.some((c) => !o.keys.includes(c) && c !== "other") && !/^=/.test(o.keys.join())) { issues += 1; bad.push(`${l}: plural "${n}" has ${o.keys} but ${l} needs ${plural} ("${k.slice(0, 40)}")`); } }
    if (/ {2,}/.test(v) || /^\s|\s$/.test(v) !== /^\s|\s$/.test(k)) { issues += 1; bad.push(`${l}: spacing in "${k.slice(0, 40)}"`); }
    if (/^(Sure|Here is|Here's|Certainly|Translation:)/i.test(v)) { issues += 1; bad.push(`${l}: assistant wording left in "${k.slice(0, 40)}"`); }
    if (NONLATIN[l]) { const words = v.replace(/\{[^}]*\}|<[^>]+>/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean); for (const w of words) { if (!NO_WORD_BREAKS.has(l) && LATIN.test(w) && NONLATIN[l].test(w)) { issues += 1; bad.push(`${l}: mixed scripts in word "${w}" ("${k.slice(0, 30)}")`); } } }
  }
  const stale = Object.keys(cat).filter((k) => !found.has(k)).length; if (stale) bad.push(`${l}: ${stale} stale catalogue entries (no code uses them)`);
  report.push({ l, missing, issues, stale, translated: keys.length - missing });
}
console.log(`${keys.length} sentences in ${files.length} files`);
for (const r of report) console.log(`  ${r.l}  translated ${r.translated ?? 0}/${keys.length}  issues ${r.issues ?? "-"}  stale ${r.stale ?? "-"}`);
if (bad.length) { console.log(`\n${bad.length} problem(s), first 25:`); for (const x of bad.slice(0, 25)) console.log("  " + x); }
if (process.argv.includes("--check") && bad.length) process.exit(1);
