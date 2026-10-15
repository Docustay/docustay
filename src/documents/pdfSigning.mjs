// src/documents/pdfSigning.mjs — THE RECIPIENT'S SIDE OF AN UPLOADED DOCUMENT (QUEUE §23.4.10, §23.4.11): open it, save and come back later, sign, decline. Every function runs inside a transaction whose viewer is the
// person's own `document_party` row (migration 0604 teaches row-level security that viewer), so a bug here still cannot reach another document.
//
// ★ What a signature IS here: for each document in the send, one `signature_record` row (the same hash-chained, append-only evidence as every other signature) under the person's seat `signer_N`, plus one
//   `document_field_value` row per field they filled. The last signer's act executes every document in the send.
// ★ A signature mark is a PNG the page drew (signature_pad, a typed name in a script font, or an uploaded picture); the server only checks shape and size and records its digest.
import { languageFor, rememberSignerLanguage } from "./signerLanguage.mjs";
import { invalid, conflict, forbidden } from "../http/errors.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { gateFor, maskEmail, requireVerified, sendVerificationCode, verifyParty } from "./pdfVerify.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData, validateFieldValue, AUTO_FIELD_TYPES } from "./pdfBody.mjs";
import { parseTemplateSnapshot } from "./body.mjs";
import { disclosureSnapshotFromAcceptance } from "./disclosure.mjs";
import { signatureRowHash, markDigest } from "./writes.mjs";
import { documentsOfSend } from "./parties.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { getDocumentSettings } from "./settings.mjs";
import { footerBrandFor } from "./chromeInputs.mjs";
import { verifyPaidForSigning, paymentsForParty } from "./pdfPayments.mjs";
import { advanceSequence, activeParties, isActionable, isBlocking, isFinished, emailParty } from "./pdfSend.mjs";
import { signingPolicy } from "./signingPolicy.mjs";
import { cleanName } from "./textSafety.mjs";
import { sha256Hex, acceptFieldFile, readFileBytes } from "./files.mjs";
import { hiddenNow, computeFormulas } from "./rules.mjs";
import { revokeLinkTokenById } from "../auth/linkToken.mjs";
import { sendHoldLapsedNotice } from "./emailNotices.mjs";

/** The consent a person gives before signing an uploaded document. Versioned; the version and time are recorded on their party row and quoted in the certificate. (Wording reviewed in chat before real use — QUEUE §23.10 hand-back.) */
export const PDF_CONSENT = Object.freeze({
  version: "2026-10-10.1",
  text: "I agree to receive this document electronically and to sign it electronically. I can read the whole document before I sign, I can keep or print a copy, and I can ask the sender for a paper copy. If I do not agree, I can close this page and nothing is recorded.",
});

const LINK_REFUSED = "That link is not valid. It may have been used already, expired, or been cancelled — ask for a new one.";

/** `lock` (every WRITE path): the document row and then the person's row are locked until the transaction ends, so a signature cannot interleave with a void, an expiry, a reassignment or the same person's second click (Round 3, R-3..R-6). Document first, then person: one order everywhere. */
async function context(tx, { leadId, partyId, requireLive = true, lock = false }) {
  const forUpdate = lock ? " FOR UPDATE" : "";
  const { rows: [lead] } = await tx.query(
    `SELECT id, title, state, message, description, expires_at, sent_at, send_options, created_by, is_test FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL${forUpdate}`, [leadId]);
  const { rows: [party] } = await tx.query(`SELECT * FROM keystone.document_party WHERE id = $1 AND instance_id = $2${forUpdate}`, [partyId, leadId]);
  if (!party || !lead || lead.state === "draft") throw forbidden(LINK_REFUSED);
  if (requireLive && !["sent", "partially_signed"].includes(lead.state)) throw forbidden(LINK_REFUSED);
  // ★ §23.5.17 — each person can have their own deadline; past it their link is dead (the sender can extend it, which mails a new one)
  // Run 9 Part 3.7 — a signature HELD for its payment was given before any deadline that passed since: the deadline is measured at the moment they signed, so the payment can still complete it
  const at = party.status === "awaiting_payment" && party.held_at ? new Date(party.held_at) : new Date();
  if (requireLive && party.expires_at && new Date(party.expires_at) <= at && !isFinished(party)) throw forbidden(LINK_REFUSED);
  // the document's own deadline applies to anyone without a deadline of their own
  if (requireLive && !party.expires_at && lead.expires_at && new Date(lead.expires_at) <= at && !isFinished(party)) throw forbidden(LINK_REFUSED);
  const members = await documentsOfSend(tx, { instanceId: leadId });
  return { party, lead, members };
}

async function memberBodies(tx, members) {
  const out = [];
  for (const m of members) {
    const { rows: [r] } = await tx.query(`SELECT id, title, state, template_body_snapshot, package_position FROM keystone.document_instance WHERE id = $1`, [m.id]);
    out.push({ id: r.id, title: r.title, state: r.state, position: r.package_position ?? 1, body: parsePdfBodyData(r.template_body_snapshot) });
  }
  return out;
}

/** The sender's extra files, as the signing page lists them (names and sizes only; the bytes come through `readAttachmentForParty`). */
async function attachmentsOf(tx, lead) {
  const ids = lead.send_options?.attachments ?? [];
  if (!ids.length) return [];
  const { rows } = await tx.query(`SELECT id, name, mime, byte_size FROM keystone.document_file WHERE id = ANY($1::uuid[]) AND kind = 'attachment' AND (meta->>'extra') = 'true' ORDER BY position`, [ids]);
  return rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: Number(r.byte_size) }));
}

