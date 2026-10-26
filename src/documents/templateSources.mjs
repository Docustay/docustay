// Part 30 item 7 — documents and templates made from SOURCE a developer writes: HTML with text tags, or a PDF/Word file with text tags in it. One door for the staff route and the public API.
import { acceptUpload } from "./files.mjs";
import { renderHtmlDocument } from "./htmlDocument.mjs";
import { savePdfTemplate, deletePdfDraft } from "./pdfDocs.mjs";
import { beforeNewTemplate } from "./templateCap.mjs";
import { promoteSuggestions } from "./detect/promote.mjs";
import { emit, userActor } from "../events/outbox.mjs";

/** HTML (with `{{Name;type=signature;role=Buyer}}` tags) → a draft document with the fields placed. */
export async function createFromHtml(tx, { tenantId, actorUserId = null, name, html, paper = "letter", typeset = null }) {
  const title = (name ?? "").trim() || "Document";
  const r = await renderHtmlDocument({ html, paper, title, typeset });
  const up = await acceptUpload(tx, { tenantId, actorUserId, name: `${title}.pdf`, bytes: r.bytes, title, origin: "created", preset: { roles: r.roles, fields: r.fields, warnings: r.warnings } });
  return { ...up, tags: r.tagCount, warnings: r.warnings };
}

/** The same, kept as a reusable TEMPLATE (the working draft is removed). `source` is {html} or {bytes, fileName} for a PDF/Word/image file carrying text tags. */
export async function createTemplateFromSource(tx, { tenantId, actorUserId = null, name, source, paper = "letter", typeset = null, fieldsAuto = false, minConfidence = 0.6, kind = "document", how = "source", builtin = null, newVersion = false }) {
  if (!builtin && !newVersion) await beforeNewTemplate(tx, { tenantId });   // R13-D444: a new VERSION of an existing template is not a new template (it was counted, and refused at 5 of 5)   // a built-in (the library's master, Run 9 Part 4R) is never the workspace's new template   // Run 8: refuse at the monthly cap BEFORE the file is printed and stored (savePdfTemplate checks again, under the same lock)
  const draft = source.html !== undefined
    ? await createFromHtml(tx, { tenantId, actorUserId, name, html: source.html, paper, typeset })
    : await acceptUpload(tx, { tenantId, actorUserId, name: source.fileName, bytes: source.bytes, title: name });
  let placed = draft.tags ?? draft.flags?.tagged ?? 0, detected = null;
  // R13-D199: an upload only checks page fingerprints (a form sent before), so `fields: "auto"` runs the full detector here, the same pass as the editor's "Find fields"
  if (source.html === undefined && !placed && fieldsAuto && !draft.detection?.remembered) {
    const { findFieldsOnDraft } = await import("./detect/find.mjs");
    const f = await findFieldsOnDraft(tx, { instanceId: draft.instanceId }).catch(() => null);
    if (f) draft.detection = f.note;
  }
  if (source.html === undefined && !placed && draft.detection) {
    // `fields: "auto"`: the boxes the detector is sure about become the template's fields; the rest are left out (a template keeps no suggestions)
    detected = { fields: draft.detection.fields, signers: draft.detection.signers, lowConfidence: draft.detection.lowConfidence, placed: 0 };
    if (fieldsAuto) {
      const { rows: [i] } = await tx.query(`SELECT template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [draft.instanceId]);
      const out = promoteSuggestions(i.template_body_snapshot, { minConfidence });
      await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, updated_at = now() WHERE id = $1`, [draft.instanceId, JSON.stringify(out.body)]);
      placed = out.placed; detected.placed = out.placed;
    }
  }
  const { templateId } = await savePdfTemplate(tx, { tenantId, instanceId: draft.instanceId, name, actorUserId, kind, how, builtin, newVersion });
  await deletePdfDraft(tx, { tenantId, instanceId: draft.instanceId });
  if (detected) await emit(tx, { tenantId, topic: "documents.template.fields_detected", emittedBy: "documents", subjectType: "document_template", subjectId: templateId, actor: userActor(actorUserId), payload: { template_id: templateId, fields_found: detected.fields, signers: detected.signers, low_confidence: detected.lowConfidence, placed: detected.placed } });
  return { templateId, fields: placed, warnings: draft.warnings ?? draft.flags?.tagWarnings ?? [], ...(detected ? { detected } : {}) };
}
