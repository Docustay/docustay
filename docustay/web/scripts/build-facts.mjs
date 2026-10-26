#!/usr/bin/env node
// Facts the site states that are COUNTS read from the product's own files, never typed by hand (BLUEPRINT §3.1, §6). Writes src/lib/site/facts.gen.json; `--check` fails when the committed file is stale.
// operations = HTTP operations in the OpenAPI file · languages = the product's languages · mcpTools = tools in the MCP server's scope table · docTemplates / formTemplates = the built-in registries · scopes is deliberately NOT here until the key screen's list is read (INFO-AUDIT).
import fs from "node:fs"; import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const api = JSON.parse(fs.readFileSync(path.join(ROOT, "../../sdk/openapi/openapi.json"), "utf8"));
let operations = 0; for (const p of Object.values(api.paths)) operations += Object.keys(p).filter((k) => ["get", "post", "put", "patch", "delete"].includes(k)).length;
const languages = 1;   // Docustay v1 is English only
const mcpTools = (fs.readFileSync(path.join(ROOT, "../../sdk/mcp/SCOPES.md"), "utf8").match(/^\| `[a-z_]+` \|/gm) ?? []).length;
const formTemplates = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/site/forms.index.json"), "utf8")); const docIdx = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/site/starters.index.json"), "utf8"));
const count = (x) => (Array.isArray(x) ? x.length : Array.isArray(x?.items) ? x.items.length : Array.isArray(x?.templates) ? x.templates.length : Object.keys(x).length);
const { docustayScopes } = await import("../../../src/developer/scopes.mjs");
const { FACTS } = await import("../../../src/product/docustayPrices.mjs");
const scopes = docustayScopes().length;
const sdkLanguages = ["npm", "pypi", "go", "packagist", "nuget"].filter((k) => FACTS.packages[k] && FACTS.packages[k].length !== 0).length;   // one package registry per SDK language: JavaScript, Python, Go, PHP, C#
const goVersion = /^go (\d+\.\d+)/m.exec(fs.readFileSync(path.join(ROOT, "../../sdk/generated/go/go.mod"), "utf8"))[1];   // what the Go module asks for
const facts = { tagline: FACTS.tagline, goVersion, subProcessors: FACTS.subProcessors, version: FACTS.version, scopes, sdkLanguages, templates: count(formTemplates) + count(docIdx), operations, languages, mcpTools, formTemplates: count(formTemplates), docTemplatePages: count(docIdx), openapiVersion: api.openapi, apiVersion: api.info?.version ?? null };
const out = JSON.stringify(facts, null, 1) + "\n", file = path.join(ROOT, "src/lib/site/facts.gen.json");
if (process.argv.includes("--check")) { const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; if (cur !== out) { console.error(`FAIL facts.gen.json is stale. Run: node scripts/build-facts.mjs\n  wanted ${out.trim().replace(/\s+/g, " ")}\n  have   ${cur.trim().replace(/\s+/g, " ")}`); process.exit(1); } console.log("PASS facts.gen.json matches the product files", facts); }
else { fs.writeFileSync(file, out); console.log("wrote", file, facts); }
