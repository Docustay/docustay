// D-010 / D-101 — which address carries a Docustay workspace's emailed links, and what happens when the service was started without the variable.
import test from "node:test";
import assert from "node:assert/strict";
import { chooseDocumentsBase, _resetMissingBaseWarning } from "../src/ports/documents.mjs";

const fallback = () => "https://app.example.test";
test("a Docustay workspace with the sign host set uses it; an own hostname beats it", () => {
  assert.equal(chooseDocumentsBase({ own: null, docustay: true, docustayBase: "https://sign.docustay.test", fallback }), "https://sign.docustay.test");
  assert.equal(chooseDocumentsBase({ own: "docs.acme.test", docustay: true, docustayBase: "https://sign.docustay.test", fallback }), "https://docs.acme.test");
});
test("a Workbench workspace keeps its own address and never warns", () => {
  _resetMissingBaseWarning(); const w = [];
  assert.equal(chooseDocumentsBase({ own: null, docustay: false, docustayBase: "https://sign.docustay.test", fallback, warn: (m) => w.push(m) }), "https://app.example.test");
  assert.equal(w.length, 0);
});
test("a Docustay workspace on a service WITHOUT the variable falls back but says so, once", () => {
  _resetMissingBaseWarning(); const w = [];
  assert.equal(chooseDocumentsBase({ own: null, docustay: true, docustayBase: null, fallback, warn: (m) => w.push(m) }), "https://app.example.test");
  chooseDocumentsBase({ own: null, docustay: true, docustayBase: null, fallback, warn: (m) => w.push(m) });
  assert.equal(w.length, 1); assert.match(w[0], /KEYSTONE_DOCUSTAY_SIGN_URL/);
});
