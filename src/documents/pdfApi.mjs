// src/documents/pdfApi.mjs — WHAT A DEVELOPER'S API KEY MAY DO WITH UPLOADED DOCUMENTS (QUEUE §23.5.8): list and read documents, list the templates that can be sent, send a template to people, void a live document.
// ★ Nothing here returns a signing link or a link token: an integration can start a signature and follow it; it cannot sign for anybody. The host mounts these behind its API-key check (`/api/v1/documents*`) and says
//   which scope each needs; the document is made AS the practice's owner (people port) so it has an author, and every event it causes is the ordinary one, so webhooks fire for API sends exactly as for screen sends.
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { createPdfFromTemplate, savePdfDocument } from "./pdfDocs.mjs";
import { signAsParty, declineAsParty } from "./pdfSigning.mjs";
import { sendPdfDocument, trackPdfDocument, voidPdfDocument, remindPdfParties, embedSessionLink } from "./pdfSend.mjs";
import { listPdfTemplates } from "./pdfTemplates.mjs";
import { readFileBytes } from "./files.mjs";
import { cleanReference, saveDocumentReference, documentReference } from "./reference.mjs";
import { cleanName } from "./textSafety.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const DOCUMENT_STATES = ["draft", "sent", "partially_signed", "executed", "declined", "void", "expired"];
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

/** A page of documents, newest first. `hasMore` is known from one extra row. */
export async function apiListDocuments(tx, { state = null, limit = 50, offset = 0, after = null, testOnly = false, filter = null } = {}) {
  if (state && !DOCUMENT_STATES.includes(state)) throw invalid(`state must be one of ${DOCUMENT_STATES.join(", ")}`, { field: "state" });
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.state, i.created_at, i.sent_at, i.executed_at, i.expires_at, i.is_test, i.external_id, i.metadata,
            to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_t,
            (SELECT count(*)::int FROM keystone.document_party p WHERE p.instance_id = coalesce(i.package_lead_id, i.id)) AS parties
       FROM keystone.document_instance i
      WHERE i.builder = 'pdf' AND i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id) AND ($1::text IS NULL OR i.state = $1) AND (NOT $4::boolean OR i.is_test)${(filter?.where ?? []).map((w) => ` AND ${w}`).join("")}
      AND ($5::timestamptz IS NULL OR i.created_at < $5::timestamptz OR (i.created_at = $5::timestamptz AND i.id > $6::uuid))
      ORDER BY i.created_at DESC, i.id LIMIT $2 OFFSET $3`, [state, limit + 1, after ? 0 : offset, testOnly === true, after?.t ?? null, after?.id ?? null, ...(filter?.params ?? [])]);
  return { rows: rows.slice(0, limit).map((r) => ({ id: r.id, title: r.title, state: r.state, parties: r.parties, test: r.is_test === true, externalId: r.external_id ?? null, metadata: r.metadata ?? {}, createdAt: iso(r.created_at), sentAt: iso(r.sent_at), executedAt: iso(r.executed_at), expiresAt: iso(r.expires_at) })), hasMore: rows.length > limit, next: rows.length > limit ? { t: rows[limit - 1].cursor_t, id: rows[limit - 1].id } : null };
}

/** A test key acts on test documents only: any other document answers exactly as a document that does not exist. Live keys are not restricted. */
export async function assertTestKeyMay(tx, { instanceId, testOnly = false }) {
  if (!testOnly) return;
  const { rows: [r] } = await tx.query(`SELECT is_test FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf'`, [instanceId]);
  if (!r || r.is_test !== true) throw notFound("no such document");
}

