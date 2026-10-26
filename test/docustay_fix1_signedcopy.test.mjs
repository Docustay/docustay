// D-009 — the signed-copy email does not say "attached" when the copy travels as a download link, in any language.
import test from "node:test";
import assert from "node:assert/strict";
import { signingWords } from "../src/documents/signingWords.mjs";
import { TRANSLATED_LANGUAGES } from "../src/documents/languages.mjs";

test("every translated language has a link wording that differs from its attachment wording and carries both placeholders", () => {
  assert.ok(TRANSLATED_LANGUAGES.length >= 13);
  for (const l of TRANSLATED_LANGUAGES) {
    const w = signingWords(l).signed, att = w.body("Titel", "Org"), link = w.bodyLink("Titel", "Org");
    assert.notEqual(link, att, l);
    assert.ok(link.includes("Titel") && link.includes("Org"), `${l}: ${link}`);
  }
});
