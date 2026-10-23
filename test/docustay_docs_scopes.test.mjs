// D-039 — the scopes the docs list are the scopes the Add API key dialog offers (it filters the grantable set; the docs table must name exactly those).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GRANTABLE_SCOPES } from "../src/developer/scopes.mjs";

const panel = readFileSync(new URL("../docustay/web/src/lib/DeveloperPanel.svelte", import.meta.url), "utf8");
const doc = readFileSync(new URL("../docustay/docs/authentication.md", import.meta.url), "utf8");

test("the docs' scope table names exactly the scopes the key dialog offers", () => {
  const m = panel.match(/\/\^\(([a-z|]+)\):\/\.test\(x\) \|\| x === "([a-z]+:[a-z]+)"/);
  assert.ok(m, "could not find the dialog's scope filter in DeveloperPanel.svelte");
  const re = new RegExp(`^(${m[1]}):`);
  const offered = GRANTABLE_SCOPES.filter((x) => re.test(x) || x === m[2]).sort();
  const table = doc.slice(doc.indexOf("## Scopes"), doc.indexOf("A key can only carry scopes"));
  const documented = [...table.matchAll(/^\| `([a-z]+:[a-z]+)` \|/gm)].map((x) => x[1]).sort();
  assert.deepEqual(documented, offered);
  assert.ok(offered.length >= 12, "positive control: the dialog offers the twelve scopes the test session counted");
});
test("the description says how many scopes there are, and not two", () => {
  assert.doesNotMatch(doc, /the two scopes/i);
  assert.match(doc, /12 scopes/);
});
