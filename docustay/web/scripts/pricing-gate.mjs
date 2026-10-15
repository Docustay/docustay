#!/usr/bin/env node
// Pricing gate (6 Oct 2026): fails if customer-visible text still says $16 (the retired price), says $25 as Docustay's LIST price, or says Docustay is priced per user/seat.
// $25 is allowed only on a line that also says "founders"; "per user" is allowed only where the line is about a competitor's own pricing (named, with the date it was read).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const SCAN = ["src", "static", "../docs", "i18n/memory", "../../docustay/docs"];
const SKIP = /(^|\/)(node_modules|build|build-preview|\.svelte-kit|template-library|starters|api)(\/|$)|\.(png|jpg|jpeg|webp|gif|pdf|woff2?|mp4|webm|br|gz|ico|svg)$/;
const COMPETITOR = /DocuSeal|Documenso|SignWell|BoldSign|Dropbox Sign|PandaDoc|DocuSign|SignNow|Zoho|on the day this page was read|competitor/i;
const rules = [
  ["the old founders cut-off (31 Dec) — it is three months after launch, one setting", /31 Dec(ember)?\b|December 31\b/i, () => true],
  ["the retired $16 price", /\$ ?16(?![\d,.]|\.\d)/, () => true],
  ["$25 as a list price (it is the founders price only)", /\$ ?25(?![\d,])/, (l) => !/founder/i.test(l) && !COMPETITOR.test(l)],
  ["Docustay priced per user or per seat", /per[- ](user|seat)\b|\beach user\b|per extra user/i, (l) => !COMPETITOR.test(l) && !/not (charged )?per user|parties|"seat"|template's .seats./i.test(l) && !/^\s*\["[^"]+", "[^"]*per user/.test(l)],   // a comparison row's middle cell is the competitor's own pricing, not ours
];
const hits = [];
if (process.argv.includes("--selftest")) {   // positive control: the gate must flag each bad line and pass each good one
  const bad = ["Founders subscribe by 31 December 2026", "Pro is $16 a month", "Pro is $25 a month for everyone", "Pro costs $12 per user per month", "Pro is $30 per seat"], good = ["Founders pay $25 a month", "Pro is $39 a month", "DocuSeal listed $20 per user per month on the day this page was read", "$390 a year per install", "It is not charged per user."];
  const flagged = (l) => rules.some(([, re, ap]) => re.test(l) && ap(l));
  for (const l of bad) if (!flagged(l)) { console.error("selftest FAILED: not flagged:", l); process.exit(1); }
  for (const l of good) if (flagged(l)) { console.error("selftest FAILED: wrongly flagged:", l); process.exit(1); }
  console.log("pricing gate selftest: ok"); process.exit(0);
}
const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (SKIP.test(f)) continue; const st = statSync(f); if (st.isDirectory()) walk(f); else if (st.size < 2e6) scan(f); } };
const FACTS_ROW = /^\s*\["[^"]+", "[^"]*", ("[^"]*")\],?\s*$/;   // a comparison row is [label, theirs, ours]: only "ours" is Docustay's statement
const scan = (f) => { let txt; try { txt = readFileSync(f, "utf8"); } catch { return; } txt.split("\n").forEach((line0, i) => { const fr = FACTS_ROW.exec(line0), line = fr ? fr[1] : line0; for (const [name, re, applies] of rules) if (re.test(line) && applies(line)) hits.push(`${relative(root, f)}:${i + 1}  [${name}]  ${line.trim().slice(0, 140)}`); }); };
for (const d of SCAN) { try { walk(join(root, d)); } catch { /* a folder that is not there */ } }
if (hits.length) { console.error(`pricing gate: ${hits.length} stale or wrong price statement(s)\n` + hits.join("\n")); process.exit(1); }
console.log("pricing gate: no $16, no $25 list price, no per-user price in customer-visible text");
