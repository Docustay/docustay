#!/usr/bin/env node
// Near-duplicate page gate (Part 31 Part B): two public pages whose prose overlaps heavily compete with each other and tell a reader nothing new. Compares the plain-text version of every page (static/**/*.md) by word 5-gram overlap, ignoring the legal text inside template previews (which legitimately repeats). Fails above the limit; prints the closest pairs either way.
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), ".."); const LIMIT = 0.5;
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else if (/\.md$/.test(e.name)) o.push(f); } return o; };
const files = walk(path.join(ROOT, "static")).filter((f) => !/template-library\/|\/starters\//.test(f));
const grams = (t) => { const w = t.toLowerCase().replace(/^---[\s\S]*?---/, "").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean); const s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(" ")); return s; };
const G = files.map((f) => ({ f: path.relative(path.join(ROOT, "static"), f), g: grams(fs.readFileSync(f, "utf8")) })).filter((x) => x.g.size > 40);
const pairs = []; for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) { let n = 0; const [a, b] = G[i].g.size < G[j].g.size ? [G[i].g, G[j].g] : [G[j].g, G[i].g]; for (const x of a) if (b.has(x)) n += 1; pairs.push({ a: G[i].f, b: G[j].f, share: +(n / a.size).toFixed(2) }); }
pairs.sort((x, y) => y.share - x.share); console.log(`${G.length} pages compared; closest pairs:`); for (const p of pairs.slice(0, 8)) console.log(`  ${p.share}  ${p.a}  ~  ${p.b}`);
const bad = pairs.filter((p) => p.share > LIMIT); if (bad.length) { console.log(`SIMILARITY GATE FAIL: ${bad.length} pair(s) share more than ${LIMIT * 100}% of their wording`); process.exit(1); } console.log(`SIMILARITY GATE PASS: no pair shares more than ${LIMIT * 100}%`);
