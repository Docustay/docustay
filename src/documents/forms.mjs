// FORMS (Final push Stage 2, report §14.6): a template that collects from many people through a public link. The link itself is the existing self-serve link (self_serve_enabled / self_serve_slug); this adds its controls
// (expiry, response limit, email check, copy-to, intro), a responses list, a CSV, and a public start that also takes the template's questions. Every response is a NORMAL document (source_channel = 'form'), so the
// document page, the audit trail, the sealed copy, reminders and the Documents list all work unchanged.
// ★ A form has exactly ONE person who fills it (same rule as self-serve). Anything with more roles is sent the ordinary way.
import { emptySenderBoxes, senderBoxMessage } from "./senderBoxes.mjs";
import { formEverPublished, markFormFirstPublished } from "./templateCap.mjs";
import { invalid, notFound, conflict, dependency } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { createPdfFromTemplate, savePdfDocument } from "./pdfDocs.mjs";
import { sendPdfDocument, signNowLink } from "./pdfSend.mjs";
import { assertUsable } from "./pdfTemplates.mjs";
import { apiUseTemplate } from "./pdfApiV2.mjs";
import { variablesOf } from "./engine/creation.mjs";
import { upsertContact, csvCell } from "./contacts.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const SLUG = /^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/;
// ★ Run 7: the Publish step's options. fillAgain = "Fill in another" after a response; embedSites = the websites allowed to show the form in a frame; counterSign = a staff member
//   signs after the visitor; notifyOwner / confirmRespondent = the two form emails; thankYou = the line the visitor reads when they finish.
export const FORM_DEFAULTS = Object.freeze({ verifyEmail: false, copyTo: null, expiresAt: null, responseLimit: null, intro: null, fillAgain: false, embedSites: [], counterSign: null, notifyOwner: true, confirmRespondent: true, thankYou: null });
export const MSG_NO_COUNTER_SIGNATURE = "The team member who counter-signs has nowhere to sign. Add a signature field for them, or turn counter-sign off.";
export const MSG_DATE_PASSED = "The closing date has already passed.";
export const MSG_NEEDS_APPROVAL = "This form needs an owner or admin to approve it before it can be published. It is saved and waiting for approval on Templates.";
export const msgNoChoices = (label) => `“${label}” has no choices. Add its choices, or remove the field.`;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/;   // a closing DAY (what the date box sends; older rows hold it as midnight UTC): the form is open through the END of that day
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

