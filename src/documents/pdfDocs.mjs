// src/documents/pdfDocs.mjs — THE DRAFT OF AN UPLOADED DOCUMENT: read it, autosave it, check it, make a template of it, start one from a template (QUEUE §23.4.3 – §23.4.6, §23.4.9).
//
// A draft is a `document_instance` (builder `pdf`, state `draft`). Its working body lives in `template_body_snapshot` (the same column the frozen body uses once it is sent); its people are `document_party`
// rows on the LEAD instance of the send (a package keeps one set of people); its send choices are `send_options`. Nothing here sends anything — pdfSend.mjs does.
import { assertNoNewRules, pdfRuleItems, assertNoNewPaymentModes, pdfPaymentModeItems } from "./ruleAuthoring.mjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { getDocumentSettings } from "./settings.mjs";
import { parsePdfBodyData, checkPdfDraft, SEAT_KEY } from "./pdfBody.mjs";
import { pdfStatus, actionsFor } from "./pdfFlow.mjs";
import { leadOf, documentsOfSend } from "./parties.mjs";
import { getIdentity, identityStatus } from "./emailIdentity.mjs";
import { cleanEmailAddress } from "./textSafety.mjs";
import { filesOf, readFileBytes, sha256Hex } from "./files.mjs";
import { createInstance } from "./writes.mjs";
import { assertDocumentVisible, assertTemplateVisible, defaultTeamFor } from "./teams.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { reviewState, REVIEW_PROBLEM } from "./chat/review.mjs";
import { searchContacts } from "./contacts.mjs";
import { hashAccessCode } from "./pdfVerify.mjs";
import { uniqueTemplateName, startingApproval, assertUsable } from "./pdfTemplates.mjs";
import { beforeNewTemplate, afterNewTemplate } from "./templateCap.mjs";

const VERIFICATION_MODES = Object.freeze(["none", "email_code", "access_code"]);
export { LANGUAGES } from "./languages.mjs";
import { LANGUAGES } from "./languages.mjs";
const ACTION_ROLES = Object.freeze(["signer", "approver", "viewer", "cc", "assistant"]);

export const sendOptionsSchema = z.object({
  subject: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  reply_to: z.string().email().max(254).optional(),     // FP-K3: where replies to THIS document's emails go
  sender_name: z.string().min(1).max(120).optional(),   // FP-K3: the name the emails say they are from, for THIS document
  expiry_days: z.number().int().min(0).max(365).nullable().optional(),       // null/0 = never
  reminders: z.object({ on: z.boolean(), days: z.array(z.number().int().min(1).max(60)).max(3) }).strict().optional(),
  verification: z.enum(VERIFICATION_MODES).optional(),
  access_code: z.string().min(4, "an access code is at least 4 characters").max(64).optional(),   // write-only: hashed on save, never returned
  access_code_set: z.boolean().optional(),                                                         // read-only echo of "a code is set"; dropped on save
  access_code_hash: z.string().max(200).optional(),                                                // server-set; ignored if a client sends it
  order: z.enum(["parallel", "sequential"]).optional(),
  require_decline_reason: z.boolean().optional(),
  test: z.boolean().optional(),                    // Part 30 item 8 — a practice run: mails only its sender, stamped TEST, never counted
  language: z.enum([...LANGUAGES, "auto"]).optional(),   // "auto" (or nothing) = match each signer's own language
  attachments: z.array(z.string().uuid()).max(20).optional(),                 // extra files the signer receives with the document
  plays: z.record(z.string().max(80), z.object({ plays: z.enum(["you", "at_send", "fixed"]), name: z.string().max(120).optional(), email: z.string().max(254).optional() }).strict()).optional(),   // template roles: who plays each by default (ignored when a document is sent)
  internal_note: z.string().max(2000).optional(),                              // Docustay flow v2: a note only the sender sees (never shown to a signer, never in the signed copy)
  send_at: z.string().datetime().nullable().optional(),                       // a scheduled send
  save_as_template: z.boolean().optional(),
  in_person: z.array(z.string().regex(SEAT_KEY)).max(50).optional(),          // seats that sign on this device, no email
  embedded: z.array(z.string().regex(SEAT_KEY)).max(50).optional(),           // Part 30 item 4 — seats signed inside the sender's own app (no email; a session link comes from the API)
  kiosk: z.boolean().optional(),                                              // made by kiosk mode (one document per person at a shared device)
  self_serve: z.boolean().optional(),                                         // made from a template's public link
}).strict();

const partySchema = z.object({
  role: z.string().regex(SEAT_KEY),
  name: z.string().trim().max(120),   // a draft row may be blank while it is being typed; the checklist refuses a nameless person at Send
  email: z.string().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  action_role: z.enum(ACTION_ROLES).default("signer"),
  external_ref: z.string().uuid().nullable().optional(),                      // the host's person id when picked from contacts
  expires_at: z.string().datetime().nullable().optional(),
  reminder_days: z.array(z.number().int().min(1).max(60)).max(3).nullable().optional(),
  assists_role: z.string().regex(SEAT_KEY).nullable().optional(),            // an assistant fills in details for this seat
  step: z.number().int().min(1).max(50).nullable().optional(),               // sequential order: people with the same step act at the same time
  group_label: z.string().trim().min(1).max(80).nullable().optional(),        // Run 9 (Pro): a SIGNING GROUP — several people in one seat; the first to sign fills it, the others' turn ends
  witness_required: z.boolean().optional(),                                   // Run 9 (Free): a witness signs straight after this person, on the same device, and is named on the certificate
}).strict();

