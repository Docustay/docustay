// src/documents/pdfSend.mjs — SENDING AN UPLOADED DOCUMENT AND WATCHING IT (QUEUE §23.4.6, §23.4.7, §23.4.15). Freeze the fields, give each person their own link, email them, and then: remind, fix a bounced
// address, change who a seat is, void, and the timeline the Track screen draws.
//
// ★ Each person's link is a `pdf_signature` link token issued to their `document_party` row — a person with no account can sign; the token names the party, never a the platform user.
// ★ The response never carries a link (idempotent replays would hand it back); the one exception is the staff-only "sign now on this device" route in routes/documentsPdf.mjs, declared as a credential-bearing response.
// ★ A package (several documents in one send) is sent from its LEAD: every member is frozen and sent together, the people live on the lead, each person gets ONE link and ONE email.
import { cleanName } from "./textSafety.mjs";
import { languageFor } from "./signerLanguage.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { mintLinkToken, revokeLinkTokenById } from "../auth/linkToken.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { ports } from "./ports.mjs";
import { sendSigningMail, recordInvitation } from "./emailIdentity.mjs";
import { sendVoidedNotices } from "./emailNotices.mjs";
import { resolveMessageTemplate } from "./variables.mjs";
import { parsePdfBodyData, freezePdfBody, checkPdfDraft, validateFieldValue } from "./pdfBody.mjs";
import { resolveBoxValues } from "./senderBoxes.mjs";
import { pdfStatus, actionsFor, can } from "./pdfFlow.mjs";
import { documentsOfSend } from "./parties.mjs";
import { savePdfTemplate, defaultExpiryDays, isFromTemplate } from "./pdfDocs.mjs";
import { getDocumentSetting, getDocumentSettings } from "./settings.mjs";
import { parseOrigins } from "./settingsSchema.mjs";
import { assertDocumentVisible, teamOf } from "./teams.mjs";
import { paymentsOfSend } from "./pdfPayments.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { reviewState, REVIEW_PROBLEM } from "./chat/review.mjs";
import { rememberParties } from "./contacts.mjs";

const DAY = 24 * 3600 * 1000;
const ACTION_OF = { signer: "sign", approver: "approve", viewer: "view", assistant: "assist" };
const PURPOSES = ["pdf_signature"];

async function loadLead(tx, instanceId, { lock = false } = {}) {
  const { rows: [i] } = await tx.query(
    `SELECT id, title, state, builder, message, template_body_snapshot, send_options, sent_at, expires_at, package_lead_id, custom_values, created_by, scheduled_send_at
       FROM keystone.document_instance WHERE id = $1 AND archived_at IS NULL${lock ? " FOR UPDATE" : ""}`, [instanceId]);
  if (!i) throw notFound("That document is not in this workspace.");
  if (i.builder !== "pdf") throw invalid("this is not an uploaded document", { code: "wrong_builder" });
  await assertDocumentVisible(tx, instanceId);
  if (i.package_lead_id) throw invalid("this document is part of a package — act on the package's first document", { code: "package_member" });
  return i;
}

async function partiesOf(tx, leadId) {
  const { rows } = await tx.query(`SELECT * FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [leadId]);
  return rows;
}

// ★ QUEUE §23.5.16 — roles. SIGNER and APPROVER block the next step; VIEWER and ASSISTANT act without blocking anyone; CC only receives the completed copy.
const BLOCKING_ROLES = Object.freeze(["signer", "approver"]);
const ACTING_NON_BLOCKING = Object.freeze(["viewer", "assistant"]);
export const isBlocking = (p) => BLOCKING_ROLES.includes(p.action_role ?? "signer");
/** Has this person done what their role asked? (a viewer is finished once they confirmed; everyone else by status) */
export function isFinished(p) {
  if (["signed", "approved", "rejected", "declined", "closed"].includes(p.status)) return true;   // closed: someone else in this person's signing group signed the seat (Run 9)
  return p.action_role === "viewer" && Boolean(p.completed_at);
}

/** The people who must act right now: signers and approvers at the lowest position that still has someone who has not finished — several people can share a position (a multi-person step). (Parallel = everyone is at position 1.) */
export function activeParties(parties) {
  const todo = parties.filter((p) => isBlocking(p) && !isFinished(p));
  if (!todo.length) return [];
  const pos = Math.min(...todo.map((p) => p.position));
  return todo.filter((p) => p.position === pos);
}
/** Viewers and assistants who have something to do and are not waiting on anyone (they are invited as soon as the document is sent). */
export const immediateParties = (parties) => parties.filter((p) => ACTING_NON_BLOCKING.includes(p.action_role) && !isFinished(p));
/** Is it this person's turn to act now? */
export const isActionable = (p, parties) => (isBlocking(p) ? activeParties(parties).some((x) => x.id === p.id) : ACTING_NON_BLOCKING.includes(p.action_role) && !isFinished(p));

/** Values for `{{signer.name}}`-style tokens in the subject and message of ONE person's email. */
async function tokenValues(tx, { tenantId, instance, party, senderName, orgName }) {
  const custom = instance.custom_values && typeof instance.custom_values === "object" ? instance.custom_values : {};
  return {
    "signer.name": party.name, "signer.first_name": String(party.name).split(/\s+/)[0], "signer.email": party.email ?? "",
    "sender.name": senderName, "org.name": orgName, "document.title": instance.title,
    ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [`custom.${k}`, String(v)])),
  };
}

/** What a box's starting value may name at send (senderBoxes.mjs): the organisation, the sender, this document and its custom values; signer.* per seat, from the first person on it. */
async function boxFacts(tx, { tenantId, instanceId, parties }) {
  const { rows: [i] } = await tx.query(`SELECT title, created_by, custom_values, send_options FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const P = await ports();
  const { practiceName } = await P.brand.get(tx, { tenantId });
  const sender = i?.created_by ? (await P.people.byIds(tx, [i.created_by]))[0] : null;
  const custom = i?.custom_values && typeof i.custom_values === "object" ? i.custom_values : {};
  const replyTo = String((await getDocumentSetting(tx, "email.reply_to")) ?? "").trim();
  const values = {
    "org.name": practiceName ?? "", "org.email": replyTo || (sender?.email ?? ""), "sender.name": i?.send_options?.sender_name || sender?.display_name || practiceName || "", "sender.email": sender?.email ?? "",
    "document.title": i?.title ?? "", ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [`custom.${k}`, v == null ? "" : String(v)])),
  };
  const seatValues = {};
  for (const p of parties) if (!seatValues[p.role]) seatValues[p.role] = { "signer.name": p.name ?? "", "signer.first_name": String(p.name ?? "").split(/\s+/)[0], "signer.email": p.email ?? "" };
  return { values, seatValues };
}

/** Run 9 (bulk preflight): what a send of THIS template to ONE row of a list would still lack, as plain sentences — the sender's own boxes with nothing to fill them (and a value that names
 *  something the send does not have). The same rule the send applies (resolveBoxValues), worked out without creating a draft, so "Check the list" says what the send will say. Nothing is written. */
