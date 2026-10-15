// F994 shipped ChatAssistant.svelte using <AiUsageBar> and <ThinkHarder> with no import: opening Scribe threw "AiUsageBar is not defined". Every capitalised component tag in a Svelte file must be imported or declared in it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
const root = new URL("../docustay/web/src/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".svelte") ? [p] : []; });
test("no Svelte file uses a component it does not import", () => {
  const bad = [];
  for (const f of walk(root)) {
    const s = readFileSync(f, "utf8");
    const tags = new Set([...s.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]));
    for (const t of tags) {
      if (["Svelte"].includes(t)) continue;
      const declared = new RegExp(`import\\s+(?:[^;]*\\b${t}\\b[^;]*)from|\\b(?:const|let|function|class)\\s+${t}\\b|\\{@const\\s+${t}\\b|\\{#snippet\\s+${t}\\b|\\{#await\\s+import\\([^)]*\\)\\s+then\\s+\\{\\s*default:\\s*${t}\\s*\\}`).test(s);
      if (!declared) bad.push(`${path.relative(root, f)}: <${t}>`);
    }
  }
  assert.deepEqual(bad, []);
});
