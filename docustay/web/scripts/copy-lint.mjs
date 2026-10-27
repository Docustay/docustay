// Copy-lint gate (PRICING-WORDS-SPEC, 21 Oct 2026). One set of words for what costs money:
//   a TEAM MEMBER has a Docustay login and is the only person who costs money (Pay as you go);
//   a SIGNER is anyone you send to and is free; CONTACTS is the saved list.
// Fails on a price written in the old words ("$5 a person a month", "per seat", "per user"), on "Unlimited" next to a number that is a limit on that plan, and when the app's compare table (billingModel/status
// payload), the website (prices.json -> pricing page, calculator) and the price list (src/product/docustayPrices.mjs) disagree. Run: node scripts/copy-lint.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { PRICES } from "../../../src/product/docustayPrices.mjs";
import { compareTable, costExample, FOOTNOTE, GLOSSARY } from "../../../src/product/docustayWords.mjs";

const WEB = new URL("..", import.meta.url).pathname, ROOT = join(WEB, "../..");
const SKIP_DIR = new Set(["node_modules", ".svelte-kit", "build", "dist", ".git", "generated"]);
const SKIP_FILE = /(forms\.gen|starters\.gen|starters\.index|starterFull|licences|openapi\.json|postman_collection|package-lock|\.png$|\.svg$|\.pdf$|\.woff2?$|copy-lint\.mjs$)/;
const TEXT = /\.(svelte|js|mjs|json|md|txt|html)$/;
function* walk(dir) { for (const n of readdirSync(dir)) { if (SKIP_DIR.has(n)) continue; const p = join(dir, n), s = statSync(p); if (s.isDirectory()) yield* walk(p); else if (TEXT.test(n) && !SKIP_FILE.test(p)) yield p; } }

// 1) forbidden price words
const RULES = [
  [/a person a month/i, 'price written as "a person a month": say "per team member a month"'],
  [/\$\s?\d[\d.,]*\s*(?:\/|a|per|each)\s*(?:person|user|seat)\b/i, "price per person/user/seat: say per team member"],
  [/\b(?:person|user|seat)s?\s+(?:a|per|each)\s+month\b/i, 'price per person/user/seat "a month": say per team member'],
  [/\b(?:extra|included|additional) seats?\b/i, 'the word "seat" in a price or an allowance: say team member'],
  [/\bseat price\b/i, '"seat price": say the team member price'],
  [/\bunlimited (?:people|users)\b/i, '"Unlimited people/users": say team members and signers'],
  [/unlimited (?:documents,? )?templates and people/i, '"Unlimited templates and people": say team members and signers'],
  [/pay as you go[^.\n]{0,80}unlimited templates|unlimited templates[^.\n]{0,80}pay as you go/i, `Pay as you go has ${PRICES.payg.templatesPerMonth} new templates a month: never "Unlimited" next to it`],
  [/free[^.\n]{0,60}unlimited signers|unlimited signers[^.\n]{0,60}\bfree plan\b/i, `Free has ${PRICES.free.signersPerMonth} different signers a month: never "Unlimited" next to it`],
];
// the maintainer's approved positioning lines (final decision, 25-26 Oct 2026; pinned word for word by test/plumb_positioning_claims.test.mjs). Reason: the supporting line next to the tagline says Pro is $35 a month for the whole team, and the pricing intro says Pay as you go is $5 per person a month; these sentences are the maintainer's words, not the retired per-seat wording.
const APPROVED = /unlimited people and documents\. Signers can pay|Pay as you go is \{?\$?[\d{}a-z]+\}? per person|Pay as you go is \$5 per person|Start free\. Pay as you go is/i;
const bad = [];
for (const root of [join(WEB, "src"), join(WEB, "static"), join(ROOT, "src/product"), join(ROOT, "src/queue"), join(ROOT, "src/mail"), join(ROOT, "src/routes"), join(ROOT, "sdk/mcp/src"), join(ROOT, "sdk/js/src"), join(ROOT, "sdk/cli/bin")]) {
  if (!existsSync(root)) continue;
  for (const f of walk(root)) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((ln, i) => { if (APPROVED.test(ln)) return; for (const [re, why] of RULES) { const m = ln.match(re); if (m) bad.push(`${relative(ROOT, f)}:${i + 1}  ${why}  → …${ln.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 70).trim()}…`); } });
  }
}

// 2) the three places agree: price list → generated prices.json (site) → app (the status payload reads the same compareTable)
const generated = JSON.parse(readFileSync(join(WEB, "src/lib/site/prices.json"), "utf8"));
const want = compareTable();
if (JSON.stringify(generated.words?.compare) !== JSON.stringify(want)) bad.push("src/lib/site/prices.json: words.compare differs from the price list's compare table: run npm run build:prices");
if (generated.words?.footnote !== FOOTNOTE) bad.push("prices.json footnote differs from docustayWords FOOTNOTE");
if (generated.words?.costExample?.text !== costExample().text) bad.push("prices.json cost example differs from docustayWords costExample");
if (!/Fair use applies to Unlimited\./.test(FOOTNOTE) || !/A document counts when it is sent\. Reminders and resends are free\./.test(FOOTNOTE)) bad.push("the footnote must keep both sentences from the spec");
const must = (file, re, why) => { const t = readFileSync(join(WEB, file), "utf8"); if (!re.test(t)) bad.push(`${file}: ${why}`); };
must("src/routes/(site)/pricing/+page.svelte", /WORDS\.compare/, "the pricing page must build its table from WORDS.compare (the shared list)");
must("src/routes/(site)/pricing/+page.svelte", /WORDS\.footnote/, "the pricing page must show the shared footnote");
must("src/lib/billing/billingModel.js", /words\?\.compare/, "the Billing table must read words.compare from the status payload");
must("src/lib/billing/ComparePlans.svelte", /words\.footnote/, "the Billing table must show the shared footnote");
for (const r of want) for (const k of ["free", "payg", "pro", "lifetime"]) if (!r.cells[k]) bad.push(`compare row ${r.key} has no ${k} cell`);
// every number in the table is a number in the price list
const nums = new Set([PRICES.free.docsIncluded, PRICES.free.draftsIncluded, PRICES.free.signersPerMonth, PRICES.free.templatesPerMonth, PRICES.payg.docsIncluded, PRICES.payg.draftsIncluded, PRICES.payg.templatesPerMonth, PRICES.pro.draftsIncluded, PRICES.lifetime.draftsIncluded, PRICES.lifetime.firstWorkspaces, 2, 0].map(String));
const rowOf = (k) => want.find((r) => r.key === k).cells;
if (rowOf("signers").free !== `${PRICES.free.signersPerMonth} a month`) bad.push("compare: the Free signers cell must be the price list's signersPerMonth");
if (rowOf("templates").payg !== String(PRICES.payg.templatesPerMonth)) bad.push("compare: the Pay as you go templates cell must be the price list's templatesPerMonth");
if (rowOf("templates").pro !== "Unlimited" || rowOf("signers").payg !== "Unlimited, free") bad.push("compare: only the unlimited cells may say Unlimited");
void nums; void GLOSSARY;

if (bad.length) { console.error(`copy-lint: ${bad.length} problem${bad.length === 1 ? "" : "s"}\n` + bad.map((b) => "  " + b).join("\n")); process.exit(1); }
console.log("copy-lint: one set of words everywhere; app table, website and price list agree");