/** What the signing page shows. Marks the first look (time, IP, device) as evidence. */
export async function openForParty(tx, { tenantId, leadId, partyId, ip = null, userAgent = null, language = null }) {
  const { party, lead, members } = await context(tx, { leadId, partyId });
  await rememberSignerLanguage(tx, { sendOptions: lead.send_options, partyId, language });
  const P = await ports();
  const { practiceName, logoUrl } = await P.brand.get(tx, { tenantId });
  // ★ §23.5.2 — a send that asks for a code shows NOTHING but the question until it is answered; the first look is recorded after.
  const gate = gateFor(party, lead);
  if (gate) {
    const locked = party.verify_locked_until && new Date(party.verify_locked_until) > new Date();
    return { gate: { kind: gate.kind, email: gate.kind === "email_code" ? maskEmail(party.email) : null, locked: Boolean(locked), lockedUntil: locked ? party.verify_locked_until : null, codeSent: Boolean(party.verify_code_sent_at && party.verify_code_expires_at && new Date(party.verify_code_expires_at) > new Date()) },
      document: { id: lead.id, title: lead.title, state: lead.state, message: null, sentAt: lead.sent_at, expiresAt: lead.expires_at }, org: { name: practiceName, logoUrl }, party: { id: party.id, name: party.name, seat: party.role, actionRole: party.action_role, status: party.status, signed: party.status === "signed" }, documents: [], otherParties: [] };
  }
  const docs = await memberBodies(tx, members);
  const firstLook = !party.viewed_at;
  if (firstLook) {
    await tx.query(`UPDATE keystone.document_party SET viewed_at = now(), viewed_ip = $2, viewed_user_agent = $3, status = CASE WHEN status = 'pending' THEN 'viewed' ELSE status END, updated_at = now() WHERE id = $1`, [partyId, ip, userAgent]);
    for (const d of docs) await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "opened", actorRole: party.role });
    await emit(tx, { tenantId, topic: "documents.document.opened", emittedBy: "documents", subjectType: "document", subjectId: leadId, actor: userActor(partyId), payload: { role: party.role, builder: "pdf" } });
  }
  const { rows: parties } = await tx.query(`SELECT id, role, name, action_role, position, status, completed_at, assists_role, progress FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [leadId]);
  const { rows: done } = await tx.query(`SELECT instance_id, field_id, field_type, value, mark_image FROM keystone.document_field_value WHERE instance_id = ANY($1::uuid[])`, [members.map((m) => m.id)]);
  // ★ §23.5.16 — only SIGNERS and APPROVERS wait for their turn; a viewer or assistant can act at once. An assistant's fields are the ones of the seat they help (never a signature, initials, date or stamp).
  const waitingFor = isActionable(party, parties) ? null : isBlocking(party) ? parties.filter((p) => isBlocking(p) && !isFinished(p) && p.position < party.position).map((p) => p.name) : null;
  const assisted = party.action_role === "assistant" ? parties.find((p) => p.role === party.assists_role) ?? null : null;
  const mineOf = (f) => (party.action_role === "signer" ? f.role === party.role : party.action_role === "assistant" ? f.role === party.assists_role && !AUTO_FIELD_TYPES.includes(f.type) : false);
  const needsReason = lead.send_options?.require_decline_reason === true;
  return {
    document: { id: lead.id, title: lead.title, state: lead.state, test: lead.is_test === true, message: lead.description || null, sentAt: lead.sent_at, expiresAt: lead.expires_at },
    org: { name: practiceName, logoUrl },
    brand: await brandOf(tx, tenantId),
    payments: await paymentsForParty(tx, { leadId, partyId }),
    party: { id: party.id, name: party.name, email: party.email, seat: party.role, actionRole: party.action_role, status: party.status, signed: party.status === "signed", finished: isFinished(party), assistsName: assisted?.name ?? null,
      witnessRequired: party.witness_required === true, group: party.group_label ?? null, holdExpiresAt: party.status === "awaiting_payment" ? party.hold_expires_at : null, closedBy: party.status === "closed" ? (parties.find((p) => p.role === party.role && p.status === "signed")?.name ?? null) : null },
    pageRules: docs.map((d) => ({ documentId: d.id, rules: d.body.page_rules ?? [] })),
    waitingFor: waitingFor && waitingFor.length ? waitingFor : null,
    consent: { version: PDF_CONSENT.version, text: PDF_CONSENT.text, alreadyGiven: Boolean(party.consented_at) },
    requireDeclineReason: needsReason,
    policy: await signingPolicy(tx),
    resubmitUrl: (await isFormFiller(tx, { leadId, partyId })) ? await resubmitUrlFor(tx, { tenantId, leadId }) : null,
    form: (await isFormFiller(tx, { leadId, partyId })) ? await formEndOf(tx, { tenantId, leadId }) : await formEndOf(tx, { tenantId, leadId }).then((f) => f && { thankYou: null, againUrl: null }),
    ...(await signerLanguageView(tx, { lead, party })),
    attachments: await attachmentsOf(tx, lead),
    progress: (assisted ? assisted.progress : party.progress) ?? {},
    documents: docs.map((d) => ({
      id: d.id, title: d.title, position: d.position, file: { name: d.body.file.name, pageCount: d.body.file.page_count, pages: d.body.file.pages },
      fields: d.body.fields.map((f) => {
        const v = done.find((x) => x.instance_id === d.id && x.field_id === f.id);
        return { ...f, mine: mineOf(f), seatName: parties.find((p) => p.role === f.role)?.name ?? null, filled: v ? { value: v.value, mark: v.mark_image } : null };
      }),
    })),
    otherParties: parties.filter((p) => p.id !== partyId).map((p) => ({ name: p.name, actionRole: p.action_role, status: p.status })),
  };
}

/** Where a person who finished a form from a PUBLIC LINK may fill it in again (only when the organisation allows resubmitting and the document was made from a template that has a public link). Signed records are append-only, so an emailed document has nothing to resubmit. */
/** A form response's finishing words and fill-again link (Run 7); embedSites stays on the server. */
/** ★ P10-B-5: the thank-you line and "Fill it in again" are for the person who filled the form (the first signer), never the staff counter-signer. True for anything that is not a form response. */
export async function isFormFiller(tx, { leadId, partyId }) {
  const { rows: [r] } = await tx.query(`SELECT i.source_channel, (SELECT p.id FROM keystone.document_party p WHERE p.instance_id = i.id AND p.action_role = 'signer' ORDER BY p.position, p.created_at LIMIT 1) AS filler FROM keystone.document_instance i WHERE i.id = $1`, [leadId]);
  return !r || r.source_channel !== "form" || r.filler === partyId;
}
async function formEndOf(tx, { tenantId, leadId }) { const { formEndFor } = await import("./forms.mjs"); const f = await formEndFor(tx, { tenantId, leadId }); return f ? { thankYou: f.thankYou, againUrl: f.againUrl } : null; }
async function resubmitUrlFor(tx, { tenantId, leadId }) {
  if (!(await signingPolicy(tx)).allowResubmit) return null;
  const { rows: [r] } = await tx.query(`SELECT t.self_serve_slug AS slug FROM keystone.document_instance i JOIN keystone.document_template t ON t.id = i.template_id WHERE i.id = $1 AND t.self_serve_enabled AND t.self_serve_slug IS NOT NULL`, [leadId]);
  if (!r?.slug) return null;
  const { publicBase } = await (await ports()).brand.get(tx, { tenantId });
  return publicBase ? `${publicBase}/s/${r.slug}` : null;
}

/** The sender's own "send me a test": the page exactly as the first signer sees it, read from the draft, recording nothing. Signing in this mode is refused by the route. */
/** How the practice dresses the page a signer sees (QUEUE §23.5.9): an accent colour (or none), whether its logo shows, and a one-line note. */
async function brandOf(tx, tenantId) {
  const s = await getDocumentSettings(tx);
  const fb = await footerBrandFor(tx, { tenantId });   // Free Docustay: "Sent with Docustay"; Pro with the setting on: null; the platform: undefined → null
  return { accent: s["brand.accent"] || null, showLogo: s["brand.show_logo"] !== false, note: s["brand.welcome_note"] || null, poweredBy: fb.footer ?? null };
}

export async function openAsTest(tx, { tenantId, leadId }) {
  const { rows: [lead] } = await tx.query(`SELECT id, title, state, description, expires_at, sent_at, send_options FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [leadId]);
  if (!lead) throw forbidden(LINK_REFUSED);
  const members = await documentsOfSend(tx, { instanceId: leadId });
  const docs = await memberBodies(tx, members);
  const { rows: parties } = await tx.query(`SELECT id, role, name, email, action_role, position, status FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [leadId]);
  const first = parties.find((p) => p.action_role === "signer") ?? { id: "test", role: "signer_1", name: "Test signer", email: null, action_role: "signer", status: "pending" };
  const { practiceName, logoUrl } = await (await ports()).brand.get(tx, { tenantId });
  return {
    test: true,
    document: { id: lead.id, title: lead.title, state: lead.state, message: lead.description || null, sentAt: lead.sent_at, expiresAt: lead.expires_at },
    org: { name: practiceName, logoUrl },
    brand: await brandOf(tx, tenantId),
    party: { id: first.id, name: first.name, email: first.email, seat: first.role, actionRole: "signer", status: "pending", signed: false },
    waitingFor: null, consent: { version: PDF_CONSENT.version, text: PDF_CONSENT.text, alreadyGiven: false }, requireDeclineReason: lead.send_options?.require_decline_reason === true, ...(await signerLanguageView(tx, { lead, party })), progress: {},
    documents: docs.map((d) => ({ id: d.id, title: d.title, position: d.position, file: { name: d.body.file.name, pageCount: d.body.file.page_count, pages: d.body.file.pages }, fields: d.body.fields.map((f) => ({ ...f, mine: f.role === first.role, seatName: parties.find((p) => p.role === f.role)?.name ?? null, filled: null })) })),
    otherParties: parties.filter((p) => p.id !== first.id).map((p) => ({ name: p.name, actionRole: p.action_role, status: p.status })),
  };
}

/** Save and finish later: the values so far, kept on the person's row (never evidence until they sign). */
export async function savePartyProgress(tx, { tenantId, leadId, partyId, values }) {
  const { party, lead } = await context(tx, { leadId, partyId });
  requireVerified(party, lead);
  if (party.status === "signed") throw conflict("you have already signed this document", { code: "already_signed" });
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 2000) throw invalid("values must be an object keyed by field", { field: "values" });
  const clean = {};
  for (const [k, v] of Object.entries(values)) if (/^[A-Za-z0-9_-]{1,64}$/.test(k) && (v === null || typeof v === "string") && String(v ?? "").length <= 204800) clean[k] = v;
  const bytes = JSON.stringify(clean).length;
  if (bytes > 6_000_000) throw invalid("that is too much to save for later — sign now or remove a picture", { field: "values" });
  await tx.query(`UPDATE keystone.document_party SET progress = $2::jsonb, updated_at = now() WHERE id = $1`, [partyId, JSON.stringify(clean)]);
  await recordAuditEvent(tx, { tenantId, instanceId: leadId, kind: "saved", actorRole: party.role });
  return { saved: true, fields: Object.keys(clean).length };
}

const longDate = (iso, zone) => new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));

/**
 * Sign. `values` are keyed by field id (across every document in the send); `marks` carries the drawn/typed/uploaded PNGs for `signature` and `initials`. Nothing is recorded unless everything required is
 * present and valid (all or nothing). Returns {state, signed, remaining, completed}.
 */
// Run 9 Part 3.7 (R9-l) — THE SIGNER PAYS LAST. When everything is in order except a payment this person still has to make, the signature is not refused: the whole request is HELD on their
// party row for 7 days (`awaiting_payment`) and the answer says what to pay. Nothing else is written — no field value, no signature record. `completeHeldSignature` signs from the hold once Stripe
// confirms the payment, as of the moment they pressed Sign (`signedAtOverride`). A completion with more still to pay keeps the hold as it was (same moment, same 7 days). `hold: false` never holds:
// a payment still missing then is a refusal.
const HOLD_DAYS = 7;
export async function signAsParty(tx, { tenantId, leadId, partyId, language = null, typedName, consent, marks = {}, values = {}, signerTimezone = null, ip = null, userAgent = null, reason = null, signatureMethod = null, witness = null, hold = true, signedAtOverride = null }) {
  const { party, lead, members } = await context(tx, { leadId, partyId, lock: true });
  await rememberSignerLanguage(tx, { sendOptions: lead.send_options, partyId, language });
  requireVerified(party, lead);
  if (party.action_role !== "signer") throw conflict("you are not asked to sign this document");
  if (party.status === "signed") throw conflict("you have already signed this document", { code: "already_signed" });
  if (party.status === "closed") throw conflict("Someone else in your group has already signed this, so nothing more is needed from you.", { code: "group_closed" });
  const { rows: parties } = await tx.query(`SELECT * FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [leadId]);
  if (!activeParties(parties).some((p) => p.id === partyId)) {
    const ahead = parties.filter((p) => p.action_role === "signer" && p.position < party.position && p.status !== "signed").map((p) => p.name);
    throw conflict(`It is not your turn yet — waiting for ${ahead.join(", ") || "someone else"} to sign first.`, { code: "not_your_turn" });
  }
  if (consent !== true) throw invalid("You need to agree to sign electronically before signing.", { field: "consent", code: "consent_required" });
  const name = cleanName(typedName, { max: 121 });
  if (!name) throw invalid("Type your full name to sign.", { field: "typedName" });
  // Part 30 item 5 — the organisation's signing rules, enforced here and not only on the page
  const policy = await signingPolicy(tx);
  const why = typeof reason === "string" ? reason.trim() : "";
  if (policy.requireReason && !why) throw invalid("Say why you are signing (for example, your role or capacity).", { field: "reason", code: "reason_required" });
  if (why.length > 500) throw invalid("That reason is too long (500 characters at most).", { field: "reason" });
  if (signatureMethod !== null && !["drawn", "typed", "uploaded"].includes(signatureMethod)) throw invalid("signatureMethod must be drawn, typed or uploaded", { field: "signatureMethod" });
  if (name.length > 120) throw invalid("That name is too long.", { field: "typedName" });
  let zone = signerTimezone;
  if (zone) { try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { throw invalid(`“${zone}” is not a time zone`, { field: "signerTimezone" }); } }
  if (!zone) zone = (await (await ports()).brand.get(tx, { tenantId })).timezone || "UTC";

  const docs = await memberBodies(tx, members);
  // a drawn signature is required when typed ones are off — and only when this seat actually has a signature to give
  if (!policy.allowTyped && signatureMethod !== "drawn" && docs.some((d) => d.body.fields.some((f) => f.role === party.role && f.type === "signature"))) throw invalid("This organisation asks for a drawn signature. Draw yours to continue.", { field: "signatureMethod", code: "typed_not_allowed" });
  const signedAt = signedAtOverride ? new Date(signedAtOverride) : new Date();
  const dateText = longDate(signedAt.toISOString(), zone);
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(signedAt);

  // Run 9 — a witness signs straight after this person, on this device (decision 5); checked here with everything else, before anything is written
  let witnessRow = null;
  if (party.witness_required) {
    const wName = cleanName(witness?.name, { max: 121 });
    if (!wName) throw invalid("This signature needs a witness. Ask the person watching you sign to type their name and sign.", { field: "witness.name", code: "witness_required" });
    if (wName.length > 120) throw invalid("The witness's name is too long.", { field: "witness.name" });
    if (wName.toLowerCase() === name.toLowerCase()) throw invalid("The witness must be someone other than the person signing.", { field: "witness.name", code: "witness_is_signer" });
    const wMark = typeof witness?.mark === "string" && witness.mark.startsWith("data:image/png;base64,") && witness.mark.length <= 204800 ? witness.mark : null;
    if (!wMark) throw invalid("The witness needs to sign too.", { field: "witness.mark", code: "witness_mark_required" });
    const wEmail = typeof witness?.email === "string" && witness.email.trim() ? witness.email.trim().slice(0, 254) : null;
    if (wEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wEmail)) throw invalid("That is not an email address for the witness.", { field: "witness.email" });
    witnessRow = { name: wName, email: wEmail, mark: wMark, digest: markDigest(wMark) };
  }

  // gather and check every field this seat owns, before writing anything
  const toWrite = [];
  const problems = [];
  const unpaid = [];   // Run 9 Part 3.7: payments still to make — the only thing a hold waits for
  const hiddenOf = new Map();   // Run 9: doc id → { fields: [ids of THIS seat's boxes a rule left out], pages }
  for (const d of docs) {
    // Run 9 — the server works the rules and formulas out again (decision 6): what earlier people signed, what the sender locked, and this person's own answers. The browser's view of what is hidden
    // or what a box works out to is never trusted: a hidden box is not required and nothing is stored for it; a box that works itself out gets the server's answer.
    const { rows: earlier } = await tx.query(`SELECT field_id, value FROM keystone.document_field_value WHERE instance_id = $1`, [d.id]);
    const known = Object.fromEntries(earlier.map((r) => [r.field_id, r.value]));
    for (const f of d.body.fields) if (f.locked && f.default != null && known[f.id] == null) known[f.id] = String(f.default);
    for (const f of d.body.fields) if (f.role === party.role && !f.locked && !f.calc && typeof values[f.id] === "string" && known[f.id] == null) known[f.id] = values[f.id];
    const hidden = hiddenNow({ fields: d.body.fields, pages: d.body.page_rules ?? [] }, known);
    const worked = computeFormulas(d.body.fields.filter((f) => !hidden.fields.has(f.id)), Object.fromEntries(Object.entries(known).filter(([k]) => !hidden.fields.has(k))));
    const mineHidden = d.body.fields.filter((f) => f.role === party.role && hidden.fields.has(f.id));
    // the ids name every box left out; the labels only those not already covered by a page left out (the certificate says "page 2", not page 2 and each box on it)
    hiddenOf.set(d.id, { fields: mineHidden.map((f) => f.id), labels: mineHidden.filter((f) => !hidden.pages.has(f.page)).map((f) => String(f.label || f.id).slice(0, 120)), pages: [...hidden.pages].sort((a, b) => a - b) });
    const valuesHere = { ...values, ...Object.fromEntries(d.body.fields.filter((f) => f.locked && f.default != null).map((f) => [f.id, String(f.default)])), ...Object.fromEntries(d.body.fields.filter((f) => f.calc && worked[f.id] != null).map((f) => [f.id, worked[f.id]])) };
    for (const f of d.body.fields.filter((x) => x.role === party.role)) {
      if (hidden.fields.has(f.id)) continue;   // not part of this document for this signer: not asked, not stored
      let value = values[f.id] ?? null;
      if (f.calc) value = worked[f.id] ?? null;   // works itself out; whatever the browser sent is ignored
      if (f.type === "signature") value = marks.signature ?? values[f.id] ?? null;
      else if (f.type === "initials") value = marks.initials ?? values[f.id] ?? null;
      else if (f.type === "date_signed") value = dateText;
      else if (f.locked && f.default != null) value = String(f.default);   // the sender locked the answer
      else if (f.autofill && !f.editable) value = (f.autofill === "name" ? name : party.email) || value;   // a smart field is the person's own name or email, whatever the browser sent
      let problem = null;
      if (f.type === "payment") {
        // §23.5.11 — a payment counts only if the provider says it went through; the browser's value is ignored. Nothing is written until every field passes.
        const paid = await verifyPaidForSigning(tx, { tenantId, docId: d.id, partyId, field: f, values: valuesHere });
        if (paid.unpaid && hold) { unpaid.push({ documentId: d.id, fieldId: f.id, label: f.label || null }); continue; }
        if (paid.problem) problem = paid.problem; else value = paid.value;
      } else problem = validateFieldValue(f, value);
      // a `file` field's value is the id of a file THIS person uploaded for THIS field (never anyone else's)
      if (!problem && f.type === "file" && value) {
        const { rows: [fr] } = await tx.query(`SELECT 1 FROM keystone.document_file WHERE id = $1 AND kind = 'attachment' AND instance_id = ANY($2::uuid[]) AND (meta->>'party_id') = $3 AND (meta->>'field_id') = $4`, [value, members.map((m) => m.id), partyId, f.id]);
        if (!fr) problem = "needs a file you uploaded for it";
      }
      if (problem) { problems.push(`${f.label || f.type} ${problem}`); continue; }
      if (value === null || value === "") continue;
      toWrite.push({ docId: d.id, field: f, value });
    }
  }
  if (problems.length) throw invalid(`Some fields need attention: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ""}`, { code: "fields_invalid", problems });
  if (unpaid.length) {
    // everything else is in order: keep exactly what they submitted (the server's own checks run again from it when the payment arrives) and answer what is left to pay
    const held = { typedName: name, consent: true, marks, values, signerTimezone: zone, reason: why || null, signatureMethod, witness, language, ip, userAgent: userAgent ? String(userAgent).slice(0, 1000) : null };
    const until = new Date(signedAt.getTime() + HOLD_DAYS * 864e5);
    await tx.query(`UPDATE keystone.document_party SET status = 'awaiting_payment', held_signature = $2::jsonb, held_at = $3, hold_expires_at = $4, progress = NULL, updated_at = now() WHERE id = $1`, [partyId, JSON.stringify(held), signedAt, until]);
    if (party.status !== "awaiting_payment") for (const d of docs) await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "held_for_payment", actorRole: party.role, occurredAt: signedAt, detail: { payments: unpaid.filter((u) => u.documentId === d.id).length } });
    return { held: true, heldAt: signedAt.toISOString(), holdExpiresAt: until.toISOString(), payments: unpaid };
  }

  for (const w of toWrite) {
    const isMark = ["signature", "initials", "image", "stamp"].includes(w.field.type);
    await tx.query(
      `INSERT INTO keystone.document_field_value (tenant_id, instance_id, party_id, field_id, field_type, value, mark_image, value_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, w.docId, partyId, w.field.id, w.field.type, isMark ? null : w.value, isMark ? w.value : null, sha256Hex(`${w.field.id}\u0000${w.value}`)]);
  }

  // one signature record per document, chained on that document
  const mark = marks.signature ?? toWrite.find((w) => w.field.type === "signature")?.value ?? null;
  const digest = mark ? markDigest(mark) : null;
  for (const d of docs) {
    const { rows: [tail] } = await tx.query(`SELECT row_hash, signer_order FROM keystone.signature_record WHERE instance_id = $1 ORDER BY signer_order DESC LIMIT 1`, [d.id]);
    const order = (tail?.signer_order ?? 0) + 1, prev = tail?.row_hash ?? null;
    const rowHash = signatureRowHash({ instanceId: d.id, role: party.role, signerOrder: order, signerUid: null, signerName: name, signedAt, markSha256: digest, prevHash: prev });
    await tx.query(
      `INSERT INTO keystone.signature_record (tenant_id, instance_id, role, signer_order, signer_uid, signer_name, signed_at, signed_local_date, signer_timezone, user_agent, signer_ip, mark_sha256, prev_hash, row_hash, mark_image)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [tenantId, d.id, party.role, order, name, signedAt, localDate, zone, userAgent, ip, digest, prev, rowHash, mark]);
    await tx.query(`UPDATE keystone.document_instance SET state = 'partially_signed', updated_at = now() WHERE id = $1 AND state = 'sent'`, [d.id]);
    await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "consented", actorRole: party.role, occurredAt: signedAt });
    await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "signed", actorRole: party.role, occurredAt: signedAt, detail: signatureMethod ? { signature_method: signatureMethod } : null });
    // Run 9: what a rule left out when this person signed is part of the trail — their boxes (id and the sender's label) and every page left out by then. No answers, no personal data.
    const hid = hiddenOf.get(d.id);
    if (hid?.fields.length || hid?.pages.length) await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "hidden_by_rule", actorRole: party.role, occurredAt: signedAt, detail: { fields: hid.fields.slice(0, 200), labels: hid.labels.slice(0, 200), pages: hid.pages.slice(0, 200) } });
    if (witnessRow) {
      await tx.query(`INSERT INTO keystone.document_witness (tenant_id, instance_id, party_id, name, email, mark_image, mark_sha256, signed_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tenantId, d.id, partyId, witnessRow.name, witnessRow.email, witnessRow.mark, witnessRow.digest, signedAt, ip, userAgent ? String(userAgent).slice(0, 1000) : null]);
      await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "witnessed", actorRole: party.role, occurredAt: signedAt, detail: { mark_sha256: witnessRow.digest } });
    }
    await emit(tx, { tenantId, topic: "documents.document.signed", emittedBy: "documents", subjectType: "document", subjectId: d.id, actor: userActor(partyId), payload: { role: party.role, signature_record_stored: true, builder: "pdf" } });
  }
  await tx.query(
    `UPDATE keystone.document_party SET sign_reason = $6, status = 'signed', completed_at = $2, progress = NULL, consent_version = $3, consented_at = $2, consent_ip = $4, consent_user_agent = $5, held_signature = NULL, held_at = NULL, hold_expires_at = NULL, updated_at = now() WHERE id = $1`,
    [partyId, signedAt, PDF_CONSENT.version, ip, userAgent, why || null]);
  // Run 9 — a SIGNING GROUP: the seat is filled, so everyone else in the group is done (their links stop working; they are told nothing more is needed by the page they open)
  if (party.group_label) {
    const { rows: others } = await tx.query(
      `UPDATE keystone.document_party SET status = 'closed', completed_at = $3, updated_at = now() WHERE instance_id = $1 AND role = $2 AND id <> $4 AND action_role = 'signer' AND status NOT IN ('signed','declined','closed') RETURNING id`,
      [leadId, party.role, signedAt, partyId]);
    if (others.length) {
      const { rows: live } = await tx.query(`SELECT id FROM keystone.link_token WHERE tenant_id = $1 AND subject_id = $2 AND issued_to = ANY($3::uuid[]) AND redeemed_at IS NULL AND revoked_at IS NULL`, [tenantId, leadId, others.map((o) => o.id)]);
      for (const l of live) await revokeLinkTokenById(tx, l.id, "another member of the signing group signed");
      for (const d of docs) await recordAuditEvent(tx, { tenantId, instanceId: d.id, kind: "group_closed", actorRole: party.role, occurredAt: signedAt, detail: { closed: others.length } });
    }
  }

  return finishStep(tx, { tenantId, leadId, lead, docs, signed: true });
}

/** Stripe confirmed every payment this person had to make: sign from their held request, as of the moment they pressed Sign. Idempotent — a second call (the page and the webhook both
 *  arriving) finds nothing held and changes nothing. → { completed, ...signAsParty's answer } | { completed: false, reason } */
export async function completeHeldSignature(tx, { tenantId, partyId }) {
  const { rows: [p] } = await tx.query(`SELECT id, instance_id, status, held_signature, held_at, hold_expires_at FROM keystone.document_party WHERE id = $1 FOR UPDATE`, [partyId]);
  if (!p || p.status !== "awaiting_payment" || !p.held_signature) return { completed: false, reason: p?.status === "signed" ? "already_signed" : "nothing_held" };
  const h = p.held_signature;
  const out = await signAsParty(tx, { tenantId, leadId: p.instance_id, partyId, language: h.language ?? null, typedName: h.typedName, consent: h.consent === true, marks: h.marks ?? {}, values: h.values ?? {},
    signerTimezone: h.signerTimezone ?? null, ip: h.ip ?? null, userAgent: h.userAgent ?? null, reason: h.reason ?? null, signatureMethod: h.signatureMethod ?? null, witness: h.witness ?? null, hold: true, signedAtOverride: p.held_at });
  if (out.held) return { completed: false, reason: "more_to_pay", held: true, payments: out.payments };
  return { ...out, completed: true, signed: true };
}

/** The due sweep: a hold whose 7 days are over with no payment is cleared — nothing of it is kept — and the signer and the sender are told. Their link still works: they can sign and pay again. */
export const PAYMENT_HOLD_LAPSED_FACT = Object.freeze({
  key: "document_payment_hold_lapsed",
  why: "a signature kept for its payment was not paid within 7 days",
  find: (tx, { tenantId }) => tx.query(`SELECT id, instance_id, role FROM keystone.document_party WHERE tenant_id = $1 AND status = 'awaiting_payment' AND hold_expires_at <= now() ORDER BY hold_expires_at LIMIT 50`, [tenantId]),
  async act(tx, { tenantId, row }) {
    const { rowCount } = await tx.query(`UPDATE keystone.document_party SET status = 'viewed', held_signature = NULL, held_at = NULL, hold_expires_at = NULL, updated_at = now() WHERE id = $1 AND status = 'awaiting_payment' AND hold_expires_at <= now()`, [row.id]);
    if (!rowCount) return null;   // paid (or cleared) since the sweep read it
    for (const m of await documentsOfSend(tx, { instanceId: row.instance_id })) await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "hold_lapsed", actorRole: row.role });
    await sendHoldLapsedNotice(tx, { tenantId, partyId: row.id });   // the signer, by email; the sender by the owner notice the event raises
    await emit(tx, { tenantId, topic: "documents.payment.hold_lapsed", emittedBy: "documents", subjectType: "document", subjectId: row.instance_id, actor: "worker", payload: { role: row.role, builder: "pdf" } });
    return `hold on ${row.id} lapsed`;
  },
});

/** After a SIGNER signs or an APPROVER approves: either the next step is invited, or the last blocking person is done and every document executes. */
async function finishStep(tx, { tenantId, leadId, lead, docs, signed = true }) {
  const { rows: left } = await tx.query(`SELECT count(*)::int AS n FROM keystone.document_party WHERE instance_id = $1 AND action_role IN ('signer','approver') AND status NOT IN ('signed','approved','closed')`, [leadId]);
  if (left[0].n > 0) {
    const emailed = await advanceSequence(tx, { tenantId, leadId });
    return { state: "partially_signed", signed, remaining: left[0].n, completed: false, nextEmailed: emailed };
  }
  for (const d of docs) await executePdfDocument(tx, { tenantId, instanceId: d.id, createdBy: lead.created_by });
  return { state: "executed", signed, remaining: 0, completed: true };
}

/** Everyone has signed: freeze each document as the executed instrument and announce it (the archive job builds the sealed copy from this). */
async function executePdfDocument(tx, { tenantId, instanceId, createdBy = null }) {
  const { rows: [i] } = await tx.query(`SELECT id, title, builder, state, template_body_snapshot, package_lead_id FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (i.state === "executed") return { id: instanceId, state: "executed" };
  const { rows: [consenting] } = await tx.query(
    `SELECT consent_version, consented_at FROM keystone.document_party WHERE instance_id = $1 AND consented_at IS NOT NULL ORDER BY consented_at LIMIT 1`, [i.package_lead_id ?? i.id]);
  const snapshot = {
    law3_version: 1, builder: "pdf", title: i.title, template_id: null, template: i.template_body_snapshot, terms: null, price: null,
    disclosure: disclosureSnapshotFromAcceptance(consenting ? { version: consenting.consent_version, text_shown: PDF_CONSENT.text, accepted_at: consenting.consented_at } : null, { hasConsumerSigner: true }),
  };
  parseTemplateSnapshot(snapshot);
  const { rows: [r] } = await tx.query(
    `UPDATE keystone.document_instance SET state = 'executed', executed_at = now(), template_snapshot = $2::jsonb, next_reminder_at = NULL, updated_at = now()
      WHERE id = $1 AND state IN ('sent','partially_signed') RETURNING executed_at`, [instanceId, JSON.stringify(snapshot)]);
  if (!r) throw conflict("the document changed state while it was being completed — nothing was written");
  const { rows: [sig] } = await tx.query(`SELECT count(*)::int AS n, coalesce((SELECT is_test FROM keystone.document_instance WHERE id = $1), false) AS is_test FROM keystone.signature_record WHERE instance_id = $1`, [instanceId]);
  if (sig.n > 0 && !sig.is_test) await (await ports()).usage.recordEsign(tx, { tenantId, instanceId });
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "executed" });
  await emit(tx, {
    tenantId, topic: "documents.document.executed", emittedBy: "documents", subjectType: "document", subjectId: instanceId, actor: "system",
    payload: { builder: "pdf", test: sig.is_test === true, executed_at: r.executed_at, executed_by: createdBy, archive_actor_id: createdBy, price_frozen: false, disclosure_captured: Boolean(consenting), disclosure_version: consenting?.consent_version ?? null, law3_complete: Boolean(consenting), planId: null, appUserId: null, contractId: null, createdByDocumentId: null },
  });
  // The sealed copy is asked for AT ONCE, in this same transaction. Waiting for the event dispatcher's next sweep (every 60 s, then a second pass) made the signer wait 100 to 200 seconds (measured 7 Oct 2026: 199 s).
  // The job key is the one the event handler uses, so the handler's later request replaces this one instead of doubling it; archiving an already archived document just reuses it.
  // The sealed copy is made right here, by this process, once the signing transaction has had time to commit. The web process cannot reach the job queue (measured: it holds only the app_rw identity), so asking the queue silently never worked and the signer waited for the event dispatcher (22 to 199 s).
  // Archiving twice is safe: the job the event handler queues later finds the copy and reuses it (and still sends the signed-copy email).
  if (createdBy) {
    const P = await ports();
    if (P.queue?.runAs) setTimeout(async () => {
      try { const { archiveExecutedPdf } = await import("./archive.mjs"); await P.queue.runAs({ tenantId, userId: createdBy }, (t) => archiveExecutedPdf(t, { tenantId, instanceId })); }
      catch (e) { console.error(`sealed copy at signing failed for ${instanceId}; the queued job will retry: ${e?.message ?? e}`); }
    }, 1500).unref?.();
  }
  return { id: instanceId, state: "executed", executedAt: r.executed_at };
}

