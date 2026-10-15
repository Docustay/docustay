// PDF FIELD DETECTION · THE DETECT-ONLY CALL (POST /api/v1/documents/detect-fields, the MCP tool, the CLI): a file in, the fields found out, nothing stored. Reads a PDF.
import { invalid } from "../../http/errors.mjs";
import { sniffUpload } from "../files.mjs";
import { stripActiveContent, inspectPdf, PdfProblem } from "../pdfProcess.mjs";
import { detect } from "./index.mjs";
import { suggestionsFrom } from "./toBody.mjs";

/** @returns {Promise<{fields, signers, pages, documents, summary, notes}>} fields carry confidence (0–1) and source; below `minConfidence` they are listed with `uncertain: true` rather than dropped. */
export async function detectUpload({ bytes, fileName = "document.pdf", minConfidence = 0.6, ocr = true }) {
  await sniffUpload(bytes);   // PDF only: Docustay only accepts PDF files
  let pdf = bytes;
  try { pdf = (await stripActiveContent(pdf)).bytes; await inspectPdf(pdf); } catch (e) { if (e instanceof PdfProblem) throw invalid(e.message, { code: e.code }); throw e; }
  const r = await detect(pdf, { timeoutMs: 45_000, ocr });
  if (!r.ok) throw invalid(r.reason === "timeout" ? "That file took too long to read. Try fewer pages." : "That file could not be read for fields.", { code: r.reason === "timeout" ? "detect_timeout" : "detect_failed" });
  const out = suggestionsFrom(r.result);
  return {
    fields: out.suggestions.map(({ id, why, ...f }) => ({ id, ...f, uncertain: f.confidence < minConfidence })),
    signers: out.roles.map((x) => ({ key: x.key, label: x.label })), pages: out.note.pages, documents: out.note.documents,
    summary: { fields: out.note.fields, signers: out.note.signers, uncertain: out.suggestions.filter((f) => f.confidence < minConfidence).length, truncated: out.note.truncated, cached: r.cached === true },
    notes: [r.result.pages.some((p) => p.scanned) ? "Some pages are pictures and were read by character recognition (English)." : null, out.note.truncated ? "Only the first pages were read." : null].filter(Boolean),
  };
}
