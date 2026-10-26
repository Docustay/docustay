// D-037: a mouse click on a tile arms it; the next page click puts the field centred on that click (the pure geometry is the same the page uses).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../docustay/web/src/lib/editor/FieldsStep.svelte", import.meta.url), "utf8");
test("a mouse click arms the tool; a keyboard press or a phone places in the middle", () => {
  assert.match(src, /e\.detail > 0\) \{ tool = tool === type \? null : type; return; \}/);
  assert.match(src, /addField\(type, visiblePage\(\), 0\.5, 0\.4\)/);
});
test("placing centres the field on the click", () => {
  assert.match(src, /snap\(\(e\.clientX - r\.left\) \/ r\.width - d\.w \/ 2, e\.altKey\)/);
});
