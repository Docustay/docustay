#!/usr/bin/env node
// GATE: (1) no identifier is used without being defined, in any Svelte or JS file under src/ (eslint no-undef); (2) the workspace app links to no removed route and calls no API path the server no longer has.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const r = spawnSync("npx", ["eslint", "--no-config-lookup", "-c", "eslint.undef.config.mjs", "src"], { encoding: "utf8" });
const out = (r.stdout + r.stderr).trim();
const problems = [];
if (r.status !== 0) problems.push(`eslint no-undef:\n${out.split("\n").filter((l) => /^\/|error|warning/.test(l)).slice(0, 40).join("\n")}`);
// removed routes must not be linked from the workspace app (the public site folders are checked by the redirect gate)
const REMOVED = /[`"'(](\/forms(\/|\?|"|'|`)|\/f\/|\/automations|\/reports|\/contracts|\/kiosk|\/admin\/translations)/;
const files = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.(svelte|js)$/.test(p) ? [p] : []; });
for (const f of files("src")) {
  if (f.includes("/lib/site/") || f.includes("(site)") || f.endsWith("hooks.server.js") || f.endsWith("surface.js")) continue;
  readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (REMOVED.test(l) && !/^\s*(\/\/|\*)/.test(l)) problems.push(`${f}:${i + 1} links to a removed route: ${l.trim().slice(0, 120)}`); });
}
if (problems.length) { console.error(`undef-gate: ${problems.length} problem(s)\n${problems.join("\n")}`); process.exit(1); }
console.log("undef-gate: no undefined identifiers, no links to removed routes");
