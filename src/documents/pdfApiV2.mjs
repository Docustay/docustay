// src/documents/pdfApiV2.mjs — WHAT A DEVELOPER'S KEY MAY DO WITH THE v2 FLOW (B10, 7 Oct 2026): anything the screens can do the API can do, people first.
// A document is made from a SOURCE (the shared editor's JSON) and PEOPLE (name, email, a role word, what they do, their order); roles are words (Client, Provider), never seat keys. Smart fields, Sender only
// sections, template questions (variableValues), the payment the person typed, the wizard brief and the AI jobs all travel the same way the screens send them. Nothing here returns a signing link, and nothing signs.
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { createSourceDocument, getTemplateSource, checkSource, saveTemplateDefaults } from "./engine/creation.mjs";
import { reviseSourceDocument } from "./engine/revise.mjs";
import { savePdfDocument, getPdfDocument } from "./pdfDocs.mjs";
import { sendPdfDocument } from "./pdfSend.mjs";
import { cleanReference, saveDocumentReference, documentReference } from "./reference.mjs";
import { ACTION_ROLES, REMINDER_CHOICES, WIZARD_UNIVERSAL, WIZARD_TYPES, WIZARD_FINAL_QUESTION, WIZARD_PAYMENT, PAYMENT_CURRENCIES, AGENT_KINDS, LANGUAGE_CHOICES } from "./flowDefinition.mjs";
import { rolesOfSource, slugWord } from "./engine/rolesOfSource.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const ACTIONS = ACTION_ROLES.map((r) => r.id);

/** People in, parties out: each person takes the seat whose role word they were given (or the next unused role in the text), extra people get fresh seats. */
function peopleToParties(roleSeats, people, { sequential = false } = {}) {
  if (!Array.isArray(people) || !people.length) throw invalid("people is required: at least one person with a name and an email", { field: "people" });
  if (people.length > 30) throw invalid("people has at most 30 entries", { field: "people" });
  const used = new Set(), seatOf = [];
  const roles = [...roleSeats];
  const clean = people.map((p, i) => {
    if (!p || typeof p !== "object") throw invalid(`people[${i}] is not an object`, { field: "people" });
    const name = String(p.name ?? "").trim(), email = String(p.email ?? "").trim().toLowerCase();
    if (!name) throw invalid(`people[${i}].name is required`, { field: "people" });
    if (!EMAIL.test(email)) throw invalid(`people[${i}].email is not a valid address`, { field: "people" });
    const action = p.action ?? "signer"; if (!ACTIONS.includes(action)) throw invalid(`people[${i}].action must be one of ${ACTIONS.join(", ")}`, { field: "people" });
    return { name: name.slice(0, 120), email, action, role: typeof p.role === "string" ? p.role.trim() : "", order: Number.isInteger(p.order) ? p.order : i + 1 };
  });
  for (const p of clean) { const hit = p.role ? roles.find((r) => r.label === p.role && !used.has(r.key)) : null; if (hit) { used.add(hit.key); seatOf.push(hit.key); } else seatOf.push(null); }
  clean.forEach((p, i) => { if (seatOf[i]) return; const hit = !p.role && p.action === "signer" ? roles.find((r) => !used.has(r.key)) : null; if (hit) { used.add(hit.key); seatOf[i] = hit.key; } });
  let n = 1; const extra = [];
  clean.forEach((p, i) => { if (seatOf[i]) return; while (used.has(`signer_${n}`) || roles.some((r) => r.key === `signer_${n}`)) n++; const key = `signer_${n}`; used.add(key); seatOf[i] = key; extra.push({ key, label: p.role || p.name }); });
  const parties = clean.map((p, i) => ({ role: seatOf[i], name: p.name, email: p.email, phone: null, action_role: p.action, external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: sequential ? p.order : 1 }));
  const labels = Object.fromEntries([...roles, ...extra].map((r) => [r.key, r.label]));
  return { parties, extraRoles: extra, words: clean.map((p, i) => ({ word: labels[seatOf[i]] ?? p.role ?? p.name, name: p.name, email: p.email })) };
}

