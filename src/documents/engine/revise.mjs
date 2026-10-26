// EDIT THE WORDS UNTIL SEND, and REPLACE THE FILE (Docustay flow v3, B2). A draft is never edited in place: the new words are printed through the same pipeline into a NEW draft, the people, the send choices and the title
// are carried over, and the old draft is removed. A draft was never sent, so nothing is lost by a new id. Everything here is additive; nothing in the platform calls it.
import { invalid, notFound, conflict } from "../../http/errors.mjs";
import { parsePdfBodyData } from "../pdfBody.mjs";
import { deletePdfDraft } from "../pdfDocs.mjs";
import { createSourceDocument } from "./creation.mjs";

async function loadDraft(tx, instanceId) {
  const { rows: [o] } = await tx.query(`SELECT id, title, state, builder, message, description, send_options, scheduled_send_at, template_body_snapshot, source, source_facts, source_paper, variable_values FROM keystone.document_instance WHERE id = $1 AND archived_at IS NULL`, [instanceId]);
  if (!o) throw notFound("That document is not in this workspace.");
  if (o.builder !== "pdf") throw invalid("this is not an uploaded document", { code: "wrong_builder" });
  if (o.state !== "draft") throw conflict("Only a draft can be changed. A document that was sent is voided and made again.");
  return o;
}
const partiesOf = async (tx, id) => (await tx.query(`SELECT role, action_role, position, name, email, phone, external_ref, expires_at, reminder_days, assists_role, group_label, witness_required FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [id])).rows;

/** Put the old draft's people and choices on the new draft. `seatOf(oldKey)` says which seat each person now sits in. */
async function carryOver(tx, { tenantId, o, parties, nid, seatOf, extraRoles = [] }) {
  const { rows: [n] } = await tx.query(`SELECT template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [nid]);
  let body = n.template_body_snapshot;
  if (extraRoles.length) { body = parsePdfBodyData({ ...body, roles: [...body.roles, ...extraRoles] }); await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb WHERE id = $1`, [nid, JSON.stringify(body)]); }
  const so = { ...(o.send_options ?? {}) };
  if (Array.isArray(so.in_person)) so.in_person = so.in_person.map(seatOf);
  if (Array.isArray(so.embedded)) so.embedded = so.embedded.map(seatOf);
  await tx.query(`UPDATE keystone.document_instance SET message = $2, description = $3, send_options = $4::jsonb, scheduled_send_at = $5, variable_values = $6::jsonb WHERE id = $1`,
    [nid, o.message, o.description, JSON.stringify(so), o.scheduled_send_at, o.variable_values ? JSON.stringify(o.variable_values) : null]);
  for (const p of parties) {
    await tx.query(`INSERT INTO keystone.document_party (tenant_id, instance_id, role, action_role, position, name, email, phone, external_ref, expires_at, reminder_days, assists_role, group_label, witness_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [tenantId, nid, seatOf(p.role), p.action_role, p.position, p.name, p.email, p.phone, p.external_ref, p.expires_at, p.reminder_days, p.assists_role ? seatOf(p.assists_role) : null, p.group_label ?? null, p.witness_required === true]);
  }
}

/** New words for a draft that was made from words. Returns { instanceId } (a new id) and what changed. */
export async function reviseSourceDocument(tx, { tenantId, actorUserId = null, instanceId, source, facts = {}, paper = null, roleMap = {}, variableValues = undefined }) {
  const o = await loadDraft(tx, instanceId);
  if (!o.source) throw invalid("The words of this document cannot be changed: it was made from an uploaded file. Use Replace file instead.", { code: "no_source" });
  const made = await createSourceDocument(tx, { tenantId, actorUserId, title: o.title, source, facts, paper: paper === "a4" ? "a4" : paper === "letter" ? "letter" : (o.source_paper ?? "letter"), requireSignature: false, variableValues: variableValues ?? o.variable_values ?? null });
  const nid = made.instanceId;
  const { rows: [n] } = await tx.query(`SELECT template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [nid]);
  const oldRoles = o.template_body_snapshot?.roles ?? [], newRoles = [...(n.template_body_snapshot?.roles ?? [])];
  const labelOf = (key) => oldRoles.find((r) => r.key === key)?.label ?? key;
  const map = new Map(), extra = []; const used = new Set(newRoles.map((r) => r.key));
  const parties = await partiesOf(tx, instanceId);
  for (const p of parties) {
    const lbl = roleMap?.[labelOf(p.role)] ?? labelOf(p.role); const hit = newRoles.find((r) => r.label === lbl);
    if (hit) { map.set(p.role, hit.key); continue; }
    let k = 1; while (used.has(`signer_${k}`)) k += 1; const key = `signer_${k}`; used.add(key); map.set(p.role, key); extra.push({ key, label: lbl });   // a person whose words left the text keeps a seat
  }
  await carryOver(tx, { tenantId, o, parties, nid, seatOf: (k) => map.get(k) ?? k, extraRoles: extra });
  // what the assistant did to the old draft stays attached to the new id (so require_review still knows the words are assistant-written; chat cards keep pointing at the right draft)
  await tx.query(`UPDATE keystone.document_chat_proposal SET document_id = $2 WHERE document_id = $1`, [instanceId, nid]);
  await deletePdfDraft(tx, { tenantId, instanceId });
  return { instanceId: nid, previousInstanceId: instanceId, warnings: made.warnings ?? [], hash: made.hash };
}

/** D-036: the document keeps a title the person typed; one that still matches the old file's name follows the new file. */
export function titleAfterReplace({ oldTitle, oldFileName, newTitle }) {
  const baseOf = (n) => String(n ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const renamed = Boolean(oldFileName) && oldTitle !== baseOf(oldFileName) && oldTitle !== oldFileName;
  return renamed || !newTitle ? oldTitle : newTitle;
}

/** The new file (already uploaded as its own draft, `withInstanceId`) takes over the old draft's people, seats, send choices and the fields that still fit on its pages. */
export async function replaceDraftFile(tx, { tenantId, instanceId, withInstanceId }) {
  if (instanceId === withInstanceId) throw invalid("Pick a different file.", { field: "withInstanceId" });
  const o = await loadDraft(tx, instanceId); const w = await loadDraft(tx, withInstanceId);
  const pages = w.template_body_snapshot?.file?.page_count ?? 1;
  const keep = (o.template_body_snapshot?.fields ?? []).filter((f) => f.page <= pages);
  const dropped = (o.template_body_snapshot?.fields ?? []).length - keep.length;
  const roles = o.template_body_snapshot?.roles ?? [];
  const body = parsePdfBodyData({ ...w.template_body_snapshot, roles: roles.length ? roles : w.template_body_snapshot.roles, fields: keep, suggestions: [] });
  // D-036: the title follows the new file unless the person renamed the document (its title no longer matches the old file's name)
  const title = titleAfterReplace({ oldTitle: o.title, oldFileName: o.template_body_snapshot?.file?.name, newTitle: w.title });
  await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, title = $3 WHERE id = $1`, [withInstanceId, JSON.stringify(body), title]);
  const parties = await partiesOf(tx, instanceId);
  await carryOver(tx, { tenantId, o, parties, nid: withInstanceId, seatOf: (k) => k });
  await deletePdfDraft(tx, { tenantId, instanceId });
  return { instanceId: withInstanceId, previousInstanceId: instanceId, fieldsKept: keep.length, fieldsDropped: dropped };
}
