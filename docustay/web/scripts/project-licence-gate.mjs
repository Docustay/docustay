#!/usr/bin/env node
// The project's OWN licence gate (Part 32). The dependency gate (licence-gate.mjs) checks what Docustay uses; this one checks what Docustay says about itself:
//  1. the licence files exist and match the package metadata: AGPL-3.0 for the server and app, MIT for every client-side package;
//  2. the boundary: nothing SHIPPED under sdk/ imports server or app code (tests are not shipped; a customer's application must never be pulled under the AGPL by linking an SDK);
//  3. no page says "open source" about Docustay itself without naming a licence (competitors' descriptions are exempt: they describe someone else);
//  4. a public claim that the code "is on GitHub" or "is published" is false while the repository is held, so it is refused.
// Each rule has a positive control (a deliberately bad sample is caught).
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ex = (p) => fs.existsSync(path.join(ROOT, p));
export const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };

// 1. licence files and metadata
const AGPL_HEAD = /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/;
for (const f of ["LICENSE", "docustay/LICENSE"]) need(ex(f) && AGPL_HEAD.test(rd(f)) && rd(f).length > 30000, `${f} is missing or is not the full AGPL-3.0 text`);
for (const f of ["NOTICE", "TRADEMARK.md", "CONTRIBUTING.md", "CONTRIBUTOR-AGREEMENT.md"]) need(ex(f), `${f} is missing`);
need(/AGPL-3\.0/.test(rd("docustay/web/package.json")) && /AGPL-3\.0/.test(rd("package.json")), "package.json files must say AGPL-3.0-or-later");
const SDKS = ["js", "python", "react", "vue", "angular", "embed", "mcp", "claude-plugin"];
for (const d of SDKS) {
  need(ex(`sdk/${d}/LICENSE`) && /^MIT License/.test(rd(`sdk/${d}/LICENSE`)), `sdk/${d}/LICENSE must be the MIT licence`);
  const meta = ex(`sdk/${d}/package.json`) ? rd(`sdk/${d}/package.json`) : ex(`sdk/${d}/pyproject.toml`) ? rd(`sdk/${d}/pyproject.toml`) : ex(`sdk/${d}/.claude-plugin/plugin.json`) ? rd(`sdk/${d}/.claude-plugin/plugin.json`) : "";
  need(/"license":\s*"MIT"|license\s*=\s*\{\s*text\s*=\s*"MIT"/.test(meta), `sdk/${d} metadata must say MIT`);
  if (ex(`sdk/${d}/package.json`)) { const files = JSON.parse(rd(`sdk/${d}/package.json`)).files; need(!files || files.includes("LICENSE"), `sdk/${d}/package.json "files" must include LICENSE so the published package carries it`); }
}

// 2. the boundary
const walk = (d) => (ex(d) ? fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === "__pycache__" ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])) : []);
export const crossesBoundary = (src) => /(?:from|import|require\()\s*["'](?:\.\.\/)+(?:src|docustay|db)\b|from\s+(?:src|docustay_server)\b|sys\.path[^\n]*\.\./.test(src);
// a relative import crosses the boundary only if it lands on the repository's own src/, docustay/ or db/ (a package's OWN ../src is its own); and a file counts only if it ships (the package's "files" list, when it has one)
const lands = (file, src) => [...src.matchAll(/(?:from|import|require\()\s*["'](\.[^"']*)["']/g)].some((m) => { const t = path.relative(ROOT, path.resolve(ROOT, path.dirname(file), m[1])).split(path.sep)[0]; return ["src", "docustay", "db"].includes(t); });
const ships = (f) => { const pkg = f.split("/").slice(0, 2).join("/"); if (!ex(`${pkg}/package.json`)) return true; const files = JSON.parse(rd(`${pkg}/package.json`)).files; if (!files) return true; const rel = f.slice(pkg.length + 1); return files.some((e) => rel === e.replace(/^\.\//, "") || rel.startsWith(e.replace(/^\.\//, "").replace(/\/?$/, "/"))); };
for (const f of walk("sdk").filter((x) => /\.(js|mjs|ts|py|svelte|vue)$/.test(x) && !/\/tests?\//.test(x))) { const src = rd(f); if ((crossesBoundary(src) && /\.py$/.test(f)) || (!/\.py$/.test(f) && lands(f, src))) if (ships(f)) problems.push(`${f} imports server or app code: a client package must never link the AGPL part`); }
need(lands("sdk/cli/bin/x.mjs", `import a from "../src/args.mjs"`) === false && lands("sdk/mcp/scripts/x.mjs", `import a from "../../../src/documents/api.mjs"`) === true, "control: the boundary check mistakes a package's own ../src for the server's");
need(crossesBoundary(`import x from "../../src/documents/api.mjs"`) && !crossesBoundary(`import x from "./client.js"`), "control: the boundary check does not tell a crossing from a local import");

// 3 and 4. what the pages say
// The repository went public on 15 Oct 2026 (the maintainer); while it is held the third rule below refuses any claim that the code is published. Set back to true to hold again.
export const REPO_HELD = false;
export const claimProblem = (line, held = REPO_HELD) => {
  if (/(theirs:|DocuSeal|Documenso|SignWell|competitor|other product|compare)/i.test(line) || /open-source software/i.test(line)) return null;   // other people's descriptions, and "built from open-source software" (our dependencies)
  if (/open[- ]source/i.test(line.replace(/"Open source",\s*"\/open-source"/g, "").replace(/["'`]\/open-source["'`]/g, "").replace(/[\/^(|]open-source/g, "").replace(/"open-source":\s*"Open source"/g, "")) && !/AGPL|MIT/.test(line)) return "says open source without naming a licence";
  if (held && (/github\.com\/(docustay|foundry)/i.test(line) || /(code|repository) (is|are) (on github|published|public)/i.test(line))) return "claims the code is already published";
  return null;
};
const SITE = [...walk("docustay/web/src/lib/site"), ...walk("docustay/web/src/routes/(site)"), ...walk("docustay/docs"), "docustay/web/scripts/build-legal.mjs"].filter((f) => /\.(js|svelte|md|mjs)$/.test(f));
for (const f of SITE) rd(f).split("\n").forEach((line, i) => { const c = claimProblem(line); if (c) problems.push(`${f}:${i + 1} ${c}`); });
need(claimProblem("Open source, on your own server.") && !claimProblem("Licensed under the AGPL-3.0, on your own server.") && claimProblem("The code is on GitHub now.", true) && !claimProblem("The code is on GitHub now.", false), "control: the claims check does not catch a bad sentence");

if (import.meta.url === `file://${process.argv[1]}`) { if (problems.length) { for (const p of problems) console.log("  FAIL " + p); console.log("PROJECT LICENCE GATE FAIL"); process.exit(1); } console.log(`PROJECT LICENCE GATE PASS: AGPL-3.0 files, ${SDKS.length} MIT packages with their own licence, no SDK imports server code, ${SITE.length} source files read for licence claims`); }
