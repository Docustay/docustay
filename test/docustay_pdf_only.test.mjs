// the maintainer, 9 Oct 2026: Docustay converts nothing, and only PDF files can be uploaded. The decision is the file's own first bytes, never its name or its claimed type.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "@cantoo/pdf-lib";
import { sniffUpload, ACCEPTED_FORMATS, PDF_ONLY_MESSAGE } from "../src/documents/files.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF\0"), Buffer.alloc(40)]);
const zipLike = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(60), Buffer.from("word/document.xml")]);   // what a .docx / .xlsx / .pptx starts with
const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(40)]);

test("only a real PDF passes; every other type is refused in the one sentence", async () => {
  const doc = await PDFDocument.create(); doc.addPage([612, 792]);
  const pdf = Buffer.from(await doc.save());
  assert.equal((await sniffUpload(pdf)).kind, "pdf");                                                   // positive control: the same call takes a PDF
  assert.equal((await sniffUpload(Buffer.concat([Buffer.alloc(100, 0x20), pdf]))).kind, "pdf");           // junk before the header, inside the first 1024 bytes, is the PDF spec's allowance
  for (const [label, bytes] of [["PNG", png], ["JPEG", jpg], ["HEIC", heic], ["DOCX/XLSX/PPTX (zip)", zipLike], ["text renamed .pdf", Buffer.from("this is not a pdf at all")], ["header too late", Buffer.concat([Buffer.alloc(2000, 0x20), pdf])]]) {
    await assert.rejects(() => sniffUpload(bytes), (e) => e.message === PDF_ONLY_MESSAGE, label);
  }
  assert.equal(PDF_ONLY_MESSAGE, "Docustay only accepts PDF files.");
  assert.deepEqual([...ACCEPTED_FORMATS], ["PDF"]);
});
