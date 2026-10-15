// D-070: Forms "Save settings" confirms. The cause: toast is a function, so toast.success?.() was a silent no-op.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const src = readFileSync(new URL("../docustay/web/src/routes/(app)/forms/+page.svelte", import.meta.url), "utf8");
test("the form page calls toast() itself, never the non-existent toast.success", () => {
  assert.doesNotMatch(src, /toast\.success/);
  assert.match(src, /toast\(t\("Saved\."\), "ok"\)/);
});
test("no screen in the app uses the dead toast.<tone>() form", () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "site" || e.name === "(site)" ? [] : walk(`${d}/${e.name}`)) : /\.(svelte|js)$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const bad = walk(new URL("../docustay/web/src", import.meta.url).pathname).filter((f) => /\btoast\.(success|error|info|message)\b/.test(readFileSync(f, "utf8")) && !f.endsWith("toast.js"));
  assert.deepEqual(bad, []);
});
