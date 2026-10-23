// Writes src/lib/site/prices.json from the ONE price list (src/product/docustayPrices.mjs), so the website's pricing page, calculator, claims and llms/pricing files read the same numbers the app charges.
// Run by the site build (npm run build:prices); `--check` exits 1 when the file on disk is out of date.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { PRICES, PLAN_ORDER } from "../../../src/product/docustayPrices.mjs";
import { GLOSSARY, FOOTNOTE, PER_TEAM_MEMBER, GRANDFATHER_NOTICE, compareTable, costExample } from "../../../src/product/docustayWords.mjs";
const out = new URL("../src/lib/site/prices.json", import.meta.url);
const text = JSON.stringify({ generatedFrom: "src/product/docustayPrices.mjs", planOrder: PLAN_ORDER, ...PRICES, words: { glossary: GLOSSARY, footnote: FOOTNOTE, perTeamMember: PER_TEAM_MEMBER, grandfather: GRANDFATHER_NOTICE, compare: compareTable({ foundersOpen: true }), costExample: costExample({ foundersOpen: true }) } }, null, 2) + "\n";
if (process.argv.includes("--check")) { if (!existsSync(out) || readFileSync(out, "utf8") !== text) { console.error("prices.json is out of date: run npm run build:prices"); process.exit(1); } console.log("prices.json is current"); }
else { writeFileSync(out, text); console.log("wrote prices.json"); }