/** Decline the whole send, with a reason when the sender asked for one. */
export async function declineAsParty(tx, { tenantId, leadId, partyId, reason = null }) {
  const { party, lead, members } = await context(tx, { leadId, partyId, lock: true });
  requireVerified(party, lead);
  if (!isBlocking(party)) throw conflict("you are not asked to sign or approve this document");
  if (party.status === "signed") throw conflict("you have already signed — a signed document cannot be declined");
  if (!(await signingPolicy(tx)).allowDecline) throw forbidden("Declining is turned off for this organisation. Contact the sender if something is wrong.");
  const text = (reason ?? "").trim().slice(0, 500);
  if (lead.send_options?.require_decline_reason === true && !text) throw invalid("Please tell the sender why you are declining.", { field: "reason", code: "reason_required" });
  for (const m of members) {
    await tx.query(`UPDATE keystone.document_instance SET state = 'declined', declined_at = now(), next_reminder_at = NULL, updated_at = now() WHERE id = $1 AND state IN ('sent','partially_signed')`, [m.id]);
    await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "declined", actorRole: party.role });
    await emit(tx, { tenantId, topic: "documents.document.declined", emittedBy: "documents", subjectType: "document", subjectId: m.id, actor: userActor(partyId), payload: { role: party.role, builder: "pdf" } });
  }
  await tx.query(`UPDATE keystone.document_party SET status = 'declined', decline_reason = $2, completed_at = now(), updated_at = now() WHERE id = $1`, [partyId, text || null]);
  return { state: "declined" };
}