/** Friendly send choices → the stored send options. */
function sendChoices(c = {}) {
  const o = {};
  if (typeof c.subject === "string") o.subject = c.subject.slice(0, 200);
  if (typeof c.message === "string") o.message = c.message.slice(0, 4000);
  if (c.expiryDays !== undefined) { if (c.expiryDays !== null && !(Number.isInteger(c.expiryDays) && c.expiryDays >= 0 && c.expiryDays <= 365)) throw invalid("expiryDays is 0 to 365 (0 or null = never)", { field: "expiryDays" }); o.expiry_days = c.expiryDays; }
  if (c.reminderDays !== undefined) { const d = c.reminderDays; if (!Array.isArray(d) || d.length > 3 || d.some((x) => !(Number.isInteger(x) && x >= 1 && x <= 60))) throw invalid("reminderDays is up to three whole numbers of days, 1 to 60", { field: "reminderDays" }); o.reminders = { on: d.length > 0, days: d }; }
  if (c.signingOrder !== undefined) { if (!["any", "sequential"].includes(c.signingOrder)) throw invalid("signingOrder is any or sequential", { field: "signingOrder" }); o.order = c.signingOrder === "sequential" ? "sequential" : "parallel"; }
  if (typeof c.language === "string") o.language = c.language;
  if (typeof c.replyTo === "string") o.reply_to = c.replyTo.slice(0, 254);
  if (typeof c.senderName === "string" && c.senderName.trim()) o.sender_name = c.senderName.trim().slice(0, 120);
  if (typeof c.internalNote === "string") o.internal_note = c.internalNote.slice(0, 2000);
  if (c.requireDeclineReason === true) o.require_decline_reason = true;
  return o;
}

const factsFor = (facts, words, variableValues) => {
  // the engine reads merge text as facts.custom.<key>; a caller may send the flat "custom.<key>" spelling too
  const custom = {}, out = {};
  for (const [k, v] of Object.entries(facts && typeof facts === "object" ? facts : {})) { if (typeof v !== "string" || v.length > 300) continue; if (/^custom\.[a-z][a-z0-9_]{0,40}$/.test(k)) custom[k.slice(7)] = v; else if (/^(org|sender|document)\.[a-z_]{1,30}$/.test(k)) out[k] = v; }
  for (const [k, v] of Object.entries(variableValues ?? {})) custom[k] = String(v);
  for (const w of words) { const k = slugWord(w.word); custom[`p_${k}_name`] = w.name; custom[`p_${k}_email`] = w.email; }   // each person's own merge text
  return { ...out, custom };
};
const cleanValues = (v) => { if (v == null) return null; if (typeof v !== "object" || Array.isArray(v)) throw invalid("variableValues is an object of question key → answer", { field: "variableValues" }); const o = {}; for (const [k, x] of Object.entries(v)) { if (!/^[a-z][a-z0-9_]{0,40}$/.test(k)) throw invalid(`variableValues key “${k}” is not a question key`, { field: "variableValues" }); if (typeof x !== "string" || x.length > 300) throw invalid(`variableValues.${k} must be text, 300 characters at most`, { field: "variableValues" }); o[k] = x; } return o; };

async function finishDraft(tx, { tenantId, ownerId, instanceId, people, sendOptions, message, description, send, test, sequential, reference = null }) {
  const doc = await getPdfDocument(tx, { tenantId, instanceId });
  const roles = doc.body?.roles ?? [];
  const { parties, extraRoles } = peopleToParties(roles, people, { sequential });
  const body = extraRoles.length ? { ...doc.body, roles: [...roles, ...extraRoles] } : doc.body;
  if (reference) await saveDocumentReference(tx, instanceId, cleanReference({ metadata: reference.metadata, externalId: reference.externalId, people: people.map((p, i) => ({ seat: parties[i]?.role, externalId: p?.externalId, metadata: p?.metadata })) }));
  const so = { ...(doc.sendOptions ?? {}), ...sendOptions, ...(test ? { test: true } : {}) };
  await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId, body, parties, sendOptions: so, ...(message !== undefined ? { message } : {}), ...(description !== undefined ? { description } : {}) });
  if (test) await tx.query(`UPDATE keystone.document_instance SET is_test = true WHERE id = $1`, [instanceId]);   // a test key's drafts are test documents, so only a test key sees them
  if (!send) return { id: instanceId, state: "draft", roles: body.roles.map((r) => ({ key: r.key, label: r.label })) };
  const sent = await sendPdfDocument(tx, { tenantId, instanceId, actorUserId: ownerId });
  return { id: instanceId, state: "sent", emailed: sent.emailed ?? 0, notEmailed: sent.notEmailed ?? [], roles: body.roles.map((r) => ({ key: r.key, label: r.label })) };
}