async function loadInstance(tx, instanceId) {
  const { rows: [i] } = await tx.query(
    `SELECT id, title, state, builder, message, description, template_body_snapshot, send_options, sent_at, expires_at, scheduled_send_at, created_by, created_at, updated_at,
            package_lead_id, package_position, original_sha256, final_sha256, executed_at, voided_at, void_reason, declined_at, subject_user_id, sender_view, source, source_facts, source_paper, variable_values
       FROM keystone.document_instance WHERE id = $1 AND archived_at IS NULL`, [instanceId]);
  if (!i) throw notFound("That document is not in this workspace.");
  if (i.builder !== "pdf") throw invalid("this is not an uploaded document", { code: "wrong_builder" });
  await assertDocumentVisible(tx, instanceId);      // Part 30 item 8: a team's document looks absent to people outside the team (when the workspace limits visibility)
  return i;
}

/** Seats suggested by what was found: one per distinct signature-like blank on the first page, between 1 and 4 (a person can always add more). */
export function suggestedSeats(body) {
  const sigs = (body?.suggestions ?? []).filter((s) => s.type === "signature");
  const n = Math.min(4, Math.max(1, sigs.length));
  return Array.from({ length: n }, (_, i) => ({ key: `signer_${i + 1}`, label: `Signer ${i + 1}` }));
}

/**
 * R13-D010 — the deadline a send starts with when the sender has not chosen one. A document made from a template (an authored source, or a pdf copied from a template) starts from the
 * workspace's "Signature request expires after (days)" (0 = never); an uploaded document starts from "Uploaded documents expire after (days)". The Send step shows this value and the
 * send applies the same one, so what the screen says is what is stored.
 */
// R13-D140 (17 Oct): "Uploaded documents expire after" is cut from version 1 (decision 41), so every send, uploaded or not, starts from the one
// workspace setting the person can see and change. `fromTemplate` is kept so callers need not change.
export function defaultExpiryDays(settings, { fromTemplate = false } = {}) {   // eslint-disable-line no-unused-vars
  const v = settings?.signature_validity_days;
  return Number.isInteger(v) && v >= 0 ? v : 0;
}
/** True when this draft came from a template (not a plain upload): an authored source on the row, or an original file copied from a template. */
export async function isFromTemplate(tx, instanceId) {
  const { rows } = await tx.query(
    `SELECT 1 FROM keystone.document_instance i WHERE i.id = $1 AND (i.source IS NOT NULL OR EXISTS (SELECT 1 FROM keystone.document_file f WHERE f.instance_id = i.id AND f.kind = 'original' AND f.meta->>'from_template' IS NOT NULL))`, [instanceId]);
  return rows.length > 0;
}

const seatLabel = (roles, key) => roles?.find((r) => r.key === key)?.label ?? key;