// (a helper placed above delegateAsParty on purpose: the topic-hygiene gate's reader loses its place after the e-mail pattern inside that function, so the emit lives where it can be read)
const announceDelegation = (tx, { tenantId, leadId, partyId, role }) =>
  emit(tx, { tenantId, topic: "documents.document.delegated", emittedBy: "documents", subjectType: "document", subjectId: leadId, actor: userActor(partyId), payload: { role } });

/**
 * Pass your turn to someone else (needs the organisation's `signing.allow_delegate`). The seat — its fields, its place in the order — moves to the named person: their name and email replace the
 * first person's on the SAME party row (so the document, the order and every field stay exactly as the sender set them), the first person's name and email are kept on the row as `delegated_from_*`
 * (the certificate prints both), the first link stops working, and the new person is emailed a fresh link. Refused once the person has signed, declined, or if the new address is their own.
 */
export async function delegateAsParty(tx, { tenantId, leadId, partyId, name, email }) {
  if (!(await signingPolicy(tx)).allowDelegate) throw forbidden("Passing a document to someone else is turned off for this organisation.");
  const { party, lead } = await context(tx, { leadId, partyId, lock: true });
  requireVerified(party, lead);
  if (!isBlocking(party) || isFinished(party)) throw conflict("you can only pass on a document you still have to sign or approve");
  const newName = typeof name === "string" ? name.trim() : "", newEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!newName || newName.length > 120) throw invalid("Enter the full name of the person who should sign instead.", { field: "name" });
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(newEmail)) throw invalid("Enter a valid email address for them.", { field: "email" });
  if (party.email && newEmail === party.email.toLowerCase()) throw invalid("That is your own address.", { field: "email" });
  const { rows: clash } = await tx.query(`SELECT 1 FROM keystone.document_party WHERE instance_id = $1 AND id <> $2 AND lower(email) = $3`, [leadId, partyId, newEmail]);
  if (clash.length) throw invalid("That person is already part of this document.", { field: "email" });
  await tx.query(
    `UPDATE keystone.document_party SET delegated_from_name = name, delegated_from_email = email, delegated_at = now(), name = $2, email = $3, status = 'pending', viewed_at = NULL, viewed_ip = NULL, viewed_user_agent = NULL,
            verified_at = NULL, verify_code_hash = NULL, verify_code_expires_at = NULL, verify_code_sent_at = NULL, verify_attempts = 0, verify_locked_until = NULL, invited_at = NULL, progress = NULL, updated_at = now() WHERE id = $1`,
    [partyId, newName, newEmail]);
  const { rows: [fresh] } = await tx.query(`SELECT * FROM keystone.document_party WHERE id = $1`, [partyId]);
  await recordAuditEvent(tx, { tenantId, instanceId: leadId, kind: "delegated", actorRole: party.role });
  const mail = await emailParty(tx, { tenantId, leadId, party: fresh });   // mints the new link (which revokes the old one) and mails it
  await announceDelegation(tx, { tenantId, leadId, partyId, role: party.role });
  return { delegated: true, to: { name: newName, email: newEmail }, emailed: Boolean(mail) };
}

