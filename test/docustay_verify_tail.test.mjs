// D-016 — the Verify page's "the seal covers the whole file" must be true. What follows the last signed range may only be Docustay's own validation material (a DSS: the timestamp authority's certificates and OCSP answers); anything else, including content hidden in compressed streams, means the file is not exactly what was sealed.
// Fixture: a real sealed PDF produced by the sandbox (made-up people). Run: node test/docustay_verify_tail.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { verifyPdfBytes } = await import(pathToFileURL(path.join(ROOT, "docustay/web/src/lib/site/verify.js")).href);
const good = fs.readFileSync(path.join(ROOT, "test/fixtures/docustay-sealed-sample.pdf"));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };
const add = (s) => Buffer.concat([good, Buffer.from(s, "latin1")]);
const flip = (i) => { const b = Buffer.from(good); b[i] ^= 0xff; return b; };

await t("a genuine sealed file: intact, whole file, timestamped, signed by Docustay", async () => {
  const r = await verifyPdfBytes(good); assert.equal(r.valid, true); assert.equal(r.coversWholeFile, true); assert.equal(r.timestamped, true); assert.match(r.signer ?? "", /Docustay/);
});
await t("positive control: a byte changed inside the signed range is refused", async () => {
  const r = await verifyPdfBytes(flip(30000)); assert.equal(r.valid, false);
});
await t("bytes of a plain comment after the seal do not leave the file 'exactly what was sealed'", async () => {
  const r = await verifyPdfBytes(add("\n% added later\n")); assert.equal(r.coversWholeFile, false);
});
await t("an appended revision that adds visible content is not whole-file", async () => {
  const r = await verifyPdfBytes(add("\n77 0 obj\n<< /Type /Annot /Subtype /FreeText /Contents (PAID IN FULL) /Rect [10 10 200 40] >>\nendobj\ntrailer\n<< /Size 78 /Root 11 0 R >>\nstartxref\n0\n%%EOF\n"));
  assert.equal(r.coversWholeFile, false);
});
await t("an appended revision that hides its content in a compressed object stream, with a DSS marker to look harmless, is not whole-file", async () => {
  const r = await verifyPdfBytes(add("\n77 0 obj\n<< /Type /ObjStm /N 1 /First 8 /Length 12 /Filter /FlateDecode >>\nstream\nxxxxxxxxxxxx\nendstream\nendobj\n78 0 obj\n<< /Type /DSS /Certs [77 0 R] >>\nendobj\ntrailer\n<< /Size 79 /Root 11 0 R >>\nstartxref\n0\n%%EOF\n"));
  assert.equal(r.coversWholeFile, false);
});
await t("an appended catalogue that changes more than adding /DSS (an automatic action) is not whole-file", async () => {
  const r = await verifyPdfBytes(add("\n11 0 obj\n<< /Type /Catalog /Pages 10 0 R /OpenAction << /S /JavaScript /JS (app.alert(1)) >> /DSS 41 0 R >>\nendobj\ntrailer\n<< /Size 79 /Root 11 0 R >>\nstartxref\n0\n%%EOF\n"));
  assert.equal(r.coversWholeFile, false);
});
console.log(`ok — ${n} cases`);