/** The controls a form can have, validated. Unknown keys are refused; null clears one. */
export function cleanFormSettings(raw, base = FORM_DEFAULTS) {
  const s = { ...FORM_DEFAULTS, ...(base ?? {}) };
  if (raw == null) return s;
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid("The form settings are an object.", { field: "settings" });
  for (const k of Object.keys(raw)) if (!Object.hasOwn(FORM_DEFAULTS, k)) throw invalid(`There is no form setting called “${k}”.`, { field: `settings.${k}` });
  if (raw.verifyEmail !== undefined) { if (typeof raw.verifyEmail !== "boolean") throw invalid("The email check is on or off.", { field: "settings.verifyEmail" }); s.verifyEmail = raw.verifyEmail; }
  if (raw.copyTo !== undefined) { if (raw.copyTo === null || raw.copyTo === "") s.copyTo = null; else { const v = String(raw.copyTo).trim().toLowerCase(); if (!EMAIL.test(v)) throw invalid("Enter a valid address for the copies.", { field: "settings.copyTo" }); s.copyTo = v; } }
  if (raw.expiresAt !== undefined) { if (raw.expiresAt === null || raw.expiresAt === "") s.expiresAt = null; else { const str = String(raw.expiresAt).trim(); const d = new Date(str); if (Number.isNaN(d.getTime())) throw invalid("The closing date is not a date.", { field: "settings.expiresAt" }); s.expiresAt = DAY_ONLY.test(str) ? str.slice(0, 10) : d.toISOString(); } }
  if (raw.responseLimit !== undefined) { if (raw.responseLimit === null || raw.responseLimit === "") s.responseLimit = null; else { const n = Number(raw.responseLimit); if (!Number.isInteger(n) || n < 1 || n > 100000) throw invalid("The response limit is a whole number from 1 to 100000.", { field: "settings.responseLimit" }); s.responseLimit = n; } }
  if (raw.intro !== undefined) { if (raw.intro === null || String(raw.intro).trim() === "") s.intro = null; else { const v = String(raw.intro).trim(); if (v.length > 1000) throw invalid("The introduction is at most 1000 characters.", { field: "settings.intro" }); s.intro = v; } }
  if (raw.thankYou !== undefined) { if (raw.thankYou === null || String(raw.thankYou).trim() === "") s.thankYou = null; else { const v = String(raw.thankYou).trim(); if (v.length > 300) throw invalid("The thank-you line is at most 300 characters.", { field: "settings.thankYou" }); s.thankYou = v; } }
  for (const k of ["fillAgain", "notifyOwner", "confirmRespondent"]) if (raw[k] !== undefined) { if (typeof raw[k] !== "boolean") throw invalid("That setting is on or off.", { field: `settings.${k}` }); s[k] = raw[k]; }
  if (raw.embedSites !== undefined) {
    const list = raw.embedSites == null ? [] : Array.isArray(raw.embedSites) ? raw.embedSites : String(raw.embedSites).split(/[\s,]+/);
    const clean = [...new Set(list.map((x) => String(x).trim().toLowerCase().replace(/\/+$/, "")).filter(Boolean))];
    if (clean.length > 20) throw invalid("At most 20 websites can show the form.", { field: "settings.embedSites" });
    for (const o of clean) if (!ORIGIN.test(o)) throw invalid(`“${o}” is not a website address. Use the start of the address, like https://www.example.com`, { field: "settings.embedSites" });
    s.embedSites = clean;
  }
  if (raw.counterSign !== undefined) {
    if (raw.counterSign === null || raw.counterSign?.on === false) s.counterSign = null;
    else if (typeof raw.counterSign !== "object" || Array.isArray(raw.counterSign)) throw invalid("The counter-sign setting is an object.", { field: "settings.counterSign" });
    else s.counterSign = { on: true, userId: raw.counterSign.userId ? String(raw.counterSign.userId) : null };
  }
  return s;
}

/** ★ P10-B-3: the name a VISITOR sees (page title, response title, signing mail): the form's name without the " (2)" counter that only tells templates apart on the owner's screens. */
export const publicFormName = (name) => { const n = String(name ?? "").trim(); return n.replace(/\s+\(\d{1,4}\)$/, "").trim() || n; };

/** ★ P10-B-10: the name and email the visitor typed on the first screen go into the filler's own name and email boxes. Matches by what the box is (an email box; a text box labelled Name / Full name / Your name), never by position. Pure. */
export function prefillValues(fields, role, { name, email }) {
  const mine = (Array.isArray(fields) ? fields : []).filter((f) => f && f.role === role && f.type === "text");
  const out = {};
  const mail = mine.find((f) => f.validation === "email" && !out[f.id]);
  if (mail) out[mail.id] = email;
  const who = mine.find((f) => f !== mail && (!f.validation || f.validation === "none") && /^\s*(your |full |legal |first and last )?(full )?name\s*$/i.test(String(f.label ?? "")));
  if (who) out[who.id] = name;
  return out;
}