/** R13-D364: who an activity line names. A group seat holds several people: an event that names its party (detail.party_id) names that person, an older event in a group seat names the one who signed for it, any other event names the seat's person. */
export function actorName(parties, e) {
  if (!e?.actor_role) return null;
  const byId = e.detail?.party_id ? parties.find((p) => p.id === e.detail.party_id) : null;
  if (byId) return byId.name ?? null;
  const seat = parties.filter((p) => p.role === e.actor_role);
  if (seat.length > 1) return (seat.find((p) => p.status === "signed") ?? seat[0]).name ?? null;
  return seat[0]?.name ?? null;
}

export async function templateBoxProblems(tx, { tenantId, actorUserId = null, body, seat, custom = {}, name = "", email = "" }) {
  const P = await ports();
  const { practiceName } = await P.brand.get(tx, { tenantId });
  const sender = actorUserId ? (await P.people.byIds(tx, [actorUserId]))[0] : null;
  const replyTo = String((await getDocumentSetting(tx, "email.reply_to")) ?? "").trim();
  const values = { "org.name": practiceName ?? "", "org.email": replyTo || (sender?.email ?? ""), "sender.name": sender?.display_name || practiceName || "", "sender.email": sender?.email ?? "", ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [`custom.${k}`, v == null ? "" : String(v)])) };
  const seatValues = { [seat]: { "signer.name": name, "signer.first_name": String(name).split(/\s+/)[0], "signer.email": email } };
  return resolveBoxValues(body, { values, seatValues }).problems.map((p) => p.text);
}

/** Mint a fresh sign link for one person (the old ones for that person are revoked first, so exactly one link is live per person per document). Returns {url, expiresAt}. */
// `keepLive`: how many of this person's newest unexpired links survive a new one. 0 for every emailed link (R2-3: a replaced link stops working); an EMBEDDED seat's
// one-hour session links keep the last few alive (R2-11: a page that loads twice, or two tabs, must not kill the session the person is already signing in).
export async function mintPartyLink(tx, { tenantId, leadId, party, ttlHours = null, keepLive = 0 }) {
  const { rows: old } = await tx.query(
    `SELECT id FROM keystone.link_token WHERE tenant_id = $1 AND subject_id = $2 AND issued_to = $3 AND purpose = ANY($4::text[]) AND redeemed_at IS NULL AND revoked_at IS NULL
      ORDER BY (expires_at > now()) DESC, expires_at DESC`,
    [tenantId, leadId, party.id, PURPOSES]);
  for (const o of old.slice(keepLive)) await revokeLinkTokenById(tx, o.id, "replaced by a newer link");
  const { rows: [i] } = await tx.query(`SELECT expires_at FROM keystone.document_instance WHERE id = $1`, [leadId]);
  const until = party.expires_at ?? i?.expires_at ?? null;
  const hours = ttlHours ?? (until ? Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 3600000)) : 24 * 90);
  const minted = await mintLinkToken(tx, { tenantId, purpose: "pdf_signature", subjectType: "document_instance", subjectId: leadId, issuedTo: party.id, ttlHours: Math.min(hours, 24 * 365) });
  const { publicBase } = await (await ports()).brand.get(tx, { tenantId });
  return { url: `${publicBase}/sign/pdf?t=${encodeURIComponent(minted.presented)}`, expiresAt: minted.expiresAt };
}

/** Email one person their link. In-person seats are never emailed. Returns the mail outcome (or null when nothing was sent). */
export async function emailParty(tx, { tenantId, leadId, party, isReminder = false, linkTtlHours = null, messageOverride = null }) {
  const { rows: [lead] } = await tx.query(`SELECT id, title, message, send_options, created_by, custom_values, is_test FROM keystone.document_instance WHERE id = $1`, [leadId]);
  const opts = lead.send_options ?? {};
  if ((opts.in_person ?? []).includes(party.role) || !party.email) return null;
  const P = await ports();
  const { practiceName, logoUrl } = await P.brand.get(tx, { tenantId });
  let senderName = practiceName;
  if (lead.created_by) { const [s] = await P.people.byIds(tx, [lead.created_by]); if (s?.display_name) senderName = s.display_name; }
  if (opts.sender_name) senderName = opts.sender_name;   // FP-K3: this document's own sender name
  const values = await tokenValues(tx, { tenantId, instance: lead, party, senderName, orgName: practiceName });
  const { url } = await mintPartyLink(tx, { tenantId, leadId, party, ttlHours: linkTtlHours });
  await tx.query(`UPDATE keystone.document_party SET invited_at = coalesce(invited_at, now()) WHERE id = $1`, [party.id]);
  // a test document mails only its sender, marked so nobody mistakes it for the real thing
  const testSender = lead.is_test && lead.created_by ? (await P.people.byIds(tx, [lead.created_by]))[0] : null;
  if (lead.is_test && !testSender?.email) return null;
  const outcome = await sendSigningMail(tx, {
    tenantId, to: lead.is_test ? testSender.email : party.email, practiceName, logoUrl, recipientName: party.name, documentTitle: lead.is_test ? `[TEST] ${lead.title}` : lead.title,
    message: resolveMessageTemplate(messageOverride ?? opts.message ?? lead.message ?? null, values), subject: opts.subject ? resolveMessageTemplate(opts.subject, values) : null,
    link: url, senderName, isReminder, replyTo: opts.reply_to ?? null, fromName: opts.sender_name ?? null, action: ACTION_OF[party.action_role] ?? "sign", language: (await languageFor(tx, { sendOptions: opts, party })).language, accent: (await getDocumentSetting(tx, "brand.accent")) || null,
    log: { instanceId: leadId, partyId: party.id, seat: party.role, kind: isReminder ? "reminder" : "invitation", isTest: lead.is_test === true },
  });
  await recordInvitation(tx, { tenantId, instanceId: leadId, to: party.email, providerMessageId: outcome.providerMessageId });
  return outcome;
}

// ── send ──────────────────────────────────────────────────────────────────────────
/** What stops this draft being sent, as plain sentences, WITHOUT sending anything (the assistant's "why can't I send this"). A document already sent says so. */
export async function sendBlockersFor(tx, { tenantId, instanceId, now = new Date() }) {
  const lead = await loadLead(tx, instanceId);
  if (!can(pdfStatus(lead.state), "SEND")) return { sendable: false, problems: [`This document is ${pdfStatus(lead.state)}, so it cannot be sent.`] };
  const members = await documentsOfSend(tx, { instanceId });
  const parties = await partiesOf(tx, lead.id);
  try { const { problems } = await collectSendProblems(tx, { tenantId, members, parties, opts: lead.send_options ?? {}, now }); return { sendable: problems.length === 0, problems }; }
  catch (e) { return { sendable: false, problems: [String(e?.message ?? "This document cannot be sent.")] }; }
}