/** The whole draft (or sent document) as the screens need it. */
export async function getPdfDocument(tx, { tenantId, instanceId }) {
  const i = await loadInstance(tx, instanceId);
  const lead = i.package_lead_id ?? i.id;
  const { rows: parties } = await tx.query(
    `SELECT p.id, p.role, p.action_role, p.position, p.name, p.email, p.phone, p.external_ref, p.expires_at, p.reminder_days, p.assists_role, p.reminders_sent, p.status, p.viewed_at, p.completed_at, p.decline_reason, p.email_delivery, p.consented_at, p.group_label, p.witness_required,
            EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = p.external_ref AND u.role = 'staff' AND u.archived_at IS NULL) AS internal
       FROM keystone.document_party p WHERE p.instance_id = $1 ORDER BY p.position, p.created_at`, [lead]);
  const files = await filesOf(tx, { instanceId });
  const members = await documentsOfSend(tx, { instanceId });
  const body = i.template_body_snapshot ?? null;
  const storedOpts = i.send_options ?? {};
  const { access_code_hash: _hash, ...opts } = storedOpts;                       // the hash never leaves the server
  if (storedOpts.access_code_hash) opts.access_code_set = true;
  const settings = await getDocumentSettings(tx);
  let checklist = null;
  if (i.state === "draft" && body) {
    const identity = await getIdentity(tx, { tenantId }).catch(() => null);
    checklist = checkPdfDraft(body, parties.map((p) => ({ ...p, in_person: (opts.in_person ?? []).includes(p.role) })), { order: opts.order ?? null, senderIdentity: identity ? { fallback: identity.mode === "platform" && Boolean(identity.fallbackReason), reason: identity.fallbackReason ?? null } : null });
    // Run 8 R8-46 (J5): a fresh self-hosted install said "everyone gets the email straight away" here and refused only at Send. Say it at Check, when anyone is to be emailed.
    const mailNow = await identityStatus(tx, { tenantId }).catch(() => null);
    const mailState = mailNow?.state ?? null;
    // Run 8 R8-62 (J8): at the day's email limit Check was all green and the send said "Sent." with nobody emailed. Say it here, before sending.
    const toEmail = parties.filter((p) => p.email && !(opts.in_person ?? []).includes(p.role) && (p.action_role ?? "signer") !== "cc").length;
    const lim = mailNow?.limit;
    if (mailState !== "not_configured" && toEmail && lim?.limit && lim.sent + (opts.order === "sequential" ? 1 : toEmail) > lim.limit) {
      const left = Math.max(0, lim.limit - lim.sent);
      const msg = left === 0
        ? { text: `Today's email limit is used up (${lim.sent} of ${lim.limit}), so nobody can be emailed a link until it resets at midnight UTC. You can still send and give each person their link yourself.`, key: "Today's email limit is used up ({sent} of {limit}), so nobody can be emailed a link until it resets at midnight UTC. You can still send and give each person their link yourself.", vars: { sent: lim.sent, limit: lim.limit } }
        : { text: `Only ${left} of today's ${lim.limit} emails ${left === 1 ? "is" : "are"} left, so not everyone can be emailed a link now. It resets at midnight UTC.`, key: "{left, plural, one {Only # of today's {limit} emails is left} other {Only # of today's {limit} emails are left}}, so not everyone can be emailed a link now. It resets at midnight UTC.", vars: { left, limit: lim.limit } };
      checklist.items.unshift({ ok: false, severity: "warning", code: "email_limit_today", ...msg });
    }
    // Run 8 R8-64 (J8): at the month's document limit a whole document could be set up and only Send refused it. Say it at Check, in the words the refusal uses.
    const allowance = await (await ports()).entitlements?.sendAllowance?.(tx, { tenantId }).catch(() => null);
    // R13-D184 (23 Oct): a practice run (test switch on, or a test send) is never counted, so the month's limit is not a problem for it
    const practice = opts.test === true || (await (await import("./settings.mjs")).getDocumentSetting(tx, "test_mode.on").catch(() => false)) === true;
    if (!practice && allowance && allowance.used >= allowance.limit) {
      // R13-D395: the row says the way on in the send refusal's own words (src/product/docustay.mjs), so Check, Send and the plan note agree
      const { PRICES } = await import("../product/docustayPrices.mjs");
      const price = (PRICES.payg.docOverMinor / 100).toFixed(2), included = PRICES.payg.docsIncluded;
      const tail = allowance.paid ? "The count resets next month." : `Switch to Pay as you go to keep sending ($${price} a document after the first ${included}), or choose Pro.`;
      checklist.items.unshift({ ok: false, severity: "error", code: "plan_document_limit", text: `Your ${allowance.plan} plan allows ${allowance.limit} documents a month and you have sent ${allowance.used}. ${tail}`, key: allowance.paid ? "Your {plan} plan allows {limit} documents a month and you have sent {used}. The count resets next month." : "Your {plan} plan allows {limit} documents a month and you have sent {used}. Switch to Pay as you go to keep sending (${price} a document after the first {included}), or choose Pro.", vars: { plan: allowance.plan, limit: allowance.limit, used: allowance.used, price, included }, upgrade: !allowance.paid });
      checklist.ok = false;
    }
    if (mailState === "not_configured" && parties.some((p) => p.email && !(opts.in_person ?? []).includes(p.role))) checklist.items.unshift({ ok: false, severity: "warning", code: "email_not_set_up", text: "Email isn't set up yet, so nobody can be emailed a link. Open Settings → Email, choose how mail goes out and send yourself a test, then send.", key: "Email isn't set up yet, so nobody can be emailed a link. Open Settings → Email, choose how mail goes out and send yourself a test, then send.", vars: {} });
    const scannedOnly = files.find((f) => f.id === body.file?.file_id)?.meta?.already_signed;
    if (opts.verification === "access_code" && !storedOpts.access_code_hash) { checklist.items.push({ ok: false, severity: "error", text: "You chose an access code but have not set one — type it on the Send step", key: "You chose an access code but have not set one — type it on the Send step", vars: {} }); checklist.ok = false; }
    if (opts.verification === "email_code") for (const p of parties.filter((x) => (x.action_role ?? "signer") === "signer" && !(opts.in_person ?? []).includes(x.role) && !x.email)) { checklist.items.push({ ok: false, severity: "error", text: `${p.name} has no email, so an email code cannot reach them`, key: "{name} has no email, so an email code cannot reach them", vars: { name: p.name } }); checklist.ok = false; }
    if (scannedOnly) checklist.items.unshift({ ok: false, severity: "warning", text: "This PDF already carries a digital signature. It will be sent exactly as it is — fields cannot be added without breaking that signature.", key: "This PDF already carries a digital signature. It will be sent exactly as it is — fields cannot be added without breaking that signature.", vars: {} });
  }
  // ai.require_review: assistant-written text must be read by the sender before the send (the checklist says so; the send refuses the same way)
  const aiReview = i.state === "draft" ? await reviewState(tx, { instanceId }).catch(() => null) : null;
  if (checklist && aiReview?.needed) { checklist.items.push({ ok: false, severity: "error", code: "ai_review", text: REVIEW_PROBLEM }); checklist.ok = false; }
  const status = pdfStatus(i.state, { checksOk: Boolean(checklist?.ok) });
  return {
    id: i.id, title: i.title, state: i.state, status, actions: actionsFor(status), message: i.message, description: i.description, senderView: i.sender_view ?? null, source: i.state === "draft" ? (i.source ?? null) : null, sourceFacts: i.state === "draft" ? (i.source_facts ?? null) : null, sourcePaper: i.source_paper ?? null, variableValues: i.variable_values ?? null,
    sentAt: i.sent_at, expiresAt: i.expires_at, scheduledSendAt: i.scheduled_send_at, executedAt: i.executed_at, voidedAt: i.voided_at, voidReason: i.void_reason, createdBy: i.created_by, createdAt: i.created_at, updatedAt: i.updated_at,
    originalSha256: i.original_sha256, finalSha256: i.final_sha256,
    body, bodySeats: body ? body.roles.map((r) => ({ ...r })) : [], suggestedSeats: body ? suggestedSeats(body) : [],
    parties: parties.map((p) => ({ ...p, seat_label: seatLabel(body?.roles, p.role), in_person: (opts.in_person ?? []).includes(p.role) })),
    sendOptions: opts, files, package: { leadId: lead, isLead: lead === i.id, members },
    defaults: { expiryDays: defaultExpiryDays(settings, { fromTemplate: i.source != null || files.some((f) => f.kind === "original" && f.meta?.from_template) }), saveAsTemplate: settings["upload.save_as_template"], reminderDays: settings.reminder_days },
    checklist, aiReview,
  };
}

