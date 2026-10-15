// D-025 — a package that will be published must not depend on a local folder: `npm install @docustay2026/mcp` from the registry cannot resolve "file:../js". Run: node test/docustay_publishable_packages.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const bad = []; let publishable = 0;
for (const d of fs.readdirSync(path.join(ROOT, "sdk"))) {
  const f = path.join(ROOT, "sdk", d, "package.json"); if (!fs.existsSync(f)) continue; const p = JSON.parse(fs.readFileSync(f, "utf8")); if (p.private) continue; publishable++;
  for (const kind of ["dependencies", "peerDependencies", "optionalDependencies"]) for (const [name, range] of Object.entries(p[kind] ?? {})) if (/^(file|link|workspace):|^\.\.?\//.test(range)) bad.push(`sdk/${d}: ${kind}.${name} = ${range}`);
}
assert.ok(publishable >= 6, `control: the check saw ${publishable} publishable packages`);
assert.deepEqual(bad, [], `these would not install from a registry:\n${bad.join("\n")}`);
console.log(`ok — ${publishable} publishable packages depend on nothing local`);