/** Run 7: the form a document is a response to — { id, name } (id = the form template's id, the one /api/v1/forms/{id} reads) — or null for a document someone sent. */
async function formOfDocument(tx, instanceId) {
  const { rows: [f] } = await tx.query(
    `SELECT t.id, t.name FROM keystone.document_instance i JOIN keystone.document_template t ON t.family_id = coalesce(i.form_id, (SELECT x.family_id FROM keystone.document_template x WHERE x.id = i.template_id))
      WHERE i.id = $1 AND i.source_channel = 'form' ORDER BY t.self_serve_slug IS NOT NULL DESC, t.version DESC LIMIT 1`, [instanceId]);
  return f ? { id: f.id, name: f.name } : null;
}

/** One document and where each person is. People are named by seat; no link, token or access code is ever included. */
export async function apiGetDocument(tx, { tenantId, instanceId }) {
  const t = await trackPdfDocument(tx, { tenantId, instanceId });
  const { rows: [tst] } = await tx.query(`SELECT is_test FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const ref = await documentReference(tx, instanceId);
  const form = await formOfDocument(tx, instanceId);
  // true only once the sealed file exists: a document is "executed" the moment the last person signs, but the worker seals the PDF a few seconds later (GET signed.pdf answers 404 until then)
  const sealed = t.state === "executed" && (await tx.query(`SELECT 1 FROM keystone.document_file WHERE instance_id = $1 AND kind = 'final' LIMIT 1`, [instanceId])).rowCount > 0;
  return {
    test: tst?.is_test === true, externalId: ref?.externalId ?? null, metadata: ref?.metadata ?? {},
    id: t.id, title: t.title, state: t.state, sentAt: iso(t.sentAt), expiresAt: iso(t.expiresAt), executedAt: iso(t.executedAt), voidedAt: iso(t.voidedAt), voidReason: t.voidReason ?? null,
    progress: t.progress, signedCopyAvailable: sealed, form,
    parties: t.parties.map((p) => ({ seat: p.seat, name: p.name, email: p.email, role: p.actionRole, externalId: ref?.partyRefs?.[p.seat]?.externalId ?? null, metadata: ref?.partyRefs?.[p.seat]?.metadata ?? {}, status: p.status, viewedAt: iso(p.viewedAt), completedAt: iso(p.completedAt), declineReason: p.declineReason ?? null })),
    events: t.timeline.map((e) => ({ at: iso(e.at), kind: e.kind, text: e.text })),
    payments: (t.payments ?? []).map((p) => ({ id: p.id, fieldId: p.fieldId ?? null, person: p.person, status: p.status, amountMinor: p.amountMinor, currency: p.currency, paidAt: iso(p.paidAt), receiptUrl: p.receiptUrl ?? null, refundedMinor: p.refundedMinor ?? 0,
      fee: { basisPoints: p.feeBps ?? 0, amountMinor: p.feeMinor ?? 0, refundedMinor: p.feeRefundedMinor ?? 0, plan: p.plan ?? null }, test: p.test === true })),
  };
}

/** The templates a key can send, with the seats each one needs filled. Waiting-for-approval and retired templates are not offered. */
export async function apiTemplates(tx) {
  const { templates } = await listPdfTemplates(tx, {});
  const out = [];
  for (const t of templates.filter((x) => x.active && x.approval_status === "approved")) {
    const { rows: [row] } = await tx.query(`SELECT body, metadata, external_id FROM keystone.document_template WHERE id = $1`, [t.id]);
    const body = parsePdfBodyData(row.body);
    out.push({ externalId: row.external_id ?? null, metadata: row.metadata ?? {}, id: t.id, name: t.name, pages: t.pages, seats: body.roles.map((r) => ({ key: r.key, label: r.label })) });
  }
  return out;
}

/** A typed name or title made safe to store (no control, bidi or zero-width characters, one space between words) and bounded: over `max` characters is a 400 that names the field; nothing left after cleaning is a 400 too. Exported for the one test of it. */
export function checkedText(raw, { max, label, field }) {
  const cleaned = cleanName(raw, { max: max + 1 });
  if (Array.from(cleaned).length > max) throw invalid(`${label} must be at most ${max} characters`, { field });
  if (!cleaned) throw invalid(`${label} is required`, { field });
  return cleaned;
}

/** Make a document from a template, put the named people on its seats, and send it. Every seat must be filled, once. */
/** R13-D344: the sender's own boxes ("Filled in by: Sender") and send-time amounts given with a send, kept as the document's custom values (senderBoxes.mjs reads custom.<key> at send). */
export async function setSendValues(tx, instanceId, values) {
  const vals = Object.fromEntries(Object.entries(values && typeof values === "object" && !Array.isArray(values) ? values : {}).filter(([k, v]) => /^[a-z][a-z0-9_]{0,40}$/.test(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 300)]));
  if (Object.keys(vals).length) await tx.query(`UPDATE keystone.document_instance SET custom_values = COALESCE(custom_values, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [instanceId, JSON.stringify(vals)]);
}

export async function apiSendFromTemplate(tx, { tenantId, ownerId, templateId, title = null, parties, message = null, subject = null, expiryDays = null, test = false, embedded = [], metadata, externalId, replyTo = null, senderName = null, values = null, signingOrder = null }) {
  const reference = cleanReference({ metadata, externalId, people: parties });
  if (!Array.isArray(parties) || parties.length === 0) throw invalid("parties is required: one entry for each seat of the template", { field: "parties" });
  // Round 3 (W1-6): the title (at most 300) and each person's name (at most 200) are cleaned and bounded before anything is stored — an over-long or NUL-carrying value is a 400, never a 500
  if (title != null && String(title).trim() !== "") title = checkedText(title, { max: 300, label: "title", field: "title" });
  const names = parties.map((p, i) => (p && typeof p === "object" && String(p.name ?? "").trim() ? checkedText(p.name, { max: 200, label: `parties[${i}].name`, field: "parties" }) : null));
  const { rows: [t] } = await tx.query(`SELECT body FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("no such template");
  const seats = parsePdfBodyData(t.body).roles.map((r) => r.key);
  const seen = new Set();
  const people = parties.map((p, i) => {
    if (!p || typeof p !== "object") throw invalid(`parties[${i}] is not an object`, { field: "parties" });
    if (!seats.includes(p.seat)) throw invalid(`parties[${i}].seat must be one of ${seats.join(", ")}`, { field: "parties" });
    if (seen.has(p.seat)) throw invalid(`seat “${p.seat}” is given twice`, { field: "parties" });
    seen.add(p.seat);
    const name = names[i], email = String(p.email ?? "").trim().toLowerCase();
    if (!name) throw invalid(`parties[${i}].name is required`, { field: "parties" });
    if (!EMAIL.test(email)) throw invalid(`parties[${i}].email is not a valid address`, { field: "parties" });
    return { role: p.seat, name, email, action_role: "signer" };
  });
  const missing = seats.filter((s) => !seen.has(s));
  if (missing.length) throw invalid(`no person given for seat ${missing.join(", ")}`, { field: "parties" });
  const bad = (embedded ?? []).find((s) => !seats.includes(s));
  if (bad) throw invalid(`embedded seat “${bad}” is not a seat of this template`, { field: "embedded" });
  const made = await createPdfFromTemplate(tx, { tenantId, templateId, actorUserId: ownerId, title });
  await saveDocumentReference(tx, made.instanceId, reference);
  await setSendValues(tx, made.instanceId, values);
  const { rows: [cur] } = await tx.query(`SELECT send_options FROM keystone.document_instance WHERE id = $1`, [made.instanceId]);
  const sendOptions = { ...(cur?.send_options ?? {}) };      // savePdfDocument REPLACES the options, so start from what the template already set
  if (expiryDays != null) sendOptions.expiry_days = expiryDays;
  if (signingOrder) sendOptions.order = signingOrder;   // R13-D420: the send route took embedded seats but no order
  if (subject) sendOptions.subject = subject;
  if (replyTo) sendOptions.reply_to = replyTo;
  if (senderName) sendOptions.sender_name = senderName;
  if (embedded?.length) { sendOptions.embedded = [...new Set(embedded)]; sendOptions.in_person = [...new Set([...(sendOptions.in_person ?? []), ...embedded])]; }   // an embedded seat is signed in the sender's own app: no email, a session link from the API
  if (test) sendOptions.test = true;          // a send made with a test API key is a practice run
  await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId: made.instanceId, parties: people, message: message ?? null, sendOptions });
  const sent = await sendPdfDocument(tx, { tenantId, instanceId: made.instanceId, actorUserId: ownerId });
  return { id: made.instanceId, state: "sent", emailed: sent.emailed ?? 0, notEmailed: sent.notEmailed ?? [], externalId: reference.externalId, metadata: reference.metadata };
}

/** A one-hour embedded signing session for a seat that was sent as embedded; the url goes in an iframe (or the <docustay-sign> element) on one of the organisation's allowed websites. */
export async function apiEmbedSession(tx, { tenantId, instanceId, seat, origin }) {
  if (!seat || typeof seat !== "string") throw invalid("seat is required", { field: "seat" });
  const t = await trackPdfDocument(tx, { tenantId, instanceId });
  if (!t.parties.some((x) => x.seat === seat)) throw invalid(`seat must be one of ${t.parties.map((x) => x.seat).join(", ")}`, { field: "seat" });
  const out = await embedSessionLink(tx, { tenantId, instanceId, seat, origin });
  return { id: instanceId, seat, url: out.url, expiresAt: out.expiresAt };
}

/** Void a live document. A document that is finished (signed, declined, expired, already void) cannot be voided — the same rule as the screen. */
export async function apiVoid(tx, { tenantId, instanceId, reason = null, ownerId = null }) {
  const t = await trackPdfDocument(tx, { tenantId, instanceId });
  if (!["sent", "partially_signed"].includes(t.state)) throw conflict(`this document is ${t.state} and cannot be voided`);
  const v = await voidPdfDocument(tx, { tenantId, instanceId, reason, actorUserId: ownerId });
  return { id: instanceId, state: "void", notified: v?.notified ?? 0 };   // R13-D222: how many people were emailed that it is cancelled (a test document: the one [TEST] notice to its sender)
}

/** The sealed copy of an executed document (with its certificate), read from the island's own file store and checked against its recorded fingerprint. 404 until it is signed and sealed. */
export async function apiSignedCopy(tx, { instanceId }) {
  const { rows: [f] } = await tx.query(
    `SELECT f.id, f.name FROM keystone.document_file f JOIN keystone.document_instance i ON i.id = f.instance_id
      WHERE f.instance_id = $1 AND i.builder = 'pdf' AND i.state = 'executed' AND f.kind = 'final' ORDER BY f.created_at DESC LIMIT 1`, [instanceId]);
  if (!f) {
    const { rows: [i] } = await tx.query(`SELECT state FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf'`, [instanceId]);
    if (i?.state === "executed") throw notFound("everyone has signed and the sealed copy is being made; it is ready a few seconds after the last signature — ask again shortly (signedCopyAvailable on the document turns true)");
    throw notFound("that document has no signed copy yet");
  }
  const { bytes } = await readFileBytes(tx, { fileId: f.id });
  return { bytes, name: f.name };
}

/** One template a key can send, with its seats. (A retired or unapproved one is not offered.) */
export async function apiTemplate(tx, { templateId }) {
  const list = await apiTemplates(tx);
  const t = list.find((x) => x.id === templateId);
  if (!t) throw notFound("no such template");
  return t;
}

/** Remind everyone who is up (or one seat). Returns how many were reminded. */
export async function apiRemind(tx, { tenantId, instanceId, seat = null }) {
  let partyId = null;
  if (seat) {
    const t = await trackPdfDocument(tx, { tenantId, instanceId });
    const p = t.parties.find((x) => x.seat === seat);
    if (!p) throw invalid(`seat must be one of ${t.parties.map((x) => x.seat).join(", ")}`, { field: "seat" });
    partyId = p.id;
  }
  const r = await remindPdfParties(tx, { tenantId, instanceId, partyId });
  return { id: instanceId, reminded: r.reminded };
}

// ── FP-D2 — SIGN A TEST DOCUMENT THROUGH THE API ──
// A developer's automated tests need a document to reach "signed" with no email and no browser. This signs ONE seat of a TEST document with sample answers, through the same signing code a person uses
// (consent, order, chain of signature records, audit events and webhooks all happen). Refused on any live document, and the route refuses a live key before this is reached.
const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SAMPLE_BY_VALIDATION = { email: "sample@example.com", phone: "+1 555 010 0199", number: "1", date: "2026-01-15", zip: "12345" };
function sampleValue(field) {
  if (["signature", "initials", "image", "stamp"].includes(field.type)) return ONE_PIXEL_PNG;
  if (field.type === "checkbox") return "true";
  if (field.type === "dropdown") return (field.options ?? [])[0] ?? null;
  if (field.type === "multiselect") return (field.options ?? []).length ? JSON.stringify([field.options[0]]) : null;
  if (field.type === "date_signed" || field.type === "payment" || field.type === "file") return null;
  return SAMPLE_BY_VALIDATION[field.validation] ?? "Sample answer";
}

export async function apiTestSign(tx, { tenantId, instanceId, seat, decline = false, reason = null }) {
  if (!seat || typeof seat !== "string") throw invalid("seat is required", { field: "seat" });
  const { rows: [doc] } = await tx.query(`SELECT id, is_test, state, template_body_snapshot AS body FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf'`, [instanceId]);
  if (!doc) throw notFound("no such document");
  if (doc.is_test !== true) throw notFound("no such document");          // a live document answers exactly as one that does not exist
  if (!["sent", "partially_signed"].includes(doc.state)) throw conflict(`this document is ${doc.state}; only a sent document can be signed`);
  const { rows: [party] } = await tx.query(`SELECT id, name, role, action_role, status FROM keystone.document_party WHERE instance_id = $1 AND role = $2`, [instanceId, seat]);
  if (!party) throw invalid(`seat must be one of the document's seats`, { field: "seat" });
  // R13-D220: `decline: true` declines the seat through the signer's own decline path (state, audit, documents.document.declined), instead of being ignored and signing
  if (decline === true) {
    await declineAsParty(tx, { tenantId, leadId: instanceId, partyId: party.id, reason: reason ?? "Declined by test-sign" });
    const t = await trackPdfDocument(tx, { tenantId, instanceId });
    return { id: instanceId, seat, signed: false, declined: true, state: t.state, progress: t.progress, finished: false };
  }
  const fields = (parsePdfBodyData(doc.body).fields ?? []).filter((f) => f.role === seat);
  if (fields.some((f) => f.type === "payment")) throw invalid("this seat has a payment field: pay it with a Stripe test card instead of test-signing", { field: "seat", code: "payment_field" });
  if (fields.some((f) => f.type === "file" && f.required)) throw invalid("this seat has a required file upload, which a test cannot supply", { field: "seat", code: "file_field" });
  const values = {}; for (const f of fields) { const v = sampleValue(f); if (v !== null) values[f.id] = v; }
  // R13-D477: the test signature carries a drawn mark (the pixel below), so it is a drawn signature; "typed" made a workspace that asks for drawn signatures (the default) refuse every test-sign.
  const out = await signAsParty(tx, { tenantId, leadId: instanceId, partyId: party.id, typedName: party.name || "Test Signer", consent: true, marks: { signature: ONE_PIXEL_PNG, initials: ONE_PIXEL_PNG }, values, signatureMethod: "drawn", ip: "127.0.0.1", userAgent: "docustay-test-sign" });
  const t = await trackPdfDocument(tx, { tenantId, instanceId });
  return { id: instanceId, seat, signed: true, state: t.state, progress: t.progress, finished: out?.completed === true || t.state === "executed" };
}
