// PDF FIELD DETECTION · SPLIT A PACKET (PDF-FIELD-DETECTION-SPEC §5, packets). A file made of several forms plus flyers and rate tables becomes one package: each form is its own document (a member of the package, with its own boxes found), and the reference pages
// travel as attachments on the first form ("no fields, attachment"). Uses the same package rules as a ZIP (package_lead_id, package_position). The original draft is removed once the parts exist.
import { PDFDocument } from "@cantoo/pdf-lib";
import { invalid, notFound, conflict } from "../../http/errors.mjs";
import { parsePdfBodyData } from "../pdfBody.mjs";
import { acceptUpload, acceptAttachment, readFileBytes } from "../files.mjs";
import { deletePdfDraft } from "../pdfDocs.mjs";
import { detect } from "./index.mjs";

async function slice(bytes, from, to) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }), out = await PDFDocument.create();
  const idx = []; for (let p = from; p <= to; p += 1) idx.push(p - 1);
  for (const pg of await out.copyPages(src, idx)) out.addPage(pg);
  return Buffer.from(await out.save());
}

export async function splitPacket(tx, { tenantId, actorUserId = null, instanceId }) {
  const { rows: [i] } = await tx.query(`SELECT title, state, template_body_snapshot FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL AND package_lead_id IS NULL`, [instanceId]);
  if (!i) throw notFound("no such uploaded document");
  if (i.state !== "draft") throw conflict("Only a draft can be split.", { code: "not_draft" });
  const body = parsePdfBodyData(i.template_body_snapshot ?? {});
  const { bytes } = await readFileBytes(tx, { fileId: body.file.file_id });
  let docs = body.detect?.documents;
  if (!docs?.length) { const r = await detect(bytes, { timeoutMs: 45_000 }); if (!r.ok) throw conflict("That file could not be read.", { code: "detect_failed" }); docs = r.result.documents; }
  const forms = docs.filter((d) => d.kind === "form"), refs = docs.filter((d) => d.kind === "reference");
  if (!forms.length) throw invalid("There is no form in this file to make a document from.", { code: "no_forms" });
  if (docs.length < 2) throw invalid("This file looks like one document, so there is nothing to split.", { code: "nothing_to_split" });
  const base = String(i.title || "Document").slice(0, 100), made = [];
  for (let k = 0; k < forms.length; k += 1) {
    const d = forms[k], part = await slice(bytes, d.from, d.to), title = (d.title && d.title.trim()) || (forms.length > 1 ? `${base} (part ${k + 1})` : base);
    const r = await acceptUpload(tx, { tenantId, actorUserId, name: `${title}.pdf`, bytes: part, title, position: 1 });
    made.push({ id: r.instanceId, title: r.title, pages: [d.from, d.to], fields: r.suggestions?.length ?? 0 });
  }
  const lead = made[0];
  for (let k = 1; k < made.length; k += 1) await tx.query(`UPDATE keystone.document_instance SET package_lead_id = $2, package_position = $3 WHERE id = $1`, [made[k].id, lead.id, k + 1]);
  const attached = [];
  for (const d of refs) { const part = await slice(bytes, d.from, d.to), name = `${(d.title && d.title.trim()) || "Reference"} (pages ${d.from}-${d.to}).pdf`; await acceptAttachment(tx, { tenantId, actorUserId, instanceId: lead.id, name, bytes: part }); attached.push({ name, pages: [d.from, d.to] }); }
  await deletePdfDraft(tx, { tenantId, instanceId });
  return { instanceId: lead.id, parts: made, attachments: attached };
}
