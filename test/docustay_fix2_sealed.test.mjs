// D-094: a file that already carries a digital signature says so on Prepare instead of failing on the first placed field.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page = readFileSync(new URL("../docustay/web/src/routes/(app)/documents/[id]/edit/+page.svelte", import.meta.url), "utf8");
test("Prepare shows the sentence for a signed file (reads the same meta flag the server refuses on)", () => {
  assert.match(page, /meta\?\.already_signed/);
  assert.match(page, /data-testid="prepare-sealed"/);
  assert.match(readFileSync(new URL("../src/documents/pdfDocs.mjs", import.meta.url), "utf8"), /f\.meta\?\.already_signed && parsed\.fields\.length/);
});
test("R13-D449: the send check does not ask for a signature field on a signed file; it gives ONE plain refusal instead", () => {
  const src = readFileSync(new URL("../src/documents/pdfDocs.mjs", import.meta.url), "utf8");
  const i = src.indexOf("if (scannedOnly && checklist.items.some(");
  assert.ok(i > 0, "the signed-file branch exists");
  const block = src.slice(i, i + 1200);
  assert.match(block, /checklist\.items = checklist\.items\.filter\(\(x\) => !\/ has no signature field — place one\$\/\.test/);
  assert.match(block, /code: "already_signed_pdf"/);
  assert.match(block, /checklist\.ok = false;/, "still not ready to send");
  assert.doesNotMatch(block, /\(cc\)/, "never offers a copy-only send (a send needs a signer)");
  assert.match(readFileSync(new URL("../src/documents/pdfBody.mjs", import.meta.url), "utf8"), /has no signature field — place one/, "control: an ordinary file still asks for one");
});
test("R13-D449: Send refuses a signed file with the same words as Check", () => {
  const send = readFileSync(new URL("../src/documents/pdfSend.mjs", import.meta.url), "utf8");
  assert.match(send, /import \{ ALREADY_SIGNED_REFUSAL \} from "\.\/pdfDocs\.mjs";/);
  assert.match(send, /if \(signedFile && check\.items\.some\([\s\S]{0,200}check\.items\.unshift\(\{ ok: false, severity: "error", text: ALREADY_SIGNED_REFUSAL \}\)/);
});
