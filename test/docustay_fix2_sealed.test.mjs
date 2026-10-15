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
