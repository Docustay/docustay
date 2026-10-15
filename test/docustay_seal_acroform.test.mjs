// D-017 — @signpdf/placeholder-plain wrote `/Fields [%E 0 R 126 0 R]` (a corrupt object reference) when the PDF it was given had an empty `/Fields [ ]`, which flattened and merged documents have. The sealed file then could not be opened by strict tools (pyHanko: "Unexpected byte '>'").
// Fixture: the exact bytes that went into the seal for a starter signed by two people (made-up names). Run: node test/docustay_seal_acroform.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const base = fs.readFileSync(path.join(ROOT, "test/fixtures/docustay-presign-empty-acroform.pdf"));
const { prepareForSeal } = await import(pathToFileURL(path.join(ROOT, "src/documents/pdfPrepare.mjs")).href);
const place = (b) => Buffer.from(plainAddPlaceholder({ pdfBuffer: b, reason: "r", name: "n", location: "l", contactInfo: "c" })).toString("latin1");
const fieldLists = (s) => [...s.matchAll(/\/Fields\s*\[([^\]]*)\]/g)].map((m) => m[1]);
const validList = (x) => /^(\s*\d+\s+\d+\s+R)*\s*$/.test(x);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };

await t("positive control: without the fix the library really does write a corrupt field list for this input", () => {
  const lists = fieldLists(place(base)); assert.ok(lists.some((l) => !validList(l)), `expected a corrupt list, got ${JSON.stringify(lists)}`);
});
await t("after prepareForSeal every field list is made of valid object references and the field is named Signature1", async () => {
  const s = place(await prepareForSeal(base)); const lists = fieldLists(s);
  assert.ok(lists.length >= 1 && lists.every(validList), JSON.stringify(lists)); assert.deepEqual([...s.matchAll(/\/T \((Signature\d+)\)/g)].map((m) => m[1]), ["Signature1"]);
});
await t("the prepared file is still a PDF with the same number of pages", async () => {
  const { PDFDocument } = await import("@cantoo/pdf-lib"); const a = await PDFDocument.load(base, { updateMetadata: false }), b = await PDFDocument.load(await prepareForSeal(base), { updateMetadata: false });
  assert.equal(b.getPageCount(), a.getPageCount());
});
await t("a PDF with real form fields is left alone (nothing to fix, nothing lost)", async () => {
  const { PDFDocument } = await import("@cantoo/pdf-lib"); const d = await PDFDocument.create(); d.addPage(); d.getForm().createTextField("name").addToPage(d.getPages()[0], { x: 10, y: 10 }); const withField = Buffer.from(await d.save());
  const prepared = Buffer.from(await prepareForSeal(withField)); assert.ok((await (await PDFDocument.load(prepared)).getForm().getFields()).length === 1);
});
console.log(`ok — ${n} cases`);
