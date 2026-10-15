#!/usr/bin/env node
// Prose gate (Part 31 Part B): spelling (cspell, British English, brand words in cspell.json) and readability (Flesch-Kincaid grade) of every public page's text. Code, tables and front matter are not scored. Fails on any misspelling, or a page above grade 13 (legal-style pages are exempt from the grade only).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), ".."); const MAXGRADE = 13;
let bad = 0;
try { execFileSync("npx", ["cspell", "--no-progress", "--no-summary", "static/*.md", "static/trust/*.md", "static/use-cases/*.md", "static/product/*.md", "static/compare/*.md", "static/developers/*.md", "static/docs/*.md"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }); console.log("PASS  spelling: no unknown words (British English)"); }
catch (e) { console.log(String(e.stdout).split("\n").slice(0, 12).join("\n")); console.log("FAIL  spelling"); bad += 1; }
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else if (/\.md$/.test(e.name)) o.push(f); } return o; };
const syl = (w) => { w = w.toLowerCase().replace(/[^a-z]/g, ""); if (w.length <= 3) return 1; w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, ""); return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length); };
const grade = (t) => { const sents = t.split(/[.!?]+\s/).filter((s) => s.split(/\s+/).length > 2); const words = t.split(/\s+/).filter((w) => /[a-z]/i.test(w)); if (sents.length < 5) return null; const sy = words.reduce((n, w) => n + syl(w), 0); return 0.39 * (words.length / sents.length) + 11.8 * (sy / words.length) - 15.59; };
const rows = []; for (const f of walk(path.join(ROOT, "static")).filter((f) => !/template-library|starters/.test(f))) { const t = fs.readFileSync(f, "utf8").replace(/^---[\s\S]*?---/, "").replace(/^(\s*[-*] .*?)[.!?]?$/gm, "$1. ").replace(/```[\s\S]*?```/g, " ").replace(/^\|.*$/gm, " ").replace(/`[^`]*`/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*>_-]/g, " "); const g = grade(t); if (g !== null) rows.push({ f: path.relative(path.join(ROOT, "static"), f), g: +g.toFixed(1) }); }
rows.sort((a, b) => b.g - a.g); console.log(`readability of ${rows.length} pages (Flesch-Kincaid grade); hardest:`); for (const r of rows.slice(0, 6)) console.log(`  ${r.g}  ${r.f}`);
const hard = rows.filter((r) => r.g > MAXGRADE && !/legal|dpa|terms|privacy-policy/.test(r.f)); if (hard.length) { for (const r of hard) console.log(`FAIL  ${r.f} is grade ${r.g} (limit ${MAXGRADE})`); bad += 1; } else console.log(`PASS  readability: every page at or below grade ${MAXGRADE}`);
console.log(bad ? "PROSE GATE FAIL" : "PROSE GATE PASS"); process.exit(bad ? 1 : 0);