export { AUTO_FIELD_TYPES };

/** The person asks for their emailed code. */
export async function sendCodeForParty(tx, { tenantId, leadId, partyId }) {
  const { party, lead } = await context(tx, { leadId, partyId, lock: true });
  return sendVerificationCode(tx, { tenantId, party, lead, title: lead.title });
}
/** The person answers the check (email or access code). */
export async function verifyForParty(tx, { tenantId, leadId, partyId, code }) {
  const { party, lead } = await context(tx, { leadId, partyId, lock: true });   // Round 3 S-2: parallel guesses wait for each other, so every wrong try is counted and the lockout cannot be outrun
  return verifyParty(tx, { tenantId, party, lead, code });
}

/** "Ask for changes": the person tells the sender what is wrong, without signing or declining. Recorded on the timeline (with their words) and the sender is notified; the document stays open. */
export async function requestChangesAsParty(tx, { tenantId, leadId, partyId, message }) {
  const { party, lead } = await context(tx, { leadId, partyId, lock: true });
  requireVerified(party, lead);
  if (party.status === "signed") throw conflict("you have already signed this document", { code: "already_signed" });
  const text = String(message ?? "").trim();
  if (!text) throw invalid("Tell the sender what needs to change.", { field: "message" });
  if (text.length > 1000) throw invalid("Keep it under 1000 characters.", { field: "message" });
  await recordAuditEvent(tx, { tenantId, instanceId: leadId, kind: "changes_requested", actorRole: party.role, detail: { message: text } });
  await emit(tx, { tenantId, topic: "documents.document.changes_requested", emittedBy: "documents", subjectType: "document", subjectId: leadId, actor: userActor(partyId), payload: { role: party.role, builder: "pdf" } });
  return { sent: true };
}

