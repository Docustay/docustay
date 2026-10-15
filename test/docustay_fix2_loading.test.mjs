// D-062: a list says "loading", never "nothing here", until its first answer is in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Plays moved its list into the Skills screen (Launch step 7); the loaded flag lives where the list does
const page = (n) => readFileSync(new URL(n === "plays" ? "../docustay/web/src/lib/screens/Skills.svelte" : `../docustay/web/src/routes/(app)/${n}/+page.svelte`, import.meta.url), "utf8");
for (const n of ["plays", "people", "forms"]) test(`${n}: the empty sentence is behind the loaded flag, and the flag is set by the first answer`, () => {
  const s = page(n);
  assert.match(s, /let (?:.*\b)?loaded = \$state\(false\)/);
  assert.match(s, /loaded = true/);
  assert.match(s, /data-testid="list-loading"/);
});
test("the sidebar does not show a placeholder workspace name before the real one arrives", () => {
  const s = readFileSync(new URL("../docustay/web/src/routes/(app)/+layout.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(s, /wsName = \$state\("Your workspace"\)/);
});
