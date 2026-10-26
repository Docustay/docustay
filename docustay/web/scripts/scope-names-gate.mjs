#!/usr/bin/env node
// Public-text gate: no API scope that belongs to the platform (the CRM, money, booking, lead, network, platform and records scopes) may appear on the Docustay site, in the API description, the docs, the
// llms files or any Markdown twin. A Docustay workspace is offered exactly the scopes in docustayScopes(); anything else of the form word:read / word:write / word:admin is a leak.
// Run: node scripts/scope-names-gate.mjs. Control: it also scans a planted sample and must catch it.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { docustayScopes, GRANTABLE_SCOPES } from "../../../src/developer/scopes.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OK = new Set(docustayScopes()); const WORKBENCH = GRANTABLE_SCOPES.filter((s) => !OK.has(s));
const RE = /\b([a-z]+):(?:read|write|admin|manage)\b/g;
export const leaks = (text) => [...new Set([...text.matchAll(RE)].map((m) => m[0]).filter((s) => !OK.has(s) && WORKBENCH.includes(s)))];
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".svelte-kit", "build", "build-preview", "visual-out"].includes(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else if (/\.(md|json|txt|svelte|js|mjs|html|xml)$/.test(e.name) && !/gate\.mjs$/.test(e.name)) o.push(f); } return o; };
if (leaks("a key with `booking:read` and `money:write`").length !== 2) { console.log("FAIL control: the scan does not see a planted Workbench scope"); process.exit(1); }
console.log("PASS  control: a planted Workbench scope is caught");
const files = [...walk(path.join(ROOT, "static")), ...walk(path.join(ROOT, "src/routes")), ...walk(path.join(ROOT, "src/lib/site")), ...walk(path.resolve(ROOT, "../docs"))].filter((f) => !/scopes\.mjs$/.test(f));
const bad = []; for (const f of files) { const l = leaks(fs.readFileSync(f, "utf8")); if (l.length) bad.push(`${path.relative(ROOT, f)}: ${l.join(", ")}`); }
if (bad.length) { for (const b of bad.slice(0, 30)) console.log("  FAIL " + b); console.log(`SCOPE NAMES GATE FAIL (${bad.length} files)`); process.exit(1); }
console.log(`SCOPE NAMES GATE PASS: ${files.length} public files; ${WORKBENCH.length} Workbench scopes, none published; a Docustay workspace is offered ${OK.size}`);
