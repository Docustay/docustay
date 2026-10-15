// Getting a PDF ready for the sealing library (split out of pdf.mjs so the seal test and the sealer import one small module).
/**
 * D-017 — @signpdf/placeholder-plain wrote `/Fields [%E 0 R 126 0 R]` (a corrupt object reference) when the PDF it was given had an EMPTY `/Fields [ ]`, which flattened and merged documents have, and the sealed file could then not be opened by strict tools.
 * An AcroForm with no fields has nothing to keep, so it is removed before the placeholder is added (the library then writes a clean one). A PDF with real form fields is returned untouched. Written to a classic cross-reference table, which the placeholder step needs.
 */
export async function prepareForSeal(bytes) {
  // ★ Run 8 (R8-17): what the seal covers carries no script or launch action, even for a template uploaded before the upload step could see them (object streams). A file that already
  //   carries someone's digital signature is left as it is (rewriting it would break that signature), the same rule as at upload.
  { const { stripActiveContent, hasDigitalSignature } = await import("./pdfProcess.mjs");
    if (!hasDigitalSignature(bytes)) { try { const r = await stripActiveContent(bytes); if (r.removed.length) bytes = Buffer.from(r.bytes); } catch (e) { console.error(`seal: active content could not be checked (${e?.message ?? e}); sealed as it is`); } } }
  const { PDFDocument, PDFName, PDFArray } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const acro = doc.catalog.lookup(PDFName.of("AcroForm")); if (!acro) return bytes;
  const fields = typeof acro.lookup === "function" ? acro.lookup(PDFName.of("Fields")) : null;
  if (fields instanceof PDFArray && fields.size() > 0) return bytes;
  doc.catalog.delete(PDFName.of("AcroForm"));
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