/** Everything that stops a draft being sent, as plain sentences (the same checks the send makes; nothing is changed). Also returns the parsed bodies the send freezes. Used by the send and by the assistant's "why can't I send this" answer. */
async function collectSendProblems(tx, { tenantId, members, parties, opts, now = new Date() }) {
  const problems = [];
  const bodies = new Map();
  for (const m of members) {
    const { rows: [row] } = await tx.query(`SELECT template_body_snapshot, state, title FROM keystone.document_instance WHERE id = $1`, [m.id]);
    if (row.state !== "draft") throw conflict(`“${row.title}” has already been sent`);
    let body;
    try { body = parsePdfBodyData(row.template_body_snapshot); } catch (e) { problems.push(`“${row.title}”: ${e.message}`); continue; }
    // Run 9 (R8-57): every box's starting value worked out ({{org.name}}, {{signer.name}} …); a box the sender fills is frozen as its locked answer, and one that is still empty stops the send
    // (an empty sender box with nothing to work out is already a Check row, from checkPdfDraft below; here only a value that names something this send does not have)
    const resolved = resolveBoxValues(body, await boxFacts(tx, { tenantId, instanceId: m.id, parties }));
    for (const p of resolved.problems) if (String(body.fields.find((f) => f.id === p.id)?.default ?? "").trim()) problems.push(members.length > 1 ? `“${row.title}”: ${p.text}` : p.text);
    // the sender's own answer must be one the signer's page can accept (a date box holds a date): otherwise the box is locked with a value nobody can fix and the document can never be signed
    for (const f of resolved.body.fields) if (f.sender === true && typeof f.default === "string" && f.default.trim()) { const bad = validateFieldValue({ ...f, required: false }, f.default); if (bad) problems.push(`${members.length > 1 ? `“${row.title}”: ` : ""}“${f.label || f.id}” ${bad}`); }
    // R13-D305: the body as it will be frozen must still be the one permitted shape; a mismatch is a refusal in words here, not a 500 later when the sealed copy is made
    try { parsePdfBodyData(resolved.body); } catch (e) { problems.push(`“${row.title}”: ${e.message}`); continue; }
    bodies.set(m.id, resolved.body);
    if (body.fields.some((f) => f.type === "payment") && (await ports()).payments?.configured?.() && (await ports()).payments?.ready) {
      const st = (await (await ports()).payments.ready(tx, { tenantId })).status;
      if (st === "paused") problems.push(`“${row.title}” has a payment field, but payments are paused for this workspace. An Admin or Owner can turn them back on in Billing, Payments.`);
      else if (st !== "connected") problems.push(`“${row.title}” has a payment field, but Stripe is ${st === "needs_attention" ? "connected and needs attention (Stripe still needs information from you)" : "not connected for this workspace"}. Connect Stripe in Settings, or keep the payment terms as text only.`);
    }
    if (body.fields.some((f) => f.type === "payment") && !(await ports()).payments?.configured?.()) problems.push(`“${row.title}” has a payment field, but payments are not set up here (Stripe is not connected for this practice)`);
    // Part 30 item 11 — a Stripe price or payment link is looked up on the workspace's own Stripe account NOW, so a typo or an archived price stops the send instead of failing in front of the signer
    for (const f of body.fields.filter((x) => x.type === "payment" && (x.price_id || x.payment_link))) {
      const P = await ports();
      try { if (f.price_id) await P.payments.priceInfo(tx, { tenantId, priceId: f.price_id }); else await P.payments.linkInfo(tx, { tenantId, url: f.payment_link }); }
      catch (e) { problems.push(`“${row.title}”: the payment “${f.label || "payment"}” — ${e.message}`); }
    }
    // R13-D372: judged on the body as it will be sent, with the sender's boxes already filled from this send's values (custom.<key>); judging the unfilled body refused a send whose values were given
    const check = checkPdfDraft(resolved.body, parties.map((p) => ({ ...p, in_person: (opts.in_person ?? []).includes(p.role) })), { order: opts.order ?? null });
    for (const it of check.items) if (!it.ok && it.severity !== "warning") problems.push(members.length > 1 ? `“${row.title}”: ${it.text}` : it.text);
    if (body.file && (await tx.query(`SELECT 1 FROM keystone.document_file WHERE id = $1 AND (meta->>'already_signed') = 'true'`, [body.file.file_id])).rowCount && body.fields.length) problems.push(`“${row.title}” already carries a digital signature; fields cannot be placed on it`);
    // Run 9: the rule-order check (decision 6) is part of checkPdfDraft above, so Check and Send say the same thing
  }
  // Run 9 — signing groups (Pro): everyone in the group is emailed their own link, so each needs an address; a group seat cannot sign on this device
  const groups = new Map();
  for (const p of parties.filter((x) => x.group_label)) { if (!groups.has(p.role)) groups.set(p.role, []); groups.get(p.role).push(p); }
  if (groups.size) {
    try { await (await ports()).entitlements?.assertEntitled?.(tx, { tenantId, item: "signing_groups" }); } catch (e) { problems.push(e.message); }
    for (const [role, ps] of groups) {
      if ((opts.in_person ?? []).includes(role) || (opts.embedded ?? []).includes(role)) problems.push(`The signing group “${ps[0].group_label}” cannot sign on this device or inside your app: each person in it gets their own link`);
      for (const p of ps) if (!p.email) problems.push(`${p.name} is in the signing group “${p.group_label}” and needs an email address for their link`);
    }
  }
  for (const p of parties) if (p.expires_at && new Date(p.expires_at) <= now) problems.push(`${p.name}'s deadline has already passed — choose a later date`);
  if (opts.verification === "access_code" && !opts.access_code_hash) problems.push("You chose an access code but have not set one");
  if (opts.verification === "email_code") for (const p of parties.filter((x) => x.action_role === "signer" && !(opts.in_person ?? []).includes(x.role) && !x.email)) problems.push(`${p.name} has no email, so an email code cannot reach them`);
  if (!parties.length) problems.push("Nobody is set to sign — add at least one person");
  for (const m of members) if ((await reviewState(tx, { instanceId: m.id }).catch(() => ({ needed: true })))?.needed) { problems.push(REVIEW_PROBLEM); break; }
  return { problems, bodies };
}