/** Today's date (YYYY-MM-DD) in a timezone; UTC when the zone is unknown. */
export function dayIn(tz, now = Date.now()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); }
  catch { return new Date(now).toISOString().slice(0, 10); }
}
/** Has the closing date fully passed? A day closes at the END of that day in the workspace's timezone; a full timestamp (API) closes at that instant. */
export function datePassed(expiresAt, now = Date.now(), tz = null) {
  if (!expiresAt) return false;
  const v = String(expiresAt);
  if (DAY_ONLY.test(v)) return dayIn(tz, now) > v.slice(0, 10);
  return new Date(v).getTime() <= now;
}
/** Why a form is not taking responses right now, or null. Pure. `responses` counts SIGNED responses only. */
export function closedReason(settings, responses, now = Date.now(), tz = null) {
  if (datePassed(settings?.expiresAt, now, tz)) return "expired";
  if (settings?.responseLimit && responses >= settings.responseLimit) return "full";
  return null;
}
async function tzOf(tx, tenantId = null) {
  try { const id = tenantId ?? (await tx.query(`SELECT keystone.current_tenant_id() AS t`)).rows[0]?.t; return id ? ((await (await ports()).brand.get(tx, { tenantId: id }))?.timezone ?? null) : null; } catch { return null; }
}

// ★ Run 7 (migration 0708): a form, its versions and its responses are tied by the template's FAMILY id, never by its name, so renaming a published form keeps its link and every response.
// A response made since 0708 carries form_id; an older one is found through its template's family (template_id, or for an uploaded PDF the file's from_template note, since an
// uploaded-PDF document is its own copy and leaves template_id empty by design).
const isResponse = (famExpr) => `i.source_channel = 'form' AND (i.form_id = ${famExpr} OR (i.form_id IS NULL AND (i.template_id IN (SELECT id FROM keystone.document_template WHERE family_id = ${famExpr}) OR EXISTS (SELECT 1 FROM keystone.document_file f WHERE f.instance_id = i.id AND f.kind = 'original' AND f.meta->>'from_template' IN (SELECT id::text FROM keystone.document_template WHERE family_id = ${famExpr})))))`;
// ★ P10-A-5: a response counts (limit, Forms list, plan) only once the visitor has SIGNED their part: their party signed, or the document executed. A started-but-unsigned one counts for nothing.
// (src/documents/api.mjs sendCountForPeriod applies the same rule to the plan's monthly count.)
const signedSql = `(i.executed_at IS NOT NULL OR (SELECT p.status FROM keystone.document_party p WHERE p.instance_id = i.id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1) IN ('signed','approved'))`;
// Run 9 (F984): one number from a narrow definer read (migration 0725), the same for the public page (no person) and the owner's screens — never other people's rows through the sweeps' view
const countSql = `keystone.form_signed_responses(t.tenant_id, t.family_id) AS responses`;

