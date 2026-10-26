// D-040: after an explicit Sign out the login page does not start the passkey autofill (which signed the person straight back in).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const w = (p) => readFileSync(new URL(`../docustay/web/src/routes/${p}`, import.meta.url), "utf8");
test("sign out leaves a one-shot flag; login reads and clears it, and only autofills without it", () => {
  assert.match(w("(app)/+layout.svelte"), /sessionStorage\.setItem\("ds-signed-out", "1"\)/);
  const login = w("(auth)/login/+page.svelte");
  assert.match(login, /sessionStorage\.removeItem\("ds-signed-out"\)/);
  assert.match(login, /if \(passkeyOffered && !justOut\) startAutofill\(\)/);
});