/** What a member of the public is told when the organisation behind a public form or link cannot take another document right now (its plan, not their problem). */
export const VISITOR_UNAVAILABLE = "This form can't take responses right now. Please try again later, or contact the organisation that shared it.";
export async function sendPdfDocument(tx, { tenantId, instanceId, actorUserId = null, now = new Date(), forVisitor = false }) {
  const lead = await loadLead(tx, instanceId, { lock: true });   // Round 3 R-1: two sends at once (double click, retry) wait for each other, and the second finds it already sent instead of mailing everyone twice
  if (!can(pdfStatus(lead.state), "SEND")) throw conflict(`this document is ${pdfStatus(lead.state)} and cannot be sent`);
  const members = await documentsOfSend(tx, { instanceId });
  const parties = await partiesOf(tx, lead.id);
  const opts = lead.send_options ?? {};
  // Part 30 item 8 — TEST MODE: a send made with a test API key, or while the workspace's test switch is on, is a practice run. It mails only its sender, is stamped TEST, and is never counted.
  // Run 7: a stranger filling in a public form is never a practice run — the workspace's test switch is the sender's own; a response from the public is real (and counted)
  const isTest = opts.test === true || (!forVisitor && (await getDocumentSetting(tx, "test_mode.on")) === true);
  if (isTest) {
    const sender = lead.created_by ? (await (await ports()).people.byIds(tx, [lead.created_by]))[0] : null;
    if (!sender?.email) throw invalid("A test document is emailed only to its sender, and the sender has no email address on file.", { code: "test_needs_sender_email" });
  } else {
    // the host's plan may refuse a send (optional port); practice runs are never counted
    // D-051: an email goes out only to someone who is not signing on this device
    const onDevice = new Set(opts.in_person ?? []);
    const needsEmail = parties.some((p) => p.email && !onDevice.has(p.role));
    try { await (await ports()).entitlements?.assertMaySend?.(tx, { tenantId, needsEmail, recipients: forVisitor ? null : parties.map((p) => p.email).filter(Boolean) }); }   // a stranger filling in a public form is not a signer the workspace chose, so the Free signers allowance does not count them
    catch (e) {
      // D-072: a stranger filling in a public form is not the owner — they must not be told about the owner's plan or sent to "upgrade". The owner already gets the usage notices.
      if (forVisitor) throw conflict(VISITOR_UNAVAILABLE, { code: "form_unavailable" });
      throw e;
    }
  }

  // every document must pass the same checks the screen showed
  const { problems, bodies } = await collectSendProblems(tx, { tenantId, members, parties, opts, now });
  if (problems.length) throw invalid(problems[0], { code: "not_ready", problems });
  if (!isTest) await rememberParties(tx, { tenantId, parties });   // People: everyone this goes to is saved (name, address, last activity); a practice run saves nobody

  // scheduled send: record it and stop — the worker's sweep sends it when it is due
  if (opts.send_at && new Date(opts.send_at).getTime() > now.getTime() + 60_000) {
    await tx.query(`UPDATE keystone.document_instance SET scheduled_send_at = $2 WHERE id = $1`, [lead.id, opts.send_at]);
    await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "scheduled", detail: { send_at: opts.send_at } });
    return { id: lead.id, state: "draft", scheduled: true, sendAt: opts.send_at, emailed: 0 };
  }

  if (isTest) await tx.query(`UPDATE keystone.document_instance SET is_test = true WHERE id = ANY($1::uuid[])`, [members.map((m) => m.id)]);
  const settings = await getDocumentSettings(tx);
  // R13-D010: with no deadline chosen for THIS send, a document made from a template takes the workspace's "signature request expires after N days" (0 = never) and an upload takes "uploaded documents expire after N days" — the same value the Send step showed. A deadline the sender chose wins over both.
  const expiryDays = opts.expiry_days === undefined ? defaultExpiryDays(settings, { fromTemplate: await isFromTemplate(tx, lead.id) }) : opts.expiry_days;
  const remindersOn = opts.reminders?.on !== false;
  const firstReminder = (opts.reminders?.days ?? settings.reminder_days)?.[0] ?? 3;
  for (const m of members) {
    const frozen = freezePdfBody(bodies.get(m.id));
    await tx.query(
      `UPDATE keystone.document_instance
          SET state = 'sent', sent_at = now(), template_body_snapshot = $2::jsonb, scheduled_send_at = NULL, updated_at = now(),
              expires_at = CASE WHEN $3::int > 0 THEN now() + make_interval(days => $3::int) ELSE NULL END,
              next_reminder_at = CASE WHEN $4 THEN now() + make_interval(days => $5::int) ELSE NULL END
        WHERE id = $1 AND state = 'draft'`,
      [m.id, JSON.stringify(frozen), expiryDays ?? 0, remindersOn, firstReminder]);
    await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "sent", detail: { sha256: frozen.file.sha256, pages: frozen.file.page_count, fields: frozen.fields.length } });
    // remember this form: the next upload of the same printed form comes up with the fields this one was sent with (never blocks a send)
    await tx.query("SAVEPOINT remember_layout");
    try {
      const { rows: [fm] } = await tx.query(`SELECT meta->'fingerprint' AS fp FROM keystone.document_file WHERE id = $1`, [frozen.file.file_id]);
      if (fm?.fp && frozen.fields.length) { const { rememberLayout } = await import("./detect/remember.mjs"); await rememberLayout(tx, { tenantId, pages: fm.fp, name: m.title, fields: frozen.fields, roles: frozen.roles, actorUserId }); }
      await tx.query("RELEASE SAVEPOINT remember_layout");
    } catch { await tx.query("ROLLBACK TO SAVEPOINT remember_layout"); }
    if (!isTest) await (await ports()).entitlements?.noteDocumentSent?.(tx, { tenantId, instanceId: m.id });   // usage billing: one billable unit when this document is past the plan's included amount (never a practice run)
    await emit(tx, {
      tenantId, topic: "documents.document.sent", emittedBy: "documents", subjectType: "document", subjectId: m.id,
      actor: userActor(actorUserId), payload: { builder: "pdf", state: "sent", sent_by: actorUserId ?? lead.created_by ?? null, test: isTest },
    });
  }
  await tx.query(`UPDATE keystone.document_party SET status = 'pending', updated_at = now() WHERE instance_id = $1 AND status = 'bounced'`, [lead.id]);
  // ★ §23.5.17 — the document's own end date is the LATEST of everyone's, so the whole-document sweep never lapses a send while someone still has time
  await tx.query(`UPDATE keystone.document_instance i SET expires_at = GREATEST(coalesce(i.expires_at, '-infinity'::timestamptz), (SELECT max(p.expires_at) FROM keystone.document_party p WHERE p.instance_id = $1)) WHERE (i.id = $1 OR i.package_lead_id = $1) AND EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = $1 AND p.expires_at IS NOT NULL) AND (i.expires_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = $1 AND p.expires_at IS NULL AND p.action_role IN ('signer','approver')))`, [lead.id]);

  let emailed = 0; const notEmailed = [];
  const everyone = await partiesOf(tx, lead.id);
  const due = [...activeParties(everyone), ...immediateParties(everyone)];
  for (const p of due) {
    const outcome = await emailParty(tx, { tenantId, leadId: lead.id, party: p });
    if (p.external_ref) { const { notifyTeammate } = await import("./teamRecipients.mjs"); const { createNotification } = await import("../notifications/writes.mjs"); await notifyTeammate(tx, { tenantId, leadId: lead.id, party: p, createNotification }); }   // a teammate also gets a notice in the app
    if (outcome?.status === "sent") emailed += 1;
    else if (outcome) notEmailed.push({ seat: p.role, email: p.email, reason: outcome.status, detail: outcome.error ?? null });   // never silent: the caller learns who was not mailed and why
  }
  await refreshNextReminder(tx, lead.id);
  // people who only receive a copy at the end are not emailed now
  let templateId = null, templateNotKept = null;
  // Run 8: "also keep this as a template" makes a NEW template (Free: 5 a month). At the cap the SEND still goes out — the template is simply not kept, and the answer says why (the cap's
  // refusal is raised by a plain check before anything is written, so the transaction is still good).
  if ((opts.save_as_template === undefined ? settings["upload.save_as_template"] : opts.save_as_template) && members.length === 1) {
    try { templateId = (await savePdfTemplate(tx, { tenantId, instanceId: lead.id, actorUserId, how: "kept_on_send" })).templateId; }
    catch (e) { if (e?.detail?.code !== "plan_template_limit") throw e; templateNotKept = { code: e.detail.code, message: e.message, used: e.detail.used, limit: e.detail.limit, resetsAt: e.detail.resetsAt }; }
  }
  const { rows: [after] } = await tx.query(`SELECT sent_at, expires_at FROM keystone.document_instance WHERE id = $1`, [lead.id]);
  return { id: lead.id, state: "sent", scheduled: false, sentAt: after.sent_at, expiresAt: after.expires_at, emailed, notEmailed, documents: members.length, templateId, ...(templateNotKept ? { templateNotKept } : {}) };
}

