// src/documents/pdfKiosk.mjs — KIOSK SIGNING (QUEUE §23.5.2). A shared tablet at the front desk: staff opens a one-signer template in kiosk mode, each person types their name, signs on the device (no email), and the screen returns to the start for the next person.
// ★ Each person gets their OWN document (a copy of the template, titled with their name), so every signature has its own record, certificate and audit trail — exactly as if it had been sent.
import { invalid, notFound } from "../http/errors.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { createPdfFromTemplate, savePdfDocument } from "./pdfDocs.mjs";
import { sendPdfDocument, signNowLink } from "./pdfSend.mjs";

/** The templates a kiosk can run: uploaded-document templates with exactly one signing seat. → [{id,name}] */
export async function kioskTemplates(tx) {
  const { rows } = await tx.query(`SELECT id, name, body FROM keystone.document_template WHERE builder = 'pdf' AND active AND approval_status = 'approved' ORDER BY name`);
  return rows.filter((r) => { try { return parsePdfBodyData(r.body).roles.length === 1; } catch { return false; } }).map((r) => ({ id: r.id, name: r.name }));
}

/** One person steps up: make their document, send it "in person", return the link that opens it on THIS device. */
export async function kioskStart(tx, { tenantId, actorUserId = null, templateId, name, email = null }) {
  const person = String(name ?? "").trim();
  if (!person) throw invalid("Type your name to begin.", { field: "name" });
  const { rows: [t] } = await tx.query(`SELECT id, name, body FROM keystone.document_template WHERE id = $1 AND builder = 'pdf' AND active AND approval_status = 'approved'`, [templateId]);
  if (!t) throw notFound("no such uploaded-document template");
  const body = parsePdfBodyData(t.body);
  if (body.roles.length !== 1) throw invalid("Kiosk mode needs a template with exactly one person signing.", { field: "templateId" });
  const seat = body.roles[0].key;
  const created = await createPdfFromTemplate(tx, { tenantId, templateId, actorUserId, title: `${t.name} — ${person}` });
  await savePdfDocument(tx, { tenantId, actorUserId, instanceId: created.instanceId, parties: [{ role: seat, name: person, email: email?.trim() || null, action_role: "signer" }], sendOptions: { in_person: [seat], order: "parallel", expiry_days: 1, verification: "none", kiosk: true } });
  await sendPdfDocument(tx, { tenantId, instanceId: created.instanceId, actorUserId });
  const { rows: [p] } = await tx.query(`SELECT id FROM keystone.document_party WHERE instance_id = $1`, [created.instanceId]);
  const { presented } = await signNowLink(tx, { tenantId, instanceId: created.instanceId, partyId: p.id });
  return { instanceId: created.instanceId, presented };
}
