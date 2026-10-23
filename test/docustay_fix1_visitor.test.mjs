// D-072 — a stranger on a public form is never told about the owner's plan.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { VISITOR_UNAVAILABLE } from "../src/documents/pdfSend.mjs";

test("the visitor's sentence names no plan, no limit and no upgrade", () => {
  assert.doesNotMatch(VISITOR_UNAVAILABLE, /plan|Free|Pro|upgrade|limit|documents a month/i);
  assert.match(VISITOR_UNAVAILABLE, /can't take responses right now/);
});
test("both public entry points (forms and self-serve links) send as a visitor; staff sends do not", () => {
  const read = (p) => readFileSync(new URL(`../src/documents/${p}`, import.meta.url), "utf8");
  assert.match(read("pdfSelfServe.mjs"), /sendPdfDocument\(tx, \{[^}]*forVisitor: true/);
  const bulkFile = new URL("../pro/documents/pdfBulk.mjs", import.meta.url);   // closed add-on code: checked where it exists (the public export carries none)
  if (existsSync(bulkFile)) assert.doesNotMatch(readFileSync(bulkFile, "utf8"), /forVisitor/);
  assert.doesNotMatch(read("pdfApi.mjs"), /forVisitor/);
});
import { CHECKOUT_NOTE, CHECKOUT_BRAND } from "../src/product/docustay.mjs";
test("D-080 / F1045: both Docustay checkout sessions carry the one line naming Docustay and its company, the page name, and the default card-reuse paragraph hidden", () => {
  const code = readFileSync(new URL("../src/product/docustay.mjs", import.meta.url), "utf8");
  // both sessions (Pro and self-host) spread the same fields; the fields themselves are defined once
  assert.equal((code.match(/\.\.\.checkoutBranding\(/g) ?? []).length, 2);
  assert.match(code, /"custom_text\[submit\]\[message\]": checkoutNote\(planKey\)/);
  assert.match(code, /"branding_settings\[display_name\]": CHECKOUT_BRAND/);
  assert.match(code, /"consent_collection\[payment_method_reuse_agreement\]\[position\]": "hidden"/);
  assert.equal(CHECKOUT_BRAND, "Docustay");   // the maintainer, 13 Oct 2026: Docustay is not presented as a product of GLRS LLC on any public surface
  assert.match(CHECKOUT_NOTE, /subscribing to Docustay \(docustay\.app\)/); assert.doesNotMatch(CHECKOUT_NOTE, /FOUNDRY/);
  assert.match(CHECKOUT_NOTE, /cancel at any time/i);                      // positive control: the line says how to stop, not only who charges
  assert.doesNotMatch(`${CHECKOUT_BRAND} ${CHECKOUT_NOTE}`, /Workbench|Example Practice/);
  assert.ok(CHECKOUT_NOTE.length <= 1200, "Stripe's limit for the submit message");
});
import { DOCUMENT_SETTINGS as SETTINGS } from "../src/documents/settingsSchema.mjs";
test("D-093: the resubmit setting promises only what exists (a new response from a public-link form), never reopening a signed part", () => {
  const d = SETTINGS["signing.allow_resubmit"];
  assert.ok(d, "the setting still exists");
  assert.doesNotMatch(`${d.label} ${d.help}`, /take back|reopen their part|sign again/i);
  assert.match(d.help, /public link/);
});

import { checkoutNote } from "../src/product/docustay.mjs";
test("the Checkout footer is right for each plan (18 Oct 2026): Pay as you go, Pro, Lifetime and self-host", () => {
  const payg = checkoutNote("docustay_payg"), pro = checkoutNote("docustay_pro"), life = checkoutNote("docustay_lifetime"), self = checkoutNote("docustay_selfhost");
  assert.match(payg, /Pay as you go stays on/); assert.doesNotMatch(payg, /Pro stays on/); assert.match(payg, /15 documents and 10 AI drafts/);
  assert.match(pro, /Pro stays on/); assert.doesNotMatch(pro, /Pay as you go/);
  assert.match(life, /one payment, charged once/); assert.doesNotMatch(life, /each billing period|Pro stays on|subscribing/);
  assert.doesNotMatch(self, /Pro stays on|Pay as you go/);
  for (const n of [payg, pro, life, self]) assert.ok(n.length <= 1200 && !/FOUNDRY|Workbench/.test(n));
});