/** POST /api/v1/documents — a document from a source and people. `send: true` also sends it (the same checks as the screen's Send). */
export async function apiCreateDocument(tx, { tenantId, ownerId, title, source, people, facts = {}, variableValues = null, paper = "letter", sendChoice = {}, baseOptions = {}, description, send = false, test = false, requireSignature = true, metadata, externalId }) {
  const ref = cleanReference({ metadata, externalId });
  const vv = cleanValues(variableValues);
  const roleWords = rolesOfSource(source);
  const so = { ...baseOptions, ...sendChoices(sendChoice) }; const sequential = so.order === "sequential";
  // people first, so each person's own merge text and role are known before the words are printed
  const probe = peopleToParties(roleWords.map((w, i) => ({ key: `signer_${i + 1}`, label: w })), people, { sequential });
  const made = await createSourceDocument(tx, { tenantId, actorUserId: ownerId, title, source, facts: factsFor(facts, probe.words, vv), paper: paper === "a4" ? "a4" : "letter", requireSignature, variableValues: vv });
  const out = await finishDraft(tx, { tenantId, ownerId, instanceId: made.instanceId, people, sendOptions: so, message: so.message, description, send, test, sequential, reference: { metadata, externalId } });
  return { ...out, externalId: ref.externalId, metadata: ref.metadata, warnings: made.warnings ?? [] };
}

/** POST /api/v1/templates/{id}/documents — use a source template: people, the template's questions answered, optionally sent. A template's own defaults (about text, message, send choices) apply first. */
export async function apiUseTemplate(tx, { tenantId, ownerId, templateId, title, people, variableValues = null, facts = {}, sendChoice = {}, send = false, test = false, metadata, externalId }) {
  const t = await getTemplateSource(tx, { templateId });
  const vv = cleanValues(variableValues) ?? {};
  const missing = (t.variables ?? []).filter((v) => !String(vv[v.key] ?? v.default ?? "").trim()).map((v) => v.key);
  if (missing.length) throw invalid(`Answer the template's questions first: ${missing.join(", ")}`, { field: "variableValues", details: missing });
  const merged = { ...Object.fromEntries((t.variables ?? []).filter((v) => v.default).map((v) => [v.key, String(v.default)])), ...vv };
  const d = t.defaults ?? {};
  const base = {}; for (const [k, v] of Object.entries(d.sendDefaults ?? {})) if (k !== "plays") base[k] = v;   // stored in the internal shape; the caller's own choices go on top
  return apiCreateDocument(tx, { tenantId, ownerId, title: title || t.name, source: t.source, people, facts, variableValues: merged, sendChoice, baseOptions: base, description: d.clientDescription ?? undefined, send, test, requireSignature: false, metadata, externalId });
}