// ── the sender's own test ───────────────────────────────────────────────────────────
/** "Send me a test" — emails the SENDER a link that shows the document exactly as the first signer will see it, and records nothing. */
export async function sendTestToSender(tx, { tenantId, instanceId, actorUserId, to }) {
  const lead = await loadLead(tx, instanceId);
  if (lead.state !== "draft") throw conflict("a test can only be sent from a draft");
  const P = await ports();
  const [me] = actorUserId ? await P.people.byIds(tx, [actorUserId]) : [];
  const email = to || me?.email;
  if (!email) throw invalid("there is no email address to send the test to", { field: "to" });
  const minted = await mintLinkToken(tx, { tenantId, purpose: "pdf_test", subjectType: "document_instance", subjectId: lead.id, issuedTo: actorUserId ?? null, ttlHours: 24 });
  const { practiceName, logoUrl, publicBase } = await P.brand.get(tx, { tenantId });
  // the test looks like the real invitation to the FIRST person: their language, the subject and the message the sender wrote (merge fields filled in for that person)
  const opts = lead.send_options ?? {}, everyone = await partiesOf(tx, lead.id);
  const first = [...activeParties(everyone), ...immediateParties(everyone)][0] ?? everyone[0] ?? null;
  const senderName = opts.sender_name || me?.display_name || practiceName;
  const values = first ? await tokenValues(tx, { tenantId, instance: lead, party: first, senderName, orgName: practiceName }) : null;
  const written = values ? resolveMessageTemplate(opts.message ?? lead.message ?? null, values) : null;
  const outcome = await sendSigningMail(tx, {
    tenantId, to: email, practiceName, logoUrl, recipientName: first?.name || me?.display_name || "", documentTitle: `[Test] ${lead.title}`,
    message: written || "This is a test of how your document looks to the person signing it. Nothing you do on that page is recorded.",
    subject: values && opts.subject ? `[Test] ${resolveMessageTemplate(opts.subject, values)}` : null,
    link: `${publicBase}/sign/pdf?t=${encodeURIComponent(minted.presented)}`, senderName,
    ...(first ? { language: (await languageFor(tx, { sendOptions: opts, party: first })).language } : {}),
  });
  await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "test_sent" });
  return { sent: outcome.status === "sent", status: outcome.status, to: email };
}

// ── after the send ────────────────────────────────────────────────────────────────
async function mustBeLive(tx, leadId) {
  const lead = await loadLead(tx, leadId, { lock: true });
  if (!["sent", "partially_signed"].includes(lead.state)) throw conflict(`this document is ${pdfStatus(lead.state)}, so there is nothing left to do on it`);
  return lead;
}

// ── reminders on each person's own cadence (QUEUE §23.5.17) ───────────────────────────────────────────────────
/** A person's reminder offsets, in days after they were invited: their own, else the send's, else the practice's; none when reminders are off. */
function cadenceOf(p, opts, settings) {
  if (opts.reminders?.on === false) return [];
  return p.reminder_days?.length ? p.reminder_days : (opts.reminders?.days ?? settings.reminder_days ?? []);
}
const reachable = (p, opts) => Boolean(p.email) && !(opts.in_person ?? []).includes(p.role) && !(p.expires_at && new Date(p.expires_at) <= new Date());
const dueAt = (p, opts, settings) => { const d = cadenceOf(p, opts, settings)[p.reminders_sent ?? 0]; return d == null || !p.invited_at ? null : new Date(new Date(p.invited_at).getTime() + d * DAY); };

/** When the next reminder (to anyone) is due, or null when nobody has one left. Keeps the send's `next_reminder_at` — the thing the sweep looks at — true to every person's own cadence. */
export async function nextReminderAt(tx, leadId) {
  const lead = await loadLead(tx, leadId);
  const parties = await partiesOf(tx, leadId);
  const settings = await getDocumentSettings(tx);
  let best = null;
  for (const p of parties) {
    if (!isActionable(p, parties) || !reachable(p, lead.send_options ?? {})) continue;
    const at = dueAt(p, lead.send_options ?? {}, settings);
    if (at && (!best || at < best)) best = at;
  }
  return best;
}
async function refreshNextReminder(tx, leadId) {
  const at = await nextReminderAt(tx, leadId);
  await tx.query(`UPDATE keystone.document_instance SET next_reminder_at = $2 WHERE id = $1 OR package_lead_id = $1`, [leadId, at]);
  return at;
}

/** The sweep's own call: remind each person whose own next offset has come (and only them), then re-aim the send's next reminder. → {reminded} */
export async function remindDueParties(tx, { tenantId, instanceId }) {
  const lead = await mustBeLive(tx, instanceId);
  const parties = await partiesOf(tx, lead.id);
  const opts = lead.send_options ?? {};
  const settings = await getDocumentSettings(tx);
  let reminded = 0;
  for (const p of parties) {
    if (!isActionable(p, parties) || !reachable(p, opts)) continue;
    const at = dueAt(p, opts, settings);
    if (!at || at > new Date()) continue;
    const o = await emailParty(tx, { tenantId, leadId: lead.id, party: p, isReminder: true });
    await tx.query(`UPDATE keystone.document_party SET reminders_sent = reminders_sent + 1, last_reminded_at = now() WHERE id = $1`, [p.id]);
    await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "reminded", actorRole: p.role });
    if (o?.status === "sent") reminded += 1;
  }
  await refreshNextReminder(tx, lead.id);
  return { reminded };
}

