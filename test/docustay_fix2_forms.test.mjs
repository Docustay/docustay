// D-043 / D-044: the Forms picker offers only templates the server would publish; the card carries the link name.
// Run 7 (11 Oct 2026): the rule now lives in ONE place on the server — `formReasonOf` in pdfTemplates.mjs sends each template's reason with the list, and the page offers exactly the ones
// with no reason (so the screen can no longer drift from the server). A form may now have one person, or two when the second is a staff counter-signer (the maintainer's Run 7 decision 2).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../docustay/web/src/routes/(app)/forms/+page.svelte", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/documents/pdfTemplates.mjs", import.meta.url), "utf8");
const forms = readFileSync(new URL("../src/documents/forms.mjs", import.meta.url), "utf8");
test("the picker offers exactly what the server says can be published (approved, one person or one plus a counter-signer)", () => {
  assert.match(src, /const publishable = \$derived\(tpls\.filter\(\(x\) => !x\.formReason/);
  assert.match(src, /\{#each publishable as tp/);
  assert.match(src, /\{#each blocked as tp/, "the others are listed with their reason");
  assert.match(server, /if \(r\.approval_status !== "approved"\) return "not_approved";/);
  assert.match(server, /if \(Number\(r\.seats\) > 2\) return "too_many_people";/);
  assert.match(forms, /if \(seats !== 1 && !\(seats === 2 && clean0\.counterSign\?\.on\)\) throw invalid/, "publishing enforces the same rule");
});
test("the card shows the form's name and its link name; the detail shows the link", () => {
  assert.match(src, /<b class="block">\{f\.name\}<\/b>\{#if f\.slug\}<span class="block truncate text-xs text-mute">\/f\/…\/\{f\.slug\}<\/span>/);
  assert.match(src, /\{#if detail\.slug\}<FormShare link=\{link\(detail\)\}/);
});
