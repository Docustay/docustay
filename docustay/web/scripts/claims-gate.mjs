#!/usr/bin/env node
// Claims gate (Part 31 Part B): every claim in src/lib/claims.json is found in the site's own text and compared with the value the code actually enforces. Fails on any mismatch, any claim whose site text or code line cannot be found (a moved or reworded claim is a failure, not a skip), and when the positive control (a deliberately wrong value) is not caught.
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const { claims } = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/claims.json"), "utf8"));
const grab = (file, re) => { let t; try { t = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { return { err: `cannot read ${file}` }; } const m = t.match(new RegExp(re)); return m ? { value: m[1] } : { err: `no match for /${re}/ in ${file}` }; };
const num = (s, scale = 1, money = false) => (money ? Math.round(parseFloat(String(s).replace(/,/g, "")) * scale) : Number(String(s).replace(/,/g, "")) * scale);
const check = (c, codeOverride) => { const s = grab(c.site.file, c.site.re); const k = codeOverride !== undefined ? { value: codeOverride } : grab(c.code.file, c.code.re); if (s.err || k.err) return { ok: false, why: s.err ?? k.err }; const sv = c.date ? Date.parse(s.value) : num(s.value, c.site.scale ?? 1, c.site.money); const kv = c.date ? Date.parse(k.value) : num(k.value) + (c.code?.plus ?? 0); return { ok: sv === kv, why: `site says ${s.value}${c.site.scale ? ` (= ${sv} in code units)` : ""}, code has ${kv}` }; };
// event names the docs and pages promise must be real topics (earlier docs invented some)
const { TOPICS } = await import("../../../src/events/topics.mjs"); const real = new Set(JSON.stringify(TOPICS).match(/documents\.[a-z_]+\.[a-z_]+/g));
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else if (/\.(md|txt|js|svelte)$/.test(e.name)) o.push(f); } return o; };
const named = new Set(); for (const f of [...walk(path.join(ROOT, "static")), ...walk(path.join(ROOT, "src/lib/site"))]) for (const m of fs.readFileSync(f, "utf8").matchAll(/documents\.[a-z_]+\.[a-z_]+/g)) named.add(m[0]);
let bad = 0; for (const n of named) if (!real.has(n)) { console.log(`FAIL  event name on the site is not a real topic: ${n}`); bad += 1; }
console.log(`${bad ? "FAIL" : "PASS"}  ${named.size} event names on the site, all real topics (${[...named].join(", ")})`);
for (const c of claims) { const r = check(c); console.log(`${r.ok ? "PASS" : "FAIL"}  ${c.id}: ${r.why}`); if (!r.ok) bad += 1; }
// the refund policy is words, not a number (the maintainer, 13 Oct 2026: Docustay gives no refunds). Both places that state it must say so, and none may still promise a refund window.
for (const f of ["src/lib/legal.json", "src/routes/(site)/pricing/+page.svelte"]) { const t = fs.readFileSync(path.join(ROOT, f), "utf8"); const good = /does not give refunds/.test(t), stale = /refunded within \d+ days/.test(t); console.log(`${good && !stale ? "PASS" : "FAIL"}  no-refunds policy in ${f}${good ? "" : " (missing)"}${stale ? " (still promises a refund window)" : ""}`); if (!good || stale) bad += 1; }
const ctl = check(claims[0], "999999"); if (ctl.ok) { console.log("FAIL  positive control: a wrong code value was accepted"); bad += 1; } else console.log("PASS  control: a wrong code value is caught");
console.log(bad ? `CLAIMS GATE FAIL (${bad})` : `CLAIMS GATE PASS (${claims.length} claims)`); process.exit(bad ? 1 : 0);
