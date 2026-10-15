// D-081: the chip counter counts text still being typed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const s = readFileSync(new URL("../docustay/web/src/lib/ui/ChipInput.svelte", import.meta.url), "utf8");
test("the counter adds the pending (typed, not yet a chip) pieces and the input reports each keystroke", () => {
  assert.match(s, /value\.length \+ pendingN/);
  assert.match(s, /oninput=\{\(e\) => \(pending = e\.currentTarget\.value\)\}/);
  assert.equal((s.match(/pending = ""/g) ?? []).length, 2);   // cleared when the text becomes a chip (Enter/comma and blur)
});
