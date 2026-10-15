// B1 (Operation Live): no unfilled {{F-ID}} feature tag (the renderer's own placeholder; the docs show other {{...}} syntax on purpose) may appear in the TEXT of any prerendered page (found on the staging /pricing as a literal {{F-TEAMS}}).
// Scripts, styles, comments and code samples (<pre>/<code>, where the docs show the {{...}} syntax on purpose) are stripped first: page data legitimately carries {{F-ID}} tags that the renderer removes.
// Self-test first: a page with a visible placeholder must be caught and a clean page must not.   Run: node scripts/placeholder-gate.mjs [dir]
import fs from "node:fs"; import path from "node:path";
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<(pre|code)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
const bad = (html) => visible(html).match(/\{\{F-[A-Z0-9-]+\}\}/g) ?? [];
if (!bad("<p>Teams {{F-TEAMS}}</p>").length || bad("<p>ok</p><script>x='{{F-TEAMS}}'</script>").length) { console.error("placeholder-gate self-test failed"); process.exit(2); }
const dir = process.argv[2] ?? new URL("../build/prerendered", import.meta.url).pathname; let n = 0; const fails = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".html")) { n++; const b = bad(fs.readFileSync(p, "utf8")); if (b.length) fails.push(`${path.relative(dir, p)}: ${b.slice(0, 3).join(" ")}`); } } };
walk(dir);
if (n < 50) { console.error(`placeholder-gate: only ${n} pages found in ${dir} (build first)`); process.exit(2); }
console.log(`placeholder-gate: ${n} prerendered pages, ${fails.length} with a visible placeholder`); for (const f of fails) console.log("  " + f); process.exit(fails.length ? 1 : 0);