export function normaliseParties(rawParties, { order }) {
  const parties = rawParties.map((p, idx) => {
    const r = partySchema.safeParse(p);
    if (r.success) { const c = r.data.email ? cleanEmailAddress(r.data.email) : null; return c?.ok ? { ...r.data, email: c.email } : r.data; }   // a good address is stored plain (domain in punycode, lower case); a half-typed draft one is kept as typed and the checklist stops it at Send
    const i = r.error.issues[0]; const where = [...(i?.path ?? [])].join(".");
    // F909: a bad or unknown key is the caller's mistake (400 naming the field), never a 500
    throw invalid(i?.code === "unrecognized_keys" ? `parties.${idx}: unknown field ${(i.keys ?? []).join(", ")}` : `parties.${idx}${where ? `.${where}` : ""}: ${i?.message ?? "is not valid"}`, { field: `parties.${idx}${where ? `.${where}` : ""}` });
  });
  const seats = new Map();
  parties.forEach((p, idx) => {
    // Run 9: a seat holds one person, or a SIGNING GROUP — everyone in it a signer with the same group name
    const first = seats.get(p.role);
    if (first && !(p.group_label && first.group_label && p.group_label.toLowerCase() === first.group_label.toLowerCase() && p.action_role === "signer" && first.action_role === "signer"))
      throw invalid(first.group_label || p.group_label ? `Everyone sharing the signing spot ${p.role} must be a signer in the same signing group` : `two people are in the seat ${p.role}`, { field: `parties.${idx}.role` });
    if (!first) seats.set(p.role, p);
    if (p.group_label && p.action_role !== "signer") throw invalid("Only people who sign can be in a signing group.", { field: `parties.${idx}.group_label` });
    if (p.witness_required && p.action_role !== "signer") throw invalid("Only a person who signs can have a witness.", { field: `parties.${idx}.witness_required` });
    // a DRAFT may hold an unfinished address (people save as they type); the checklist refuses it at Next and at Send
  });
  // ★ F1046 — a witness asked of a signing group is asked of the SEAT: whoever in the group signs needs one (a member added after the box was ticked carried no flag, so the document
  //   completed with no witness at all). Every member of a seat inherits the flag from any member that has it.
  const witnessedSeats = new Set(parties.filter((p) => p.witness_required && p.group_label).map((p) => p.role));
  parties.forEach((p, i) => { if (witnessedSeats.has(p.role) && p.group_label && p.action_role === "signer" && !p.witness_required) parties[i] = { ...p, witness_required: true }; });
  // ★ §23.5.16 — an assistant helps one signer, and only when the signing order is on (otherwise nobody is "before" anybody)
  parties.forEach((p, idx) => {
    if (p.action_role === "assistant") {
      if (order !== "sequential") throw invalid("An assistant can only be used when people sign in order.", { field: `parties.${idx}.action_role`, code: "assistant_needs_order" });
      if (!p.assists_role || p.assists_role === p.role || !parties.some((q) => q.role === p.assists_role && q.action_role === "signer")) throw invalid(`${p.name} (assistant) must be set to help one of the people who signs.`, { field: `parties.${idx}.assists_role` });
    } else if (p.assists_role) throw invalid("Only an assistant helps another person.", { field: `parties.${idx}.assists_role` });
  });
  // positions: parallel = everyone at 1; sequential = the step given (people sharing a step act together), else the order given (1, 2, 3 …); steps are packed to 1, 2, 3 …
  if (order !== "sequential") return parties.map((p) => ({ ...p, position: 1 }));
  // a group's members act at the same step as the first of them
  const firstIdx = new Map(); parties.forEach((p, idx) => { if (!firstIdx.has(p.role)) firstIdx.set(p.role, idx); });
  // R13-D051: a person added after others were given steps (an assistant added to a template's first seat) simply goes after the highest step given; it used to refuse the whole save, so the role was lost on reload
  const given = parties.map((p) => p.step).filter((x) => x != null), top = given.length ? Math.max(...given) : 0; let extra = 0;
  const raw0 = parties.map((p, idx) => (p.step ?? (given.length ? top + (++extra) : idx + 1)));
  const raw = parties.map((p, idx) => raw0[firstIdx.get(p.role)] ?? raw0[idx]);
  if (raw.some((s) => s == null)) throw invalid("Give every person a step, or none.", { field: "parties" });
  const rank = new Map([...new Set(raw)].sort((a, b) => a - b).map((s, k) => [s, k + 1]));
  return parties.map((p, idx) => ({ ...p, position: rank.get(raw[idx]) }));
}