async function currentTemplate(tx, templateId) {
  const { rows: [t] } = await tx.query(`SELECT id, tenant_id, name, family_id, kind, active, approval_status, body, source, collects_many, form_settings, self_serve_enabled, self_serve_slug FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("That template was not found.");
  return t;
}

/** Turn a template into a form (or change its link and controls). The link name is unique in the workspace. */
export async function publishForm(tx, { tenantId = null, templateId, slug, settings, enabled = true }) {
  const t = await currentTemplate(tx, templateId);
  if (t.approval_status === "pending") throw conflict(MSG_NEEDS_APPROVAL, { code: "needs_approval" });
  if (!t.active || t.approval_status !== "approved") throw conflict("Only the current, approved version of a template can be a form.", { code: "not_current" });
  const clean0 = cleanFormSettings(settings, t.form_settings);
  for (const f of Array.isArray(t.body?.fields) ? t.body.fields : []) if ((f.type === "dropdown" || f.type === "multiselect") && !(Array.isArray(f.options) && f.options.some((o) => String(o).trim()))) throw invalid(msgNoChoices(f.label || f.id), { field: "templateId", code: "no_choices" });   // ★ P10-A-8 (before the body is parsed: the strict parser has its own, less helpful, sentence)
  // Run 9 (R8-57): a box the form's owner fills in (the policy's name on an acknowledgement) needs its answer before the form goes live: a visitor is never asked for it
  if (enabled) { const empty = emptySenderBoxes(t.body?.fields); if (empty.length) throw invalid(`${senderBoxMessage(empty[0]).replace("before sending", "before the form goes live")}.`, { field: "templateId", code: "sender_box_empty" }); }
  const seats = parsePdfBodyData(t.body).roles.length;
  if (seats !== 1 && !(seats === 2 && clean0.counterSign?.on)) throw invalid(seats === 2 ? "This form has a second person. Turn on the staff counter-sign, or remove the second person." : "A form needs a template with exactly one person who fills it (and, if you like, one staff member who counter-signs). For more people, send it the ordinary way.", { field: "templateId", code: "one_seat" });
  const body0 = parsePdfBodyData(t.body), fields0 = Array.isArray(t.body?.fields) ? t.body.fields : [];
  if (enabled && clean0.expiresAt && datePassed(clean0.expiresAt, Date.now(), await tzOf(tx, tenantId))) throw invalid(MSG_DATE_PASSED, { field: "settings.expiresAt" });
  if (clean0.counterSign?.on && seats === 2) {   // ★ P10-A-2: the counter-signer needs a signature to give
    const key = body0.roles[1].key;
    if (!fields0.some((f) => f.role === key && f.type === "signature")) throw invalid(MSG_NO_COUNTER_SIGNATURE, { field: "settings.counterSign" });
  }
  const name = String(slug ?? t.self_serve_slug ?? "").trim().toLowerCase();
  if (enabled && !SLUG.test(name)) throw invalid("The link name must be 4–60 characters: letters, numbers and dashes.", { field: "slug" });
  if (name) { const { rows: [clash] } = await tx.query(`SELECT 1 FROM keystone.document_template WHERE lower(self_serve_slug) = $1 AND family_id <> $2`, [name, t.family_id]); if (clash) throw conflict("That link name is already used.", { field: "slug" }); }
  const clean = clean0;
  if (clean.counterSign?.on) await assertCounterSigner(tx, clean.counterSign.userId);
  // Run 8 (the maintainer, 11 Oct 2026): a form counts as one of the plan's monthly documents, once, the FIRST time it goes live — checked exactly like a send (refused at the limit), and recorded so a
  // re-publish, a new version or closing and reopening never counts again. A host with no plans checks nothing.
  if (enabled && !(await formEverPublished(tx, { familyId: t.family_id }))) {
    await (await ports()).entitlements?.assertMaySend?.(tx, { tenantId: tenantId ?? t.tenant_id, needsEmail: false });
    await markFormFirstPublished(tx, { tenantId: tenantId ?? t.tenant_id, familyId: t.family_id });
  }
  await tx.query(`UPDATE keystone.document_template SET self_serve_enabled = false, self_serve_slug = NULL WHERE family_id = $1 AND id <> $2`, [t.family_id, templateId]);
  await tx.query(`UPDATE keystone.document_template SET kind = 'form', collects_many = true, form_settings = $2::jsonb WHERE family_id = $1`, [t.family_id, JSON.stringify(clean)]);   // every version is the same form
  await tx.query(`UPDATE keystone.document_template SET self_serve_enabled = $2, self_serve_slug = $3 WHERE id = $1`, [templateId, enabled, name || null]);
  return getForm(tx, { templateId, tenantId });
}

/** Switch the link off (it stays a form: responses and settings are kept). */
export async function setFormOpen(tx, { tenantId = null, templateId, open }) {
  const t = await currentTemplate(tx, templateId);
  if (!t.collects_many) throw conflict("That template is not a form yet.", { code: "not_a_form" });
  if (open && !t.self_serve_slug) throw invalid("Give the form a link name first.", { field: "slug" });
  await tx.query(`UPDATE keystone.document_template SET self_serve_enabled = $2 WHERE id = $1`, [templateId, open]);
  return getForm(tx, { templateId, tenantId });
}

/** Unpublish: the link stops working and is freed. The form template stays (with its settings), so it can be published again; its responses stay as the documents they are. */
export async function removeForm(tx, { templateId }) {
  const t = await currentTemplate(tx, templateId);
  await tx.query(`UPDATE keystone.document_template SET self_serve_enabled = false, self_serve_slug = NULL WHERE family_id = $1`, [t.family_id]);
  return { removed: true };
}

/** The counter-signer must be a staff member of this workspace who can sign. */
async function assertCounterSigner(tx, userId) {
  if (!userId) throw invalid("Choose who counter-signs.", { field: "settings.counterSign.userId" });
  const [u] = await (await ports()).people.byIds(tx, [userId]);
  if (!u || u.role !== "staff" || u.archived_at) throw invalid("The counter-signer must be someone on your team.", { field: "settings.counterSign.userId" });
}

export async function listForms(tx) {
  const { rows } = await tx.query(`SELECT t.id, t.name, t.self_serve_slug AS slug, t.self_serve_enabled AS open, t.form_settings AS settings, t.updated_at, ${countSql} FROM keystone.document_template t WHERE t.builder = 'pdf' AND t.kind = 'form' AND t.active ORDER BY t.updated_at DESC`);
  const tz = await tzOf(tx);
  return rows.map((r) => ({ ...r, settings: cleanFormSettings(r.settings), closed: closedReason(cleanFormSettings(r.settings), r.responses, Date.now(), tz) }));
}

export async function getForm(tx, { templateId, tenantId = null }) {
  const { rows: [t] } = await tx.query(`SELECT t.id, t.name, t.family_id, t.kind, t.active, t.collects_many, t.self_serve_slug AS slug, t.self_serve_enabled AS open, t.form_settings AS settings, t.body, t.source IS NOT NULL AS written, ${countSql} FROM keystone.document_template t WHERE t.id = $1 AND t.builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("That form was not found.");
  const settings = cleanFormSettings(t.settings);
  const org = tenantId ? await (await ports()).brand.get(tx, { tenantId }) : null;   // the workspace's public name for the link (the host knows it, not the island)
  return { id: t.id, familyId: t.family_id, name: t.name, isForm: t.kind === "form", open: t.open, slug: t.slug, orgSlug: org?.slug ?? null, link: t.slug && org?.publicBase ? `${org.publicBase}/f/${org.slug ?? "-"}/${t.slug}` : null, settings, responses: t.responses, closed: closedReason(settings, t.responses, Date.now(), await tzOf(tx, tenantId)), written: t.written, seat: parsePdfBodyData(t.body).roles[0]?.label ?? null };
}

export async function listResponses(tx, { templateId, limit = 100, offset = 0 }) {
  const { rows: [t] } = await tx.query(`SELECT family_id FROM keystone.document_template WHERE id = $1 AND builder = 'pdf'`, [templateId]);
  if (!t) throw notFound("That form was not found.");
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.state, i.created_at, i.sent_at, i.executed_at, ${signedSql} AS signed,
            (SELECT p.name FROM keystone.document_party p WHERE p.instance_id = i.id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1) AS name,
            (SELECT p.email FROM keystone.document_party p WHERE p.instance_id = i.id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1) AS email
       FROM keystone.document_instance i
      WHERE ${isResponse("$1")}
      ORDER BY i.created_at DESC LIMIT $2 OFFSET $3`, [t.family_id, Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0)]);
  return { responses: rows };
}

export async function responsesCsv(tx, { templateId }) {
  const { responses } = await listResponses(tx, { templateId, limit: 500 });
  const lines = [["Name", "Email", "Status", "Started", "Signed", "Document id"].join(","), ...responses.map((r) => [r.name, r.email, r.state, new Date(r.created_at).toISOString(), r.executed_at ? new Date(r.executed_at).toISOString() : "", r.id].map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/** ── the public side ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
async function liveTemplate(tx, slug) {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!SLUG.test(s)) return null;
  const { rows: [t] } = await tx.query(`SELECT t.id, t.family_id, t.name, t.builder, t.active, t.approval_status, t.body, t.source, t.form_settings, t.client_description, ${countSql} FROM keystone.document_template t WHERE t.builder = 'pdf' AND t.kind = 'form' AND lower(t.self_serve_slug) = $1 AND t.self_serve_enabled AND t.active AND t.approval_status = 'approved'`, [s]);
  if (!t) return null;
  try { const n = parsePdfBodyData(t.body).roles.length, cs = cleanFormSettings(t.form_settings).counterSign?.on; if (n !== 1 && !(n === 2 && cs)) return null; } catch { return null; }
  return t;
}

/** What the public page shows. null for anything that is not a live form (the page shows the same "no such page" for all of them); `closed` says it is shut. */
export async function readForm(tx, { tenantId, slug, now = Date.now() }) {
  const t = await liveTemplate(tx, slug);
  if (!t) return null;
  const settings = cleanFormSettings(t.form_settings);
  const body = parsePdfBodyData(t.body);
  const { practiceName, logoUrl } = await (await ports()).brand.get(tx, { tenantId });
  const questions = t.source ? variablesOf(t.source).map((v) => ({ key: v.key, label: v.label, kind: v.kind ?? "text", default: v.default ?? "" })) : [];
  return { title: publicFormName(t.name), about: t.client_description ?? null, intro: settings.intro, org: { name: practiceName, logoUrl }, seat: body.roles[0].label, questions, verifyEmail: settings.verifyEmail, closed: closedReason(settings, t.responses, now, await tzOf(tx, tenantId)), embedSites: settings.embedSites ?? [] };
}

export async function formOwner(tx) {
  const id = await (await ports()).people.practiceOwner?.(tx);
  if (!id) throw dependency("This workspace has no owner set up to receive responses, so the form cannot be used yet.");
  return id;
}

/** One visitor starts. Returns { presented } (sign here, now) or { emailed: true } (the email check: the link and code go to the address typed). */
export async function startForm(tx, { tenantId, ownerId, slug, name, email, answers = null, now = Date.now() }) {
  const person = String(name ?? "").trim();
  if (!person) throw invalid("Type your name to begin.", { field: "name" });
  if (person.length > 120) throw invalid("That name is too long.", { field: "name" });
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) throw invalid("Enter a valid email address.", { field: "email" });
  const t = await liveTemplate(tx, slug);
  if (!t) throw notFound("That page does not exist.");
  assertUsable(t);
  const settings = cleanFormSettings(t.form_settings);
  const closed = closedReason(settings, t.responses, now, await tzOf(tx, tenantId));
  if (closed) throw conflict(closed === "expired" ? "This form is closed." : "This form is not taking more responses.", { code: `form_${closed}` });
  const body = parsePdfBodyData(t.body), seat = body.roles[0], staffSeat = settings.counterSign?.on ? body.roles[1] ?? null : null;
  const title = `${publicFormName(t.name)} — ${person}`.slice(0, 120);
  // ★ Run 7: the staff counter-signer signs AFTER the visitor (one after another); they are a real person on the team, read through the people port
  const counter = staffSeat ? (await (await ports()).people.byIds(tx, [settings.counterSign.userId]))[0] ?? null : null;
  if (staffSeat && !counter) throw dependency("This form's counter-signer is no longer on the team, so it cannot take responses until the owner picks another.");
  const counterName = counter ? (counter.display_name || [counter.first_name, counter.last_name].filter(Boolean).join(" ") || counter.email) : null;
  const people = [{ name: person, email: address, role: seat.label, action: "signer" }, ...(counter ? [{ name: counterName, email: counter.email, role: staffSeat.label, action: "signer" }] : []), ...(settings.copyTo ? [{ name: "Copy", email: settings.copyTo, role: "Copy", action: "cc" }] : [])];
  let instanceId;
  if (t.source) {
    const made = await apiUseTemplate(tx, { tenantId, ownerId, templateId: t.id, title, people, variableValues: answers ?? {}, send: false });
    instanceId = made.id;
  } else {
    const made = await createPdfFromTemplate(tx, { tenantId, templateId: t.id, actorUserId: ownerId, title });
    instanceId = made.instanceId;
    const withCopy = settings.copyTo ? { body: { ...body, roles: [...body.roles, { key: "copy_1", label: "Copy" }] } } : {};   // a copy recipient needs a seat of its own
    await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId, ...withCopy, parties: [{ role: seat.key, name: person, email: address, action_role: "signer", ...(counter ? { step: 1 } : {}) }, ...(counter ? [{ role: staffSeat.key, name: counterName, email: counter.email, action_role: "signer", step: 2 }] : []), ...(settings.copyTo ? [{ role: "copy_1", name: "Copy", email: settings.copyTo, action_role: "cc", ...(counter ? { step: 2 } : {}) }] : [])] });
  }
  const { rows: [doc] } = await tx.query(`SELECT send_options FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const seatKey = (await tx.query(`SELECT role FROM keystone.document_party WHERE instance_id = $1 AND action_role = 'signer' LIMIT 1`, [instanceId])).rows[0]?.role ?? seat.key;
  const options = { ...(doc?.send_options ?? {}), self_serve: true, order: counter ? "sequential" : "parallel", verification: settings.verifyEmail ? "email_code" : "none", expiry_days: settings.verifyEmail ? 14 : 1, ...(settings.verifyEmail ? {} : { in_person: [seatKey] }) };
  await savePdfDocument(tx, { tenantId, actorUserId: ownerId, instanceId, sendOptions: options });
  await tx.query(`UPDATE keystone.document_instance SET source_channel = 'form', form_id = $2 WHERE id = $1`, [instanceId, t.family_id]);
  { const { rows: [snap] } = await tx.query(`SELECT template_body_snapshot->'fields' AS fields FROM keystone.document_instance WHERE id = $1`, [instanceId]);
    const seed = prefillValues(snap?.fields, seatKey, { name: person, email: address });
    if (Object.keys(seed).length) await tx.query(`UPDATE keystone.document_party SET progress = $3::jsonb WHERE instance_id = $1 AND role = $2 AND action_role = 'signer'`, [instanceId, seatKey, JSON.stringify(seed)]); }
  await upsertContact(tx, { tenantId, name: person, email: address, source: "form" }).catch(() => {});   // before the send, which would file them as an ordinary signer
  await sendPdfDocument(tx, { tenantId, instanceId, actorUserId: ownerId, forVisitor: true });
  if (settings.verifyEmail) return { emailed: true };
  const { rows: [p] } = await tx.query(`SELECT id FROM keystone.document_party WHERE instance_id = $1 AND action_role = 'signer' AND lower(email) = $2 ORDER BY position LIMIT 1`, [instanceId, address]);
  const { presented } = await signNowLink(tx, { tenantId, instanceId, partyId: p.id });
  return { presented };
}

/** Run 7: what a form response's signing page shows when the person has finished — the form's thank-you line and, when the form offers it and is still open, the link to fill it in again.
 *  `embedSites` lets the signing page be framed by the same websites the form itself may be shown on. Null when the document is not a form response. */
export async function formEndFor(tx, { tenantId, leadId }) {
  const { rows: [t] } = await tx.query(
    `SELECT t.self_serve_slug AS slug, t.self_serve_enabled AS open, t.form_settings AS s FROM keystone.document_instance i JOIN keystone.document_template t
        ON t.family_id = COALESCE(i.form_id, (SELECT x.family_id FROM keystone.document_template x WHERE x.id = i.template_id))
      WHERE i.id = $1 AND i.source_channel = 'form' ORDER BY t.self_serve_slug IS NOT NULL DESC, t.version DESC LIMIT 1`, [leadId]);
  if (!t) return null;
  const s = cleanFormSettings(t.s);
  const b = await (await ports()).brand.get(tx, { tenantId });
  const again = s.fillAgain && t.open && t.slug && b.publicBase ? `${b.publicBase}/f/${b.slug ?? "-"}/${t.slug}` : null;
  return { thankYou: s.thankYou ?? null, againUrl: again, embedSites: s.embedSites ?? [] };
}
