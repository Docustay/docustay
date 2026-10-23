#!/usr/bin/env node
// Writes src/lib/site/pages/usecase-templates.gen.json: for each built-in document template the few facts a use-case page quotes (summary, who, roles, pages, minutes, field counts, the page's own "when" and "check" lines). Read from the same data the template pages use, so the two cannot disagree. `--check` fails when the file is stale.
import fs from "node:fs";
import { TEMPLATES } from "../src/lib/site/pages/templates.js";
import { FULL_TEMPLATES } from "../src/lib/site/starterFull.js";
const out = TEMPLATES.map((m) => { const t = FULL_TEMPLATES.find((x) => x.slug === m.old); return { slug: m.slug, title: m.title, use: m.use, line: m.line, when: m.when, check: m.check, summary: t.summary, who: t.who, roles: t.seats.map((s) => s.role), seats: t.seats.map((s) => s.seat), pages: t.pages, minutes: t.minutes, labels: [...new Set(t.fieldList.map((f) => f.label))].slice(0, 14), fields: t.fieldList.length, required: t.fieldList.filter((f) => f.required).length }; });
const file = new URL("../src/lib/site/pages/usecase-templates.gen.json", import.meta.url), next = JSON.stringify(out, null, 1) + "\n";
if (process.argv.includes("--check")) { if (fs.readFileSync(file, "utf8") !== next) { console.error("FAIL usecase-templates.gen.json is stale: run node scripts/build-usecase-data.mjs"); process.exit(1); } console.log("PASS usecase-templates.gen.json is current"); } else { fs.writeFileSync(file, next); console.log(`wrote ${out.length} templates`); }