// ── the other roles (QUEUE §23.5.16) ─────────────────────────────────────────────────────────────────────────
/** An APPROVER approves or rejects. Approving finishes their step (the next person is invited, or — if they were last — every document executes). Rejecting stops the whole send and tells the sender. */
export async function decideAsApprover(tx, { tenantId, leadId, partyId, decision, comment = null, ip = null, userAgent = null }) {
  const { party, lead, members } = await context(tx, { leadId, partyId, lock: true });
  requireVerified(party, lead);
  if (party.action_role !== "approver") throw conflict("you are not asked to approve this document");
  if (isFinished(party)) throw conflict("you have already answered this");
  if (decision !== "approve" && decision !== "reject") throw invalid("choose approve or reject", { field: "decision" });
  const { rows: parties } = await tx.query(`SELECT * FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [leadId]);
  if (!isActionable(party, parties)) {
    const ahead = parties.filter((p) => isBlocking(p) && !isFinished(p) && p.position < party.position).map((p) => p.name);
    throw conflict(`It is not your turn yet — waiting for ${ahead.join(", ") || "someone else"} first.`, { code: "not_your_turn" });
  }
  const text = String(comment ?? "").trim().slice(0, 500);
  const docs = await memberBodies(tx, members);
  if (decision === "reject") {
    if (lead.send_options?.require_decline_reason === true && !text) throw invalid("Please tell the sender why you are rejecting it.", { field: "comment", code: "reason_required" });
    for (const m of members) {
      await tx.query(`UPDATE keystone.document_instance SET state = 'declined', declined_at = now(), next_reminder_at = NULL, updated_at = now() WHERE id = $1 AND state IN ('sent','partially_signed')`, [m.id]);
      await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "rejected", actorRole: party.role, detail: text ? { comment: text } : null });
      await emit(tx, { tenantId, topic: "documents.document.declined", emittedBy: "documents", subjectType: "document", subjectId: m.id, actor: userActor(partyId), payload: { role: party.role, builder: "pdf", approver: true } });
    }
    await tx.query(`UPDATE keystone.document_party SET status = 'rejected', decline_reason = $2, completed_at = now(), updated_at = now() WHERE id = $1`, [partyId, text || null]);
    return { state: "declined", decision: "reject" };
  }
  for (const m of members) {
    await tx.query(`UPDATE keystone.document_instance SET state = 'partially_signed', updated_at = now() WHERE id = $1 AND state = 'sent'`, [m.id]);
    await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "approved", actorRole: party.role, detail: { ...(text ? { comment: text } : {}), ...(ip ? { ip } : {}) } });
  }
  await tx.query(`UPDATE keystone.document_party SET status = 'approved', completed_at = now(), updated_at = now() WHERE id = $1`, [partyId]);
  return { ...(await finishStep(tx, { tenantId, leadId, lead, docs, signed: false })), decision: "approve" };
}

/** A VIEWER confirms they have seen the document. Blocks nothing. */
export async function acknowledgeAsViewer(tx, { tenantId, leadId, partyId, ip = null }) {
  const { party, lead, members } = await context(tx, { leadId, partyId });
  requireVerified(party, lead);
  if (party.action_role !== "viewer") throw conflict("you are not asked to confirm this document");
  if (isFinished(party)) return { acknowledged: true, already: true };
  await tx.query(`UPDATE keystone.document_party SET completed_at = now(), status = CASE WHEN status = 'pending' THEN 'viewed' ELSE status END, updated_at = now() WHERE id = $1`, [partyId]);
  for (const m of members) await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "acknowledged", actorRole: party.role, detail: ip ? { ip } : null });
  return { acknowledged: true };
}

/** An ASSISTANT fills in details for the seat they help. `values` are keyed by field id; only that seat's fields that a person types (never a signature, initials, date or stamp) are accepted. They land in that person's saved-for-later values, which the person sees prefilled and checks before signing. `finish` marks the assistant done. */
export async function assistAsParty(tx, { tenantId, leadId, partyId, values = {}, finish = false }) {
  const { party, lead, members } = await context(tx, { leadId, partyId, lock: true });
  requireVerified(party, lead);
  if (party.action_role !== "assistant" || !party.assists_role) throw conflict("you are not asked to fill in details on this document");
  if (isFinished(party) && !finish) throw conflict("you have already finished");
  const { rows: [target] } = await tx.query(`SELECT * FROM keystone.document_party WHERE instance_id = $1 AND role = $2`, [leadId, party.assists_role]);
  if (!target) throw conflict("the person you were asked to help is no longer on this document");
  if (isFinished(target)) throw conflict(`${target.name} has already answered, so details can no longer be added`);
  const docs = await memberBodies(tx, members);
  const mine = new Map();
  for (const d of docs) for (const f of d.body.fields) if (f.role === target.role && !AUTO_FIELD_TYPES.includes(f.type)) mine.set(f.id, f);
  const accepted = {};
  const problems = [];
  for (const [id, v] of Object.entries(values ?? {})) {
    const f = mine.get(id);
    if (!f) { problems.push(`${id} is not a field you can fill in`); continue; }
    if (v === null || v === "") continue;
    const problem = validateFieldValue({ ...f, required: false }, v);
    if (problem) { problems.push(`${f.label || f.type} ${problem}`); continue; }
    accepted[id] = v;
  }
  if (problems.length) throw invalid(`Some details need attention: ${problems.slice(0, 3).join("; ")}`, { code: "fields_invalid", problems });
  const merged = { ...(target.progress ?? {}), ...accepted };
  await tx.query(`UPDATE keystone.document_party SET progress = $2::jsonb, updated_at = now() WHERE id = $1`, [target.id, JSON.stringify(merged)]);
  if (finish) {
    await tx.query(`UPDATE keystone.document_party SET completed_at = now(), updated_at = now() WHERE id = $1`, [partyId]);
    for (const m of members) await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "assisted", actorRole: party.role, detail: { for: target.role, fields: Object.keys(accepted).length } });
  }
  return { saved: true, fields: Object.keys(accepted).length, finished: Boolean(finish) };
}

// ── files going in and out (QUEUE §23.5.4) ─────────────────────────────────────────────────────────────────────
/** A signer uploads a file into one of their `file` fields. The bytes are small (the request body is capped); the page shrinks photos first. */
export async function uploadFileForField(tx, { tenantId, leadId, partyId, fieldId, name, bytes }) {
  const { party, lead, members } = await context(tx, { leadId, partyId });
  requireVerified(party, lead);
  if (party.action_role !== "signer") throw conflict("you are not asked to fill in this document");
  const docs = await memberBodies(tx, members);
  const hit = docs.map((d) => ({ d, f: d.body.fields.find((x) => x.id === fieldId) })).find((x) => x.f);
  if (!hit || hit.f.type !== "file" || hit.f.role !== party.role) throw invalid("that is not a file field you can fill in", { field: "fieldId" });
  return acceptFieldFile(tx, { tenantId, instanceId: hit.d.id, partyId, fieldId, name, bytes });
}

/** The bytes of one of the sender's extra files, for a person on the send. */
export async function readAttachmentForParty(tx, { leadId, partyId, fileId }) {
  const { party, lead } = await context(tx, { leadId, partyId });
  requireVerified(party, lead);
  if (!(lead.send_options?.attachments ?? []).includes(fileId)) throw forbidden(LINK_REFUSED);
  const { bytes, row } = await readFileBytes(tx, { fileId });
  return { bytes, name: row.name, mime: row.mime };
}

/** What the signing page needs to choose its language: the one to use now and whether the sender left the choice open (then the browser's own language may take over). */
async function signerLanguageView(tx, { lead, party }) {
  const { language, auto } = await languageFor(tx, { sendOptions: lead.send_options, party });
  return { language, languageAuto: auto };
}
