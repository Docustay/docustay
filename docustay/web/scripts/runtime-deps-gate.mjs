#!/usr/bin/env node
// Runtime dependency gate (found by the live-customer program, 6 Oct 2026): the server build imports some packages at run time (they are not bundled). The production image must contain every one of them. This reads the built server files, lists every bare package import, and fails when one is not a production dependency in package.json, or when the Dockerfile's run stage does not install production dependencies.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")); const prod = new Set(Object.keys(pkg.dependencies ?? {}));
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else if (/\.js$/.test(e.name)) o.push(f); } return o; };
const files = [...walk(path.join(ROOT, "build/server")), path.join(ROOT, "build/index.js"), path.join(ROOT, "build/handler.js")].filter(fs.existsSync);
const used = new Map();
for (const f of files) for (const line of fs.readFileSync(f, "utf8").split("\n")) { if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue; const m = line.match(/^import(?:\s[^'"]*from)?\s*['"]([^'"]+)['"]/) ?? line.match(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/); if (!m) continue; const spec = m[1]; if (!/^[a-z@][\w@./-]*$/.test(spec)) continue; if (/^(\.|\/|node:|#)/.test(spec) || builtinModules.includes(spec.split("/")[0])) continue; const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]; (used.get(name) ?? used.set(name, new Set()).get(name)).add(path.relative(ROOT, f)); }
const problems = []; for (const [name, where] of used) if (!prod.has(name)) problems.push(`${name} is imported at run time (${[...where][0]}) but is not in "dependencies"`);
const docker = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8"); const runStage = docker.slice(docker.lastIndexOf("FROM "));
if (used.size && !/npm (ci|install)[^\n]*--omit=dev|npm ci --production/.test(runStage)) problems.push("the Dockerfile's run stage does not install production dependencies, so the run-time imports above cannot be found");
console.log(`${files.length} server files; run-time package imports: ${[...used.keys()].join(", ") || "none"}`);
for (const p of problems) console.log("  FAIL " + p); console.log(problems.length ? "RUNTIME DEPS GATE FAIL" : "RUNTIME DEPS GATE PASS"); process.exit(problems.length ? 1 : 0);