/** "Remind now": a fresh link and email to everyone who must act now (or one chosen person). */
export async function remindPdfParties(tx, { tenantId, instanceId, partyId = null, message = null }) {   // Run 9: `message` — this reminder's own words (Scribe's "Change the message"); the document's message otherwise
  const lead = await mustBeLive(tx, instanceId);
  const everyone = await partiesOf(tx, lead.id);
  let targets = [...activeParties(everyone), ...immediateParties(everyone)];
  if (partyId) targets = targets.filter((p) => p.id === partyId);
  if (!targets.length) throw conflict(partyId ? "that person has no reminder to send — they have finished or are not up yet" : "nobody is waiting to be reminded");
  let sent = 0;
  for (const p of targets) {
    const o = await emailParty(tx, { tenantId, leadId: lead.id, party: p, isReminder: true, messageOverride: message });
    if (o?.status === "sent") sent += 1;
    await tx.query(`UPDATE keystone.document_party SET reminders_sent = reminders_sent + 1, last_reminded_at = now() WHERE id = $1`, [p.id]);
    await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "reminded", actorRole: p.role });
  }
  await tx.query(`UPDATE keystone.document_instance SET reminders_sent = LEAST(reminders_sent + 1, 10) WHERE id = $1`, [lead.id]);
  return { reminded: targets.length, sent };
}

/** Run 9 (Scribe "set reminders", Pro through the card): the automatic reminders of a draft or of a document out for signature — after these days (1–60, at most 3), or none. A live send's next reminder is
 *  re-aimed at once. Whether they then go out is still the plan's (`auto_reminders`, checked by the sweep). → { id, reminders } */
export async function setDocumentReminders(tx, { tenantId, instanceId, days }) {
  void tenantId;
  const lead = await loadLead(tx, instanceId, { lock: true });
  if (!["draft", "sent", "partially_signed"].includes(lead.state)) throw conflict(`this document is ${pdfStatus(lead.state)}, so its reminders cannot change`);
  const list = [...new Set((Array.isArray(days) ? days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 60).sort((a, b) => a - b);
  if ((Array.isArray(days) ? days.length : 0) !== list.length || list.length > 3) throw invalid("reminders are up to 3 different whole days between 1 and 60", { field: "days" });
  const reminders = { on: list.length > 0, days: list };
  await tx.query(`UPDATE keystone.document_instance SET send_options = coalesce(send_options, '{}'::jsonb) || jsonb_build_object('reminders', $2::jsonb), updated_at = now() WHERE id = $1 OR package_lead_id = $1`, [lead.id, JSON.stringify(reminders)]);
  if (lead.state !== "draft") await refreshNextReminder(tx, lead.id);
  return { id: lead.id, reminders };
}

/** "Sign now on this device": a fresh link for a person marked as signing in person (no email involved). Returned under the key `presented` so an idempotent replay never hands the credential back twice. */
export async function signNowLink(tx, { tenantId, instanceId, partyId }) {
  const lead = await mustBeLive(tx, instanceId);
  const { rows: [p] } = await tx.query(`SELECT * FROM keystone.document_party WHERE id = $1 AND instance_id = $2`, [partyId, lead.id]);
  if (!p) throw notFound("no such person on this document");
  if (!(lead.send_options?.in_person ?? []).includes(p.role)) throw conflict(`${p.name} is not set to sign on this device`);
  if (!isActionable(p, await partiesOf(tx, lead.id))) throw conflict("it is not this person's turn yet");
  const { url } = await mintPartyLink(tx, { tenantId, leadId: lead.id, party: p, ttlHours: 2 });
  await tx.query(`UPDATE keystone.document_party SET invited_at = coalesce(invited_at, now()) WHERE id = $1`, [partyId]);
  return { presented: url };
}

/** Part 30 item 4 — the websites an organisation allows to frame a signing form (island setting `embed.allowed_origins`), as a clean list. */
async function embedAllowedOrigins(tx) { return parseOrigins((await getDocumentSettings(tx))["embed.allowed_origins"]); }

/** The website a session is for, if the organisation listed it (the same list that decides who may frame a signing form). Throws the plain-words refusal otherwise. */
export async function assertEmbedOrigin(tx, origin) {
  const allowed = await embedAllowedOrigins(tx);
  const o = String(origin ?? "").trim().replace(/\/+$/, "");
  if (!allowed.length) throw conflict("embedding is off: add your website under Settings → Developers → Embedding");
  if (!allowed.includes(o)) throw conflict(`${o || "that origin"} is not on the list of websites allowed to show an embedded Docustay screen`);
  return o;
}

/** A one-hour session link for an EMBEDDED seat, to be shown in a frame on `origin`. Only seats the sender marked `embedded` when sending, and only an origin the organisation listed. The link carries `embed=1` and the parent origin so the form can talk back to that one site and no other. */
const EMBED_LIVE_SESSIONS = 5;
export async function embedSessionLink(tx, { tenantId, instanceId, seat, origin }) {
  const lead = await mustBeLive(tx, instanceId);
  if (!(lead.send_options?.embedded ?? []).includes(seat)) throw conflict(`seat “${seat}” was not sent as an embedded seat`);
  const allowed = await embedAllowedOrigins(tx);
  const o = String(origin ?? "").trim().replace(/\/+$/, "");
  if (!allowed.length) throw conflict("embedding is off: add your website under Settings → Developers → Embedding");
  if (!allowed.includes(o)) throw conflict(`${o || "that origin"} is not on the list of websites allowed to show a signing form`);
  const parties = await partiesOf(tx, lead.id);
  const p = parties.find((x) => x.role === seat);
  if (!p) throw notFound(`no such seat: ${seat}`);
  if (!isActionable(p, parties)) throw conflict("it is not this person's turn yet");
  const { url, expiresAt } = await mintPartyLink(tx, { tenantId, leadId: lead.id, party: p, ttlHours: 1, keepLive: EMBED_LIVE_SESSIONS - 1 });
  await tx.query(`UPDATE keystone.document_party SET invited_at = coalesce(invited_at, now()) WHERE id = $1`, [p.id]);
  await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "embed_session", actorRole: p.role, detail: { origin: o } });
  return { url: `${url}&embed=1&parent=${encodeURIComponent(o)}`, expiresAt };
}

/** The origins a signing form may be framed by, for ONE person's link: empty unless their seat is embedded (so an ordinary emailed link can never be framed anywhere). */
export async function embedOriginsForParty(tx, { leadId, partyId }) {
  const { rows: [r] } = await tx.query(`SELECT d.send_options, d.tenant_id, p.role FROM keystone.document_instance d JOIN keystone.document_party p ON p.instance_id = d.id WHERE d.id = $1 AND p.id = $2`, [leadId, partyId]);
  if (!r) return [];
  if (!(r.send_options?.embedded ?? []).includes(r.role)) return [];
  return embedAllowedOrigins(tx);
}

