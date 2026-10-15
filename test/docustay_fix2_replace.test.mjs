// D-036: replacing a draft's file — the title follows the new file unless the person renamed the document.
import test from "node:test";
import assert from "node:assert/strict";
import { titleAfterReplace } from "../src/documents/engine/revise.mjs";
test("a title that is the old file's name follows the new file", () => {
  assert.equal(titleAfterReplace({ oldTitle: "sealed-rules", oldFileName: "sealed-rules.pdf", newTitle: "rules-v2" }), "rules-v2");
  assert.equal(titleAfterReplace({ oldTitle: "sealed-rules.pdf", oldFileName: "sealed-rules.pdf", newTitle: "rules-v2" }), "rules-v2");
});
test("a title the person typed is kept (positive control: the same call without a rename changes)", () => {
  assert.equal(titleAfterReplace({ oldTitle: "Lease for Maya", oldFileName: "sealed-rules.pdf", newTitle: "rules-v2" }), "Lease for Maya");
});
test("with no new title the old one stays", () => {
  assert.equal(titleAfterReplace({ oldTitle: "a", oldFileName: "a.pdf", newTitle: "" }), "a");
});
