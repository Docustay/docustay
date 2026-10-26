// D-095: the "keep as template" tick holds on the first click.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const s = readFileSync(new URL("../docustay/web/src/lib/editor/DetailsStep.svelte", import.meta.url), "utf8");
test("the tick has its own state and writes it through on change", () => {
  assert.match(s, /let keep = \$state\(o\.save_as_template \?\? doc\.defaults\?\.saveAsTemplate \?\? false\)/);
  assert.match(s, /checked=\{keep && !locked\} disabled=\{locked\} onchange=\{\(e\) => \{ keep = e\.currentTarget\.checked; set\(\{ save_as_template: keep \}\); \}\}/);
});