/** Give one person more time: a new deadline (days from now, or a date), a fresh link emailed to them if it is their turn, and the document's own end date moved out if theirs is now the latest. Anyone who has finished cannot be extended. */
export async function extendParty(tx, { tenantId, instanceId, partyId, days = null, expiresAt = null }) {
  const lead = await mustBeLive(tx, instanceId);
  const parties = await partiesOf(tx, lead.id);
  const p = parties.find((x) => x.id === partyId);
  if (!p) throw notFound("no such person on this document");
  if (isFinished(p)) throw conflict(`${p.name} has already finished, so there is nothing to extend`);
  const until = expiresAt ? new Date(expiresAt) : days ? new Date(Date.now() + Number(days) * DAY) : null;
  if (!until || Number.isNaN(until.getTime()) || until <= new Date()) throw invalid("choose a deadline in the future", { field: "days" });
  if (until.getTime() > Date.now() + 366 * DAY) throw invalid("a deadline can be at most a year away", { field: "days" });
  await tx.query(`UPDATE keystone.document_party SET expires_at = $2, updated_at = now() WHERE id = $1`, [p.id, until]);
  await tx.query(`UPDATE keystone.document_instance SET expires_at = GREATEST(coalesce(expires_at, '-infinity'::timestamptz), $2), updated_at = now() WHERE id = $1 OR package_lead_id = $1`, [lead.id, until]);
  const fresh = { ...p, expires_at: until };
  let emailed = false;
  if (isActionable(fresh, parties) && p.action_role !== "cc") {
    const o = await emailParty(tx, { tenantId, leadId: lead.id, party: fresh });
    emailed = o?.status === "sent";
  }
  await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "link_reissued", actorRole: p.role, detail: { extended_to: until.toISOString() } });
  await refreshNextReminder(tx, lead.id);
  return { extended: true, expiresAt: until, emailed };
}

/** Fix a bounced (or wrong) address, or hand a seat to someone else: updates who the seat is, retires the old link, emails the new person. A person who has already signed cannot be changed. */
export async function reassignParty(tx, { tenantId, instanceId, partyId, name = null, email = null }) {
  const lead = await mustBeLive(tx, instanceId);
  const { rows: [p] } = await tx.query(`SELECT * FROM keystone.document_party WHERE id = $1 AND instance_id = $2`, [partyId, lead.id]);
  if (!p) throw notFound("no such person on this document");
  if (["signed", "declined"].includes(p.status)) throw conflict(`${p.name} has already ${p.status === "signed" ? "signed" : "declined"} — their part cannot be reassigned`);
  if (email !== null && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) throw invalid(`“${email}” is not an email address`, { field: "email" });
  const nextName = cleanName(name ?? p.name), nextEmail = email ?? p.email;
  await tx.query(`UPDATE keystone.document_party SET name = $2, email = $3, status = 'pending', email_delivery = NULL, email_message_id = NULL, viewed_at = NULL, progress = NULL, updated_at = now() WHERE id = $1`, [partyId, nextName, nextEmail]);
  const changedPerson = nextName !== p.name || (nextEmail ?? "").toLowerCase() !== (p.email ?? "").toLowerCase();
  await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: changedPerson ? "reassigned" : "link_reissued", actorRole: p.role });
  const fresh = { ...p, name: nextName, email: nextEmail, status: "pending" };
  let outcome = null;
  if (activeParties(await partiesOf(tx, lead.id)).some((x) => x.id === partyId)) outcome = await emailParty(tx, { tenantId, leadId: lead.id, party: fresh });
  return { partyId, name: nextName, email: nextEmail, emailed: outcome?.status === "sent" };
}

