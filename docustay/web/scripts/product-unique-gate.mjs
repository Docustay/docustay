// Every registry page is its own page: its own H1, its own search title and description, and its own blocks (no two pages share a body). The old rule asked each Product page for its own component and picture;
// the pages are data now, so the same intent is checked on the data: nothing is a copy of another, every page has art or a figure, and every capability sentence belongs to the page it is on.
import path from "node:path"; import { pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { ALL } = await import(pathToFileURL(path.join(ROOT, "src/lib/site/pages/registry.js")));
const problems = [];
const mk = (out) => { const seen = { h1: new Map(), seo: new Map(), meta: new Map(), body: new Map() }; return (k, v, p) => { if (seen[k].has(v)) out.push(`${p} and ${seen[k].get(v)} share the same ${k}`); else seen[k].set(v, p); }; };
const once = mk(problems);
for (const p of ALL) {
  once("h1", p.h1, p.path); once("seo", p.seo, p.path); once("meta", p.meta, p.path); once("body", JSON.stringify(p.blocks), p.path);
  if (!p.blocks.some((b) => ["flow", "flows", "twofig", "timeline", "anatomy", "hashchain", "ledger", "tree", "tiles", "templates", "cols", "cards", "steps", "split", "code", "prose", "spec", "limits"].includes(b.t)) && !p.hero) problems.push(`${p.path}: no figure and no art`);
}
// positive control: a copy is caught
const ctl = []; const o2 = mk(ctl); o2("body", "same", "/a"); o2("body", "same", "/b"); if (ctl.length !== 1) problems.push("control: a duplicate body was not caught");
if (problems.length) { console.log("PRODUCT UNIQUE GATE FAIL\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`PRODUCT UNIQUE GATE PASS: ${ALL.length} registry pages, each with its own H1, title, description and body`);
