#!/usr/bin/env node
// Scores every page from the JSON files visual-review.mjs wrote, with the visual-qa rule: 100 minus V0 40, V1 10, V2 3, V3 1 per DISTINCT defect (kind + selector; repeats at other widths, themes or browsers count once).
// node scripts/visual-score.mjs --dir "DIR1,DIR2" [--notes eyes.json] [--out table.md]
// eyes.json: { "/page": [ { "severity": "V1", "rule": "eyes", "selector": "...", "detail": "..." } ] }   (defects a person saw that no detector can)
import fs from "node:fs";
import path from "node:path";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const DIRS = String(arg("dir", "")).split(",").filter(Boolean), NOTES = arg("notes", null), OUT = arg("out", null);
const PEN = { V0: 40, V1: 10, V2: 3, V3: 1 };
const eyes = NOTES ? JSON.parse(fs.readFileSync(NOTES, "utf8")) : {};
const pages = new Map();
for (const dir of DIRS) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const p = pages.get(d.page) ?? { widths: new Set(), themes: new Set(), browsers: new Set(), items: new Map(), runs: 0 };
  p.runs++; p.widths.add(d.device ?? d.width); p.themes.add(d.theme + (d.reduced ? "+rm" : "") + (d.nowebgl ? "+nogl" : "") + (d.zoom > 1 ? "+z" + d.zoom : "")); p.browsers.add(d.browser);
  for (const x of d.findings) { const sel = String(x.detail).replace(/\s+\d+x\d+$/, "").replace(/"[^"]*"/g, "").slice(0, 80); const k = `${x.kind}|${sel}`; const cur = p.items.get(k); if (!cur || PEN[x.sev] > PEN[cur.sev]) p.items.set(k, { ...x, sel }); }
  pages.set(d.page, p);
}
const rows = []; let fails = 0;
for (const [page, p] of [...pages].sort((a, b) => a[0].localeCompare(b[0]))) {
  const items = [...p.items.values(), ...(eyes[page] ?? []).map((e) => ({ sev: e.severity, kind: e.rule ?? "eyes", detail: e.detail, sel: e.selector }))];
  const cnt = { V0: 0, V1: 0, V2: 0, V3: 0 }; let score = 100;
  for (const x of items) { cnt[x.sev]++; score -= PEN[x.sev]; }
  score = Math.max(0, score); const pass = score >= 90 && !cnt.V0 && !cnt.V1; if (!pass) fails++;
  const top = items.filter((x) => x.sev === "V0" || x.sev === "V1").concat(items.filter((x) => x.sev === "V2")).slice(0, 3).map((x) => `${x.sev} ${x.kind} ${String(x.sel ?? "").slice(0, 40)}`).join("; ") || "none";
  rows.push(`| ${page} | ${[...p.widths].filter(Boolean).sort((a, b) => a - b).join("/")} | ${[...p.themes].join("+")} | ${[...p.browsers].join("+")} | ${score} | ${cnt.V0} | ${cnt.V1} | ${cnt.V2} | ${cnt.V3} | ${pass ? "PASS" : "FAIL"} | ${top} |`);
}
const md = `| Page | Widths | Themes/variants | Browsers | Score | V0 | V1 | V2 | V3 | Status | Top defects |\n|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
if (OUT) fs.writeFileSync(OUT, md); console.log(md); console.log(`pages ${rows.length}, failing ${fails}`);