/** POST /api/v1/documents/{id}/revise — change the words of a DRAFT: a new draft takes its people and choices, the old one is deleted (the id changes). */
export async function apiReviseDocument(tx, { tenantId, ownerId, instanceId, source, facts = {}, variableValues, roleMap = {}, paper = null }) {
  const doc = await getPdfDocument(tx, { tenantId, instanceId });
  const labelOf = (key) => (doc.body?.roles ?? []).find((r) => r.key === key)?.label ?? key;
  const words = (doc.parties ?? []).map((p) => ({ word: roleMap?.[labelOf(p.role)] ?? labelOf(p.role), name: p.name, email: p.email })).filter((w) => w.name || w.email);
  const vv = variableValues !== undefined ? cleanValues(variableValues) : (doc.variableValues ?? null);
  const fresh = factsFor(facts, words, vv), kept0 = doc.sourceFacts ?? {};
  const merged = { ...kept0, ...fresh, custom: { ...(kept0.custom ?? {}), ...(fresh.custom ?? {}) } };
  const { rows: [was] } = await tx.query(`SELECT is_test FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const kept = await documentReference(tx, instanceId);   // read before the old draft is deleted
  const out = await reviseSourceDocument(tx, { tenantId, actorUserId: ownerId, instanceId, source, facts: merged, paper, roleMap, ...(variableValues !== undefined ? { variableValues: vv } : {}) });
  if (was?.is_test) await tx.query(`UPDATE keystone.document_instance SET is_test = true WHERE id = $1`, [out.instanceId]);   // the new draft is a test document like the one it replaced
  if (kept) await saveDocumentReference(tx, out.instanceId, kept);   // the developer's own reference follows the document to its new id
  return { id: out.instanceId, previousId: out.previousInstanceId, warnings: out.warnings ?? [] };
}

/** Change a DRAFT's people and/or its send choices in place (subject, message, expiry, reminders, order, language, internal note). Used by the assistant's accepted suggestions; the id does not change. */
export async function apiSetDraft(tx, { tenantId, ownerId, instanceId, people = null, sendChoice = {} }) {
  const doc = await getPdfDocument(tx, { tenantId, instanceId });
  if (doc.state !== "draft") throw conflict(`this document is ${doc.state}, not a draft`);
  const so = sendChoices(sendChoice); const sequential = (so.order ?? doc.sendOptions?.order) === "sequential";
  if (people) return finishDraft(tx, { tenantId, ownerId, instanceId, people, sendOptions: so, message: so.message, description: undefined, send: false, test: false, sequential });
  await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId, sendOptions: { ...(doc.sendOptions ?? {}), ...so }, ...(so.message !== undefined ? { message: so.message } : {}) });
  return { id: instanceId, state: "draft" };
}

/** POST /api/v1/documents/{id}/send — send a draft made through the API (or the screens). */
export async function apiSendDraft(tx, { tenantId, ownerId, instanceId, test = false }) {
  const doc = await getPdfDocument(tx, { tenantId, instanceId });
  if (doc.state !== "draft") throw conflict(`this document is ${doc.state}, not a draft`);
  if (test) await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId, sendOptions: { ...(doc.sendOptions ?? {}), test: true } });
  const sent = await sendPdfDocument(tx, { tenantId, instanceId, actorUserId: ownerId });
  return { id: instanceId, state: "sent", emailed: sent.emailed ?? 0, notEmailed: sent.notEmailed ?? [] };
}

/** GET /api/v1/documents/{id}/source — the words, the people, the roles and the send choices of a DRAFT (what the Prepare screen opens). */
export async function apiDraftSource(tx, { tenantId, instanceId }) {
  const d = await getPdfDocument(tx, { tenantId, instanceId });
  if (!d.source) throw notFound("This draft has no written words (it was made from an uploaded file) — or it has been sent.");
  return { id: instanceId, state: d.state, title: d.title, source: d.source, facts: d.sourceFacts ?? {}, variableValues: d.variableValues ?? null, paper: d.sourcePaper ?? "letter", roles: (d.body?.roles ?? []).map((r) => ({ key: r.key, label: r.label })), people: (d.parties ?? []).map((p) => ({ name: p.name, email: p.email, role: (d.body?.roles ?? []).find((r) => r.key === p.role)?.label ?? p.role, action: p.action_role, order: p.position })), sendOptions: d.sendOptions ?? {} };
}

/** POST /api/v1/documents/check — what a person would be told before saving: errors, warnings, the roles in the words. */
export function apiCheckSource({ source, facts = {}, people = null, variableValues = null, requireSignature = true, forTemplate = false }) {
  // with people, each person's own merge text is known (as when the document is made); without them a per-person chip is reported as having no value
  const words = Array.isArray(people) && people.length ? peopleToParties(rolesOfSource(source).map((w, i) => ({ key: `signer_${i + 1}`, label: w })), people).words : [];
  const r = checkSource({ source, profile: "typeset", facts: factsFor(facts, words, cleanValues(variableValues)), requireSignature, forTemplate });
  return { ok: r.ok, errors: r.errors ?? [], warnings: r.warnings ?? [], roles: r.roles ?? [] };
}

/** POST /api/v1/templates/{id}/defaults — the about text, the message and the send choices a document made from the template starts with. */
export async function apiTemplateDefaults(tx, { templateId, description = null, clientDescription = null, message = null, sendChoice = {} }) {
  await saveTemplateDefaults(tx, { templateId, description, clientDescription, message, sendDefaults: sendChoices(sendChoice) });
  return { templateId, saved: true };
}

/** GET /api/v1/documents/ai/wizard — the wizard's questions, so an integration asks the same ones the screen does. Pure data. */
export function apiWizard() {
  const q = (x) => ({ key: x.key, label: x.label, type: x.type, required: x.required === true, ...(x.options ? { options: x.options.map((o) => o.value) } : {}), ...(x.default !== undefined ? { default: x.default } : {}) });
  return { universal: WIZARD_UNIVERSAL.map(q), finalQuestion: q(WIZARD_FINAL_QUESTION), types: WIZARD_TYPES.map((t) => ({ id: t.id, label: t.label, questions: t.pack.map(q) })), kinds: AGENT_KINDS.map((k) => k.id), payment: { questions: WIZARD_PAYMENT.map(q), currencies: PAYMENT_CURRENCIES, note: "The amount comes only from the person: send it as brief.payment.amount. The assistant never decides an amount; the worker places the Payment field." }, languages: LANGUAGE_CHOICES, reminderChoices: REMINDER_CHOICES.map((r) => ({ id: r.id, days: r.days ?? [] })) };
}
