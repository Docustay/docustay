// D-059: reloading the signing page keeps working: the link's secret is remembered in this tab (not in the address bar).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../docustay/web/src/routes/sign/pdf/+page.svelte", import.meta.url), "utf8");
test("the token is stored when present and read back when the address has none (not only after Stripe)", () => {
  assert.match(src, /if \(!t\) \{ try \{ t = sessionStorage\.getItem\("docustay:signtoken"\)/);
  assert.match(src, /else \{ try \{ sessionStorage\.setItem\("docustay:signtoken", t\)/);
  assert.doesNotMatch(src, /if \(!t && \(back\.paid \|\| back\.cancelled\)\)/);
});