/**
 * Autosave. Any of title / body / parties / sendOptions / message may be sent; what is sent replaces what was there (the screen sends the whole of each part). Only a draft can be changed.
 * @returns the saved document (same shape as getPdfDocument)
 */
export async function savePdfDocument(tx, { tenantId, instanceId, actorUserId = null, title, body, parties, sendOptions, message, description }) {
  const i = await loadInstance(tx, instanceId);
  if (i.state !== "draft") throw conflict("a document that has been sent cannot be edited — void it and send a new one");
  const lead = i.package_lead_id ?? i.id;
  if (typeof title === "string") {
    if (!title.trim()) throw invalid("the document needs a title", { field: "title" });
    await tx.query(`UPDATE keystone.document_instance SET title = $2, updated_at = now() WHERE id = $1`, [instanceId, title.trim().slice(0, 200)]);
  }
  if (typeof message === "string" || message === null) await tx.query(`UPDATE keystone.document_instance SET message = $2, updated_at = now() WHERE id = $1`, [instanceId, message]);
  if (typeof description === "string" || description === null) await tx.query(`UPDATE keystone.document_instance SET description = $2, updated_at = now() WHERE id = $1`, [instanceId, description]);
  let nextBody = i.template_body_snapshot;
  if (body !== undefined) {
    let parsed;
    // a seat named by a person in the same save belongs on the document (the people step adds seats)
    if (body && Array.isArray(body.roles) && Array.isArray(parties)) {
      const have = new Set(body.roles.map((r) => r.key));
      const extra = parties.filter((p) => p?.role && !have.has(p.role)).map((p) => ({ key: p.role, label: `Signer ${String(p.role).split("_")[1]}` }));
      if (extra.length) body = { ...body, roles: [...body.roles, ...extra] };
    }
    // ...and so does a person already stored on the draft: a screen holding an older copy of the seats must not be refused for placing their field
    if (body && Array.isArray(body.roles) && Array.isArray(body.fields) && parties === undefined) {
      const have = new Set(body.roles.map((r) => r.key));
      const wanted = [...new Set(body.fields.map((f) => f?.role).filter((r) => typeof r === "string" && !have.has(r)))];
      if (wanted.length) {
        const { rows: stored } = await tx.query(`SELECT role FROM keystone.document_party WHERE instance_id = $1`, [lead]);
        const known = new Set(stored.map((r) => r.role));
        const extra = wanted.filter((r) => known.has(r)).map((r) => ({ key: r, label: `Signer ${String(r).split("_")[1]}` }));
        if (extra.length) body = { ...body, roles: [...body.roles, ...extra] };
      }
    }
    try { parsed = parsePdfBodyData(body); } catch (e) { throw invalid(e.message, { issues: e.issues ?? [] }); }
    assertNoNewRules(pdfRuleItems, parsed, i.template_body_snapshot);   // v1 item 6
    assertNoNewPaymentModes(pdfPaymentModeItems, parsed, i.template_body_snapshot);   // v1 item 10
    const { rows: [f] } = await tx.query(`SELECT id, sha256, kind, meta FROM keystone.document_file WHERE id = $1 AND instance_id = $2`, [parsed.file.file_id, instanceId]);
    if (!f) throw invalid("the body names a file that is not part of this document", { field: "body.file.file_id" });
    if (f.sha256 !== parsed.file.sha256) throw invalid("the body's file fingerprint does not match the stored file", { field: "body.file.sha256" });
    if (f.meta?.already_signed && parsed.fields.length) throw invalid("This PDF already carries a digital signature, so fields cannot be placed on it without breaking that signature.", { code: "already_signed" });
    nextBody = parsed;
    await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, updated_at = now() WHERE id = $1`, [instanceId, JSON.stringify(parsed)]);
  }
  let opts = i.send_options ?? {};
  if (sendOptions !== undefined) {
    const r = sendOptionsSchema.safeParse(sendOptions);
    if (!r.success) throw invalid(`send options: ${r.error.issues[0].path.join(".") || "(root)"} — ${r.error.issues[0].message}`, { issues: r.error.issues.map((x) => ({ path: x.path.join("."), message: x.message })) });
    opts = r.data;
    // ★ §23.5.2 — the access code is hashed here and only the hash is kept; a client can neither read nor set the hash; switching the check off drops it
    const { access_code: typedCode, access_code_hash: _ignored, access_code_set: _echo, ...rest } = opts;
    opts = rest;
    // ★ the list of extra files is managed by the server (attach / remove), never by the autosaved options: a stale copy on the screen must not drop one, and a made-up id must not name a file
    opts.attachments = (i.send_options ?? {}).attachments ?? [];
    if (!opts.attachments.length) delete opts.attachments;
    const previousHash = (i.send_options ?? {}).access_code_hash;
    if (opts.verification === "access_code") { const h = typedCode ? hashAccessCode(typedCode) : previousHash; if (h) opts.access_code_hash = h; }
    await tx.query(`UPDATE keystone.document_instance SET send_options = $2::jsonb, updated_at = now() WHERE id = $1`, [instanceId, JSON.stringify(opts)]);
    const sched = opts.send_at ?? null;
    await tx.query(`UPDATE keystone.document_instance SET scheduled_send_at = $2 WHERE id = $1`, [instanceId, sched]);
  }
  if (parties !== undefined) {
    if (!Array.isArray(parties) || parties.length > 50) throw invalid("parties must be a list of up to 50 people", { field: "parties" });
    // a row nobody has typed into yet is not stored (the screen keeps it while it is being filled in); a row with only an address is stored under it
    const rows = normaliseParties(parties, { order: opts.order ?? "parallel" }).filter((p) => p.name || p.email).map((p) => (p.name ? p : { ...p, name: p.email }));
    if (nextBody) {
      const seats = new Set(nextBody.roles.map((r) => r.key));
      const missing = rows.filter((p) => !seats.has(p.role));
      if (missing.length) {
        // a person added in the people step brings their seat with them
        nextBody = parsePdfBodyData({ ...nextBody, roles: [...nextBody.roles, ...missing.map((p) => ({ key: p.role, label: `Signer ${p.role.split("_")[1]}` }))] });
        await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb WHERE id = $1`, [instanceId, JSON.stringify(nextBody)]);
      }
    }
    await tx.query(`DELETE FROM keystone.document_party WHERE instance_id = $1`, [lead]);
    for (const p of rows) {
      await tx.query(
        `INSERT INTO keystone.document_party (tenant_id, instance_id, role, action_role, position, name, email, phone, external_ref, expires_at, reminder_days, assists_role, group_label, witness_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [tenantId, lead, p.role, p.action_role, p.position, p.name, p.email ?? null, p.phone ?? null, p.external_ref ?? null, p.expires_at ?? null, p.reminder_days ?? null, p.assists_role ?? null, p.group_label ?? null, p.witness_required === true]);
    }
  } else if (sendOptions !== undefined && opts.order) {
    // the order changed on its own: re-number the people already on the send
    const { rows: existing } = await tx.query(`SELECT id FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [lead]);
    const { rows: pos } = await tx.query(`SELECT DISTINCT position FROM keystone.document_party WHERE instance_id = $1`, [lead]);
    const keepSteps = opts.order === "sequential" && pos.length > 1;                // already numbered steps stay as they are
    if (!keepSteps) for (let k = 0; k < existing.length; k += 1) await tx.query(`UPDATE keystone.document_party SET position = $2 WHERE id = $1`, [existing[k].id, opts.order === "sequential" ? k + 1 : 1]);
  }
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "saved" }).catch(() => {});
  return getPdfDocument(tx, { tenantId, instanceId });
}

