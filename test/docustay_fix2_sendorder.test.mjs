// D-050: when everyone signs on this device nobody is emailed, so the Send step must not also say "They all get the email straight away."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../docustay/web/src/lib/editor/SendSummary.svelte", import.meta.url), "utf8");
test("the order sentence is shown only when somebody is emailed", () => {
  // R8-46/R8-62: the order line is now the last branch of one chain, after "email isn't set up" and "today's limit is used up" — the same plan.kind guard, and neither warning can show beside it.
  assert.match(src, /\{(?:#if|:else if) plan\.kind !== "none"\}<p[^>]*data-testid="send-order-line"/);
  assert.match(src, /\{#if plan\.kind !== "none" && noMail\}[^\n]*data-testid="send-no-mail"[^\n]*\{:else if plan\.kind !== "none" && limitRow\}[^\n]*data-testid="send-email-limit"[^\n]*\{:else if plan\.kind !== "none"\}<p[^>]*data-testid="send-order-line"/);
  assert.match(src, /They all get the email straight away\.[^\n]*\{\/if\}/);
});
test("the Who-signs side note is hidden when everyone signs on this device", () => {
  const p = readFileSync(new URL("../docustay/web/src/lib/editor/PeopleStep.svelte", import.meta.url), "utf8");
  assert.match(p, /\{#if !people\.length \|\| people\.some\(\(p\) => !inPerson\.has\(p\.role\)\)\}<p[^>]*data-testid="people-order-line"/);
  assert.match(p, /Everyone is emailed straight away\.[^\n]*\{\/if\}/);
});