/** Void a sent document: nobody can sign it any more, every outstanding link is revoked, and the reason is kept. A signed document cannot be voided — it is a record. */
export async function voidPdfDocument(tx, { tenantId, instanceId, reason = null, actorUserId = null }) {
  const lead = await mustBeLive(tx, instanceId);
  const members = await documentsOfSend(tx, { instanceId: lead.id });
  const { rows: [signed] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.signature_record WHERE instance_id = ANY($1::uuid[])`, [members.map((m) => m.id)]);
  const text = (reason ?? "").trim().slice(0, 500) || null;
  for (const m of members) {
    await tx.query(`UPDATE keystone.document_instance SET state = 'void', voided_at = now(), void_reason = $2, next_reminder_at = NULL, updated_at = now() WHERE id = $1 AND state IN ('sent','partially_signed')`, [m.id, text]);
    await recordAuditEvent(tx, { tenantId, instanceId: m.id, kind: "voided" });
  }
  const { rows: tokens } = await tx.query(
    `SELECT id FROM keystone.link_token WHERE tenant_id = $1 AND subject_id = $2 AND purpose = ANY($3::text[]) AND redeemed_at IS NULL AND revoked_at IS NULL`, [tenantId, lead.id, PURPOSES]);
  for (const t of tokens) await revokeLinkTokenById(tx, t.id, "document voided");
  await emit(tx, { tenantId, topic: "documents.document.voided", emittedBy: "documents", subjectType: "document", subjectId: lead.id, actor: userActor(actorUserId), payload: { builder: "pdf", signatures_before_void: signed.n } });
  const notified = await sendVoidedNotices(tx, { tenantId, leadId: lead.id, reason: text, actorUserId });   // FP-K1: the people who were asked to sign are told, in the workspace's own wording
  return { id: lead.id, state: "void", revokedLinks: tokens.length, notified };
}

/** After a person finishes: wake the next position (sequential order) with their link and email. Returns how many were emailed. */
export async function advanceSequence(tx, { tenantId, leadId }) {
  const parties = await partiesOf(tx, leadId);
  const due = activeParties(parties).filter((p) => !p.invited_at);       // viewers and assistants were invited at send
  let n = 0;
  for (const p of due) { const o = await emailParty(tx, { tenantId, leadId, party: p }); if (p.external_ref) { const { notifyTeammate } = await import("./teamRecipients.mjs"); const { createNotification } = await import("../notifications/writes.mjs"); await notifyTeammate(tx, { tenantId, leadId, party: p, createNotification }); } if (o?.status === "sent") n += 1; }
  await refreshNextReminder(tx, leadId);
  return n;
}

// ── Track ──────────────────────────────────────────────────────────────────────────
const KIND_TEXT = {
  uploaded: "Uploaded", scheduled: "Send scheduled", sent: "Sent for signature", delivered: "Email delivered", opened: "Opened", viewed: "Viewed", link_clicked: "Opened the link", consented: "Agreed to sign electronically",
  signed: "Signed", approved: "Approved", rejected: "Rejected the document", acknowledged: "Confirmed they viewed it", assisted: "Filled in details", declined: "Declined", executed: "Completed — everyone has signed", reminded: "Reminder sent", voided: "Cancelled", reassigned: "Changed who signs", link_reissued: "New link sent", expired: "Expired",
  delegated: "Passed their part to someone else", downloaded: "Downloaded the signed copy", embed_session: "Opened signing inside another website",
  seal_untimestamped: "Sealed without a trusted timestamp (the timestamp service did not answer)", seal_restamped: "A trusted timestamp was added to the sealed copy afterwards",
  bounced: "Email bounced", erased: "Personal details removed on request", complained: "Reported as spam", changes_requested: "Asked for changes", test_sent: "Test sent to the sender", saved: "Saved", verified: "Identity checked",
  hidden_by_rule: "Left out by a rule", witnessed: "Witnessed", group_closed: "The others in the group no longer need to sign",   // Run 9
  held_for_payment: "Signed; the signature is kept while they pay", hold_lapsed: "The kept signature lapsed (not paid within 7 days)", paid: "Paid", refunded: "Refunded", disputed: "Payment disputed",   // Run 9 Part 3.7
};

export async function trackPdfDocument(tx, { tenantId, instanceId }) {
  const { rows: [i] } = await tx.query(
    `SELECT id, title, state, builder, sent_at, expires_at, executed_at, voided_at, void_reason, package_lead_id, scheduled_send_at, send_options FROM keystone.document_instance WHERE id = $1 AND archived_at IS NULL`, [instanceId]);
  if (!i || i.builder !== "pdf") throw notFound("That document is not in this workspace.");
  await assertDocumentVisible(tx, instanceId);
  const leadId = i.package_lead_id ?? i.id;
  const parties = await partiesOf(tx, leadId);
  const members = await documentsOfSend(tx, { instanceId: leadId });
  const memberIds = members.map((m) => m.id);
  const status = pdfStatus(i.state);
  const { rows: events } = await tx.query(
    `SELECT e.kind, e.actor_role, e.occurred_at, e.detail, e.instance_id FROM keystone.document_audit_event e WHERE e.instance_id = ANY($1::uuid[]) AND e.kind <> 'saved' ORDER BY date_trunc('second', e.occurred_at), CASE e.kind WHEN 'uploaded' THEN 0 WHEN 'sent' THEN 2 WHEN 'embed_session' THEN 3 WHEN 'opened' THEN 4 WHEN 'reminded' THEN 5 WHEN 'consented' THEN 6 WHEN 'signed' THEN 7 WHEN 'executed' THEN 8 WHEN 'voided' THEN 9 ELSE 5 END, e.occurred_at, e.id`, [memberIds]);
  const whoDid = (e) => actorName(parties, e);
  const { rows: sigs } = await tx.query(`SELECT instance_id, role FROM keystone.signature_record WHERE instance_id = ANY($1::uuid[])`, [memberIds]);
  const signedCount = (docId) => sigs.filter((s) => s.instance_id === docId).length;
  const signers = parties.filter((p) => p.action_role === "signer");
  const blockers = parties.filter(isBlocking);
  const live = ["sent", "partially_signed"].includes(i.state);
  const nowMs = Date.now();
  // ★ P10-B-12: a form response names its people by the form's own seats (Employee, Manager), not just "signs"
  const { rows: [lb] } = await tx.query(`SELECT source_channel, template_body_snapshot->'roles' AS roles FROM keystone.document_instance WHERE id = $1`, [leadId]);
  const seatLabels = lb?.source_channel === "form" && Array.isArray(lb.roles) ? Object.fromEntries(lb.roles.filter((r) => r?.key && r?.label).map((r) => [r.key, String(r.label)])) : {};
  // ★ Run 8 R8-62 (J8): a person whose LATEST link email did not go out (the day's limit, a refused or failed send) is "not emailed", never "has the link"
  const { rows: lastMail } = await tx.query(
    `SELECT DISTINCT ON (party_id) party_id, status, error, created_at FROM keystone.document_email_log WHERE instance_id = ANY($1::uuid[]) AND party_id IS NOT NULL AND kind IN ('invitation', 'reminder') ORDER BY party_id, created_at DESC`, [[leadId, ...memberIds]]);
  const unsent = Object.fromEntries(lastMail.filter((m) => ["limit_reached", "failed", "skipped"].includes(m.status)).map((m) => [m.party_id, { reason: m.status, at: m.created_at }]));
  // Run 9: who witnessed whom, and who signed for a signing group
  const { rows: wit } = await tx.query(`SELECT party_id, name FROM keystone.document_witness WHERE instance_id = $1`, [leadId]);
  const witnessOf = Object.fromEntries(wit.map((w) => [w.party_id, w.name]));
  const groupSigner = (p) => (p.group_label ? parties.find((x) => x.role === p.role && x.group_label === p.group_label && x.status === "signed")?.name ?? null : null);
  return {
    team: await teamOf(tx, { kind: "document", id: leadId }), test: (await tx.query(`SELECT is_test FROM keystone.document_instance WHERE id = $1`, [leadId])).rows[0]?.is_test === true,
    id: i.id, leadId, title: i.title, state: i.state, status, actions: actionsFor(status), sentAt: i.sent_at, expiresAt: i.expires_at, executedAt: i.executed_at, fingerprint: i.final_sha256 ?? null, voidedAt: i.voided_at, voidReason: i.void_reason, scheduledSendAt: i.scheduled_send_at,
    progress: (() => { /* R10-56: a signing group is ONE seat; it counts as signed when any member signed it */ const seats = new Map(); for (const p of blockers) { const k = p.group_label ? `g:${p.role}:${p.group_label}` : p.id; seats.set(k, (seats.get(k) ?? false) || ["signed", "approved"].includes(p.status)); } return { signed: [...seats.values()].filter(Boolean).length, of: seats.size }; })(),
    parties: parties.map((p) => ({
      id: p.id, seat: p.role, seatLabel: seatLabels[p.role] ?? null, name: p.name, email: p.email, actionRole: p.action_role, position: p.position, status: status === "voided" && !isFinished(p) ? "cancelled" : p.status,   // D-075: a cancelled document's people are not "Pending" any more
      // ★ Run 8 J8 (R8-63): these four sat after the comment above on the same line, so they were never returned — no "Opened", no signed date, no bounce, no decline reason
      viewedAt: p.viewed_at, completedAt: p.completed_at, delivery: p.email_delivery, declineReason: p.decline_reason,
      notEmailed: live && !isFinished(p) && !p.viewed_at ? (unsent[p.id] ?? null) : null,
      waiting: live && isActionable(p, parties), canRemind: live && isActionable(p, parties), canReassign: live && !isFinished(p), canExtend: live && !isFinished(p) && p.action_role !== "cc", inPerson: (i.send_options?.in_person ?? []).includes(p.role),
      finished: isFinished(p), assistsRole: p.assists_role ?? null, expiresAt: p.expires_at, reminderDays: p.reminder_days, remindersSent: p.reminders_sent,
      linkExpired: live && !isFinished(p) && Boolean(p.expires_at) && new Date(p.expires_at).getTime() <= nowMs,
      group: p.group_label ?? null, closedBy: p.status === "closed" ? groupSigner(p) : null, witnessRequired: p.witness_required === true, witness: witnessOf[p.id] ?? null,
    })),
    documents: members.map((m) => ({ id: m.id, title: m.title, state: m.state, position: m.package_position ?? 1, signed: signedCount(m.id), of: signers.length })),
    payments: await paymentsOfSend(tx, { memberIds }),
    timeline: events.map((e) => ({
      at: e.occurred_at, kind: e.kind, text: e.kind === "uploaded" && e.detail?.origin === "created" ? "Document created" : (KIND_TEXT[e.kind] ?? e.kind), who: whoDid(e), documentId: e.instance_id, detail: e.detail ?? null,
    })),
  };
}