/** The people a person can pick from (contacts), through the people port; typing a new one needs no port. */
export async function searchRecipients(tx, { q = "", limit = 8, selfId = null }) {
  const P = await ports();
  const { listTeammates } = await import("./teamRecipients.mjs");
  const mates = await listTeammates(tx, { q, limit: 6, selfId }).catch(() => []);                  // teammates first (21 Oct 2026), linked to the member record by id
  const saved = await searchContacts(tx, { q, limit }).catch(() => []);                  // People first: everyone this workspace has sent to
  const rows = P.people.search ? await P.people.search(tx, { q, limit }) : [];
  const seen = new Set([...mates, ...saved].map((c) => String(c.email).toLowerCase()));
  return [...mates, ...saved.filter((c) => !mates.some((m) => String(m.email).toLowerCase() === String(c.email).toLowerCase())), ...rows.filter((r) => r.email && !seen.has(String(r.email).toLowerCase())).map((r) => ({ id: r.id, name: r.display_name, email: r.email, role: r.role }))].slice(0, limit);
}

/** Delete a draft that was never sent (the shared Delete screen handles the rest). Removes its stored objects too. */
export async function deletePdfDraft(tx, { tenantId, instanceId }) {
  const i = await loadInstance(tx, instanceId);
  if (i.state !== "draft") throw conflict("only a draft that was never sent can be discarded — a sent document is voided instead");
  const files = (await tx.query(`SELECT storage_key FROM keystone.document_file WHERE instance_id = $1`, [instanceId])).rows;
  await tx.query(`DELETE FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const P = await ports();
  for (const f of files) await P.files.delete({ key: f.storage_key }).catch(() => {});
  return { deleted: true };
}

// ── templates ─────────────────────────────────────────────────────────────────────
/** The send choices a template remembers: how people are reminded, how long it lasts, what the email says, the language, the order, the check. */
const TEMPLATE_DEFAULT_KEYS = Object.freeze(["subject", "message", "expiry_days", "reminders", "verification", "order", "require_decline_reason", "language"]);
/**
 * "Save as a template" (23.4.9): the file, its seats and its fields, kept. The template holds its OWN copy of the pages. Returns {templateId}.
 * Fields keep their seats; people are not part of a template (a send picks who sits where).
 */
export async function savePdfTemplate(tx, { tenantId, instanceId, name = null, actorUserId = null, kind = "document", how = "saved", builtin = null }) {
  // Run 9 Part 4R: `builtin` = { slug, sha } — the library's own read-only master for this workspace (src/documents/library.mjs). It is not the workspace's new template: no cap, no ledger line,
  // no approval wait, no "template created" event. Only the library calls with it.
  if (!builtin) await beforeNewTemplate(tx, { tenantId });   // Run 8: every new template (Free: 5 a month), checked before anything is stored
  const i = await loadInstance(tx, instanceId);
  const body = parsePdfBodyData(i.template_body_snapshot ?? {});
  const P = await ports();
  const { bytes, row } = await readFileBytes(tx, { fileId: body.file.file_id });
  const templateId = randomUUID(), fileId = randomUUID();
  const stored = await P.files.put({ tenantId, id: fileId, bytes, contentType: "application/pdf" });
  const tplBody = { ...body, file: { ...body.file, file_id: fileId }, suggestions: undefined };
  delete tplBody.suggestions; delete tplBody.detect;
  // ★ §23.5.3 — the cadence and wording the sender chose travel with the template (never who it goes to, a secret, or one-off choices)
  const defaults = Object.fromEntries(Object.entries(i.send_options ?? {}).filter(([k]) => TEMPLATE_DEFAULT_KEYS.includes(k)));
  if (defaults.verification === "access_code") delete defaults.verification;
  const finalName = await uniqueTemplateName(tx, (builtin?.name || name || i.title).trim());   // a built-in master too: a workspace that already has its own "Services agreement" (an upload, a customized copy) must still be able to use the library's, so the master takes the next free name           // the (tenant, builder, name, version) key is unique: a second "Waiver" becomes "Waiver (2)"
  const approval = builtin ? "approved" : await startingApproval(tx, actorUserId);
  await tx.query(
    `INSERT INTO keystone.document_template (id, tenant_id, builder, name, version, active, body, type_id, send_defaults, approval_status, team_id, kind, collects_many, builtin_slug, builtin_sha)
     VALUES ($1,$2,'pdf',$3,1,true,$4::jsonb,(SELECT type_id FROM keystone.document_instance WHERE id = $5),$6::jsonb,$7,(SELECT team_id FROM keystone.document_instance WHERE id = $5),$8,$8 = 'form',$9,$10)`,
    [templateId, tenantId, finalName, JSON.stringify(tplBody), instanceId, Object.keys(defaults).length ? JSON.stringify(defaults) : null, approval, kind === "form" ? "form" : "document", builtin?.slug ?? null, builtin?.sha ?? null]);   // ★ Run 7: an uploaded PDF made into a FORM template says so
  await tx.query(
    `INSERT INTO keystone.document_file (id, tenant_id, template_id, kind, name, mime, byte_size, sha256, storage_key, page_count, pages, meta)
     VALUES ($1,$2,$3,'original',$4,'application/pdf',$5,$6,$7,$8,$9::jsonb,'{}'::jsonb)`,
    [fileId, tenantId, templateId, row.name, bytes.length, sha256Hex(bytes), stored.key, body.file.page_count, JSON.stringify(body.file.pages)]);
  if (!builtin) await afterNewTemplate(tx, { tenantId, templateId, kind, how, actorUserId });
  return { templateId };
}

/** Start a new draft from a pdf template: a copy of its pages and fields, no people yet. */
export async function createPdfFromTemplate(tx, { tenantId, templateId, actorUserId = null, title = null, subjectUserId = null, customValues = null }) {
  const { rows: [t] } = await tx.query(`SELECT id, name, builder, body, active, send_defaults, approval_status, team_id FROM keystone.document_template WHERE id = $1`, [templateId]);
  assertUsable(t);
  await assertTemplateVisible(tx, templateId);                  // retired, or waiting for approval, is refused for everyone who starts a document from a template (new, kiosk, bulk, the public link)
  const body = parsePdfBodyData(t.body);
  const { bytes } = await readFileBytes(tx, { fileId: body.file.file_id });
  const created = await createInstance(tx, { tenantId, builder: "pdf", title: (title && title.trim()) || t.name, templateId: null, subjectUserId, actorUserId, customValues });
  await tx.query(`UPDATE keystone.document_instance SET team_id = $2 WHERE id = $1`, [created.id, t.team_id ?? await defaultTeamFor(tx, actorUserId)]);   // a document starts in its template's team, else the maker's only team
  const P = await ports();
  const fileId = randomUUID();
  const stored = await P.files.put({ tenantId, id: fileId, bytes, contentType: "application/pdf" });
  await tx.query(
    `INSERT INTO keystone.document_file (id, tenant_id, instance_id, kind, name, mime, byte_size, sha256, storage_key, page_count, pages, meta, created_by)
     VALUES ($1,$2,$3,'original',$4,'application/pdf',$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
    [fileId, tenantId, created.id, body.file.name, bytes.length, sha256Hex(bytes), stored.key, body.file.page_count, JSON.stringify(body.file.pages), JSON.stringify({ from_template: templateId }), actorUserId]);
  const next = parsePdfBodyData({ ...body, file: { ...body.file, file_id: fileId } });
  const parsedDefaults = t.send_defaults ? sendOptionsSchema.safeParse(t.send_defaults) : null;
  await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, original_sha256 = $3, send_options = coalesce($4::jsonb, send_options) WHERE id = $1`, [created.id, JSON.stringify(next), sha256Hex(bytes), parsedDefaults?.success ? JSON.stringify(parsedDefaults.data) : null]);
  return { instanceId: created.id, title: created.title };
}

/**
 * Run 7 — SEND AGAIN. A document that was cancelled, declined or expired cannot be sent a second time (a sent record never changes), so this starts a NEW draft from it:
 * the same original file (never the stamped one), the same fields, people, message and send choices. The old document, its history and its dead links are left exactly as
 * they are. Left behind on purpose: an access code (only its hash was kept, so the sender types a new one), a scheduled time, each person's own expiry date (it is in the
 * past) and extra files (the sender attaches them again). A send of several documents is refused here: start each again on its own.
 */
export async function sendAgainPdf(tx, { tenantId, instanceId, actorUserId = null }) {
  const i = await loadInstance(tx, instanceId);
  const status = pdfStatus(i.state);
  if (!["voided", "declined", "expired"].includes(status)) throw conflict("Only a cancelled, declined or expired document can be sent again.");
  if ((await documentsOfSend(tx, { instanceId })).length > 1) throw conflict("This was sent with other documents. Start each one again on its own.");
  const body = parsePdfBodyData(i.template_body_snapshot ?? {});
  const { bytes, row } = await readFileBytes(tx, { fileId: body.file.file_id });
  const { rows: [more] } = await tx.query(`SELECT team_id, custom_values, is_test FROM keystone.document_instance WHERE id = $1`, [i.id]);
  const created = await createInstance(tx, { tenantId, builder: "pdf", title: i.title, templateId: null, subjectUserId: i.subject_user_id ?? null, actorUserId, customValues: more?.custom_values ?? null });
  await tx.query(
    `UPDATE keystone.document_instance SET team_id = $2, message = $3, description = $4, is_test = $5, source = $6::jsonb, source_facts = $7::jsonb, source_paper = $8, variable_values = $9::jsonb WHERE id = $1`,
    [created.id, more?.team_id ?? await defaultTeamFor(tx, actorUserId), i.message ?? null, i.description ?? null, Boolean(more?.is_test),
      i.source == null ? null : JSON.stringify(i.source), i.source_facts == null ? null : JSON.stringify(i.source_facts), i.source_paper ?? null, i.variable_values == null ? null : JSON.stringify(i.variable_values)]);
  const fileId = randomUUID();
  const stored = await (await ports()).files.put({ tenantId, id: fileId, bytes, contentType: "application/pdf" });
  await tx.query(
    `INSERT INTO keystone.document_file (id, tenant_id, instance_id, kind, name, mime, byte_size, sha256, storage_key, page_count, pages, meta, created_by)
     VALUES ($1,$2,$3,'original',$4,'application/pdf',$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
    [fileId, tenantId, created.id, row.name ?? body.file.name, bytes.length, sha256Hex(bytes), stored.key, body.file.page_count, JSON.stringify(body.file.pages), JSON.stringify({ sent_again_from: i.id }), actorUserId]);
  const next = parsePdfBodyData({ ...body, file: { ...body.file, file_id: fileId, sha256: sha256Hex(bytes) } });
  const { access_code_hash: _h, send_at: _at, attachments: _a, ...opts } = i.send_options ?? {};
  await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, original_sha256 = $3, send_options = $4::jsonb WHERE id = $1`, [created.id, JSON.stringify(next), sha256Hex(bytes), JSON.stringify(opts)]);
  const { rows: people } = await tx.query(
    `SELECT role, action_role, position, name, email, phone, external_ref, reminder_days, assists_role, group_label, witness_required FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [i.package_lead_id ?? i.id]);
  for (const p of people) {
    await tx.query(
      `INSERT INTO keystone.document_party (tenant_id, instance_id, role, action_role, position, name, email, phone, external_ref, reminder_days, assists_role, group_label, witness_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tenantId, created.id, p.role, p.action_role, p.position, p.name, p.email, p.phone, p.external_ref, p.reminder_days, p.assists_role, p.group_label, p.witness_required]);
  }
  await recordAuditEvent(tx, { tenantId, instanceId: created.id, kind: "saved" }).catch(() => {});
  return { instanceId: created.id, title: created.title, accessCodeNeeded: i.send_options?.verification === "access_code", attachmentsLeft: (i.send_options?.attachments ?? []).length };
}

export { leadOf };
