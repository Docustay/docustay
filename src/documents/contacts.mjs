// PEOPLE (Final push Stage 2, report §14.8): the workspace's saved signers on a simple page. The island's own table (document_contact), filled automatically when a document is sent and when a form is submitted.
// Basic on purpose: first name, last name, email, documents signed, last activity, an optional preferred language. Deleting a person removes ONLY this row: a signed document is a record that outlives its person (document_party keeps its own snapshot).
import { invalid, notFound } from "../http/errors.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const LANG = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

/** "Mary Ann Smith" → ["Mary Ann", "Smith"]; one word → [word, ""] */
export function splitName(full) {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ["", ""];
  if (parts.length === 1) return [parts[0].slice(0, 120), ""];
  return [parts.slice(0, -1).join(" ").slice(0, 120), parts.at(-1).slice(0, 120)];
}

/** Save or refresh one person. The first name and last name already on file win over a later, shorter spelling; activity time always moves forward. */
export async function upsertContact(tx, { tenantId, name = "", email, source = "signer", language = null }) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) return null;
  const [first, last] = splitName(name);
  const { rows: [r] } = await tx.query(
    `INSERT INTO keystone.document_contact (tenant_id, first_name, last_name, email, source, language)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, email) DO UPDATE SET
       first_name = CASE WHEN keystone.document_contact.first_name = '' THEN EXCLUDED.first_name ELSE keystone.document_contact.first_name END,
       last_name  = CASE WHEN keystone.document_contact.last_name  = '' THEN EXCLUDED.last_name  ELSE keystone.document_contact.last_name  END,
       language   = COALESCE(keystone.document_contact.language, EXCLUDED.language),
       last_activity_at = now()
     RETURNING id`,
    [tenantId, first, last, address, source, language && LANG.test(language) ? language : null]);
  return r?.id ?? null;
}

/** Called after a send: every person with an address who signs, approves or just receives is remembered. */
export async function rememberParties(tx, { tenantId, parties }) {
  for (const p of parties ?? []) if (p?.email) await upsertContact(tx, { tenantId, name: p.name, email: p.email, source: "signer", language: p.signer_language ?? null }).catch(() => {});
}

const SELECT = `SELECT c.id, c.first_name, c.last_name, c.email, c.language, c.source, c.created_at, c.last_activity_at,
    (SELECT count(*)::int FROM keystone.document_party p WHERE p.tenant_id = c.tenant_id AND lower(p.email) = c.email) AS documents,
    (SELECT count(*)::int FROM keystone.document_party p WHERE p.tenant_id = c.tenant_id AND lower(p.email) = c.email AND p.status IN ('signed','approved')) AS signed
  FROM keystone.document_contact c`;

export async function listContacts(tx, { q = "", limit = 100, offset = 0, source = "" } = {}) {
  const term = String(q ?? "").trim().toLowerCase();
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  // Run 7: "respondents" = people who filled in a form (a party on a form response with their address), whatever first put them in People
  const resp = `EXISTS (SELECT 1 FROM keystone.document_party fp JOIN keystone.document_instance fi ON fi.id = fp.instance_id WHERE fi.source_channel = 'form' AND lower(fp.email) = lower(c.email))`;
  const where = `($1 = '' OR lower(c.first_name || ' ' || c.last_name) LIKE $2 OR c.email LIKE $2)${source === "form" ? ` AND ${resp}` : source === "signer" ? ` AND NOT ${resp}` : ""}`;
  const { rows } = await tx.query(`${SELECT} WHERE ${where} ORDER BY c.last_activity_at DESC, c.id LIMIT $3 OFFSET $4`, [term, like, Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0)]);
  const { rows: [{ n }] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.document_contact c WHERE ${where}`, [term, like]);
  return { contacts: rows, total: n };
}

export async function getContact(tx, { contactId }) {
  const { rows: [c] } = await tx.query(`${SELECT} WHERE c.id = $1`, [contactId]);
  if (!c) throw notFound("That person was not found.");
  const { rows: docs } = await tx.query(
    `SELECT i.id, i.title, i.state, i.created_at, i.sent_at, i.executed_at, p.status AS party_status
       FROM keystone.document_party p JOIN keystone.document_instance i ON i.id = p.instance_id
      WHERE lower(p.email) = $1 ORDER BY i.created_at DESC LIMIT 100`, [c.email]);
  return { ...c, documentsList: docs };
}

function cleanFields({ firstName, lastName, email, language }, { creating }) {
  const out = {};
  if (firstName !== undefined) { const v = String(firstName).trim(); if (v.length > 120) throw invalid("The first name is at most 120 characters.", { field: "firstName" }); out.first_name = v; }
  if (lastName !== undefined) { const v = String(lastName).trim(); if (v.length > 120) throw invalid("The last name is at most 120 characters.", { field: "lastName" }); out.last_name = v; }
  if (email !== undefined || creating) { const v = String(email ?? "").trim().toLowerCase(); if (!EMAIL.test(v)) throw invalid("Enter a valid email address.", { field: "email" }); out.email = v; }
  if (language !== undefined) { if (language !== null && language !== "" && !LANG.test(String(language))) throw invalid("That language code is not valid.", { field: "language" }); out.language = language || null; }
  return out;
}

export async function addContact(tx, { tenantId, firstName = "", lastName = "", email, language = null }) {
  const f = cleanFields({ firstName, lastName, email, language }, { creating: true });
  const { rows: [dup] } = await tx.query(`SELECT 1 FROM keystone.document_contact WHERE email = $1`, [f.email]);
  if (dup) throw invalid("That person is already on the list.", { field: "email", code: "duplicate" });
  const { rows: [r] } = await tx.query(`INSERT INTO keystone.document_contact (tenant_id, first_name, last_name, email, language, source) VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id`, [tenantId, f.first_name ?? "", f.last_name ?? "", f.email, f.language ?? null]);
  return { id: r.id };
}

export async function updateContact(tx, { contactId, firstName, lastName, email, language }) {
  const f = cleanFields({ firstName, lastName, email, language }, { creating: false });
  const keys = Object.keys(f);
  if (!keys.length) return { id: contactId };
  if (f.email) { const { rows: [dup] } = await tx.query(`SELECT 1 FROM keystone.document_contact WHERE email = $1 AND id <> $2`, [f.email, contactId]); if (dup) throw invalid("Another person already has that address.", { field: "email", code: "duplicate" }); }
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const { rowCount } = await tx.query(`UPDATE keystone.document_contact SET ${sets} WHERE id = $1`, [contactId, ...keys.map((k) => f[k])]);
  if (!rowCount) throw notFound("That person was not found.");
  return { id: contactId };
}

export async function deleteContact(tx, { contactId }) {
  const { rowCount } = await tx.query(`DELETE FROM keystone.document_contact WHERE id = $1`, [contactId]);
  if (!rowCount) throw notFound("That person was not found.");
  return { deleted: true };
}

/** CSV with a formula guard (a cell that starts with = + - @ is prefixed so a spreadsheet never runs it). */
export const csvCell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function contactsCsv(tx) {
  const { contacts } = await listContacts(tx, { limit: 500 });
  const head = ["First name", "Last name", "Email", "Language", "Documents", "Signed", "Last activity"];
  const lines = [head.join(","), ...contacts.map((c) => [c.first_name, c.last_name, c.email, c.language ?? "", c.documents, c.signed, new Date(c.last_activity_at).toISOString()].map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/** THE PERSON PAGE (Run 9 board "Person page"): everything that happened with this person, newest first, from the island's own rows — what they were sent, opened, signed or
 *  declined, the forms they filled in and what they paid. `kind` is the tab the item belongs to (document | form | payment). Counts are of documents, not of events. */
export async function personTimeline(tx, { contactId, limit = 200 }) {
  const person = await getContact(tx, { contactId });
  const { rows: parties } = await tx.query(
    `SELECT i.id AS doc, i.title, i.state, i.source_channel, i.sent_at, i.executed_at, i.created_at, i.is_test, tp.name AS form_name,
            p.id AS party, p.status, p.invited_at, p.viewed_at, p.completed_at, p.decline_reason, p.role
       FROM keystone.document_party p JOIN keystone.document_instance i ON i.id = p.instance_id LEFT JOIN keystone.document_template tp ON tp.id = i.template_id
      WHERE lower(p.email) = $1 AND i.archived_at IS NULL AND p.role IS DISTINCT FROM 'witness'
      ORDER BY i.created_at DESC LIMIT 500`, [person.email]);
  const items = [];
  for (const r of parties) {
    const form = r.source_channel === "form", base = { documentId: r.doc, partyId: r.party, title: form ? (r.form_name ?? r.title) : r.title, kind: form ? "form" : "document", test: r.is_test === true };
    if (form) { if (r.completed_at) items.push({ ...base, what: "filled", at: r.completed_at, sealed: r.state === "executed" }); continue; }
    if (r.invited_at || r.sent_at) items.push({ ...base, what: "sent", at: r.invited_at ?? r.sent_at, opened: Boolean(r.viewed_at), done: ["signed", "declined"].includes(r.status), canRemind: r.state === "sent" && !["signed", "declined"].includes(r.status) });
    if (r.viewed_at && !["signed", "declined"].includes(r.status)) items.push({ ...base, what: "opened", at: r.viewed_at });
    if (r.status === "signed" && r.completed_at) items.push({ ...base, what: "signed", at: r.completed_at, sealed: r.state === "executed" });
    if (r.status === "declined") items.push({ ...base, what: "declined", at: r.completed_at ?? r.viewed_at ?? r.invited_at, reason: r.decline_reason ?? null });
  }
  const partyIds = parties.map((r) => r.party);
  if (partyIds.length) {
    const { rows: pays } = await tx.query(
      `SELECT p.instance_id, p.amount_minor, p.currency, p.paid_at, p.status, p.refunded_minor, i.title FROM keystone.document_payment p JOIN keystone.document_instance i ON i.id = p.instance_id
        WHERE p.party_id = ANY($1::uuid[]) AND p.paid_at IS NOT NULL`, [partyIds]);
    for (const p of pays) items.push({ documentId: p.instance_id, title: p.title, kind: "payment", what: "paid", at: p.paid_at, amountMinor: p.amount_minor, currency: p.currency, refundedMinor: p.refunded_minor, status: p.status });
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  const docs = parties.filter((r) => r.source_channel !== "form");
  const counts = { signed: new Set(docs.filter((r) => r.status === "signed").map((r) => r.doc)).size, waiting: new Set(docs.filter((r) => r.state === "sent" && !["signed", "declined"].includes(r.status)).map((r) => r.doc)).size, forms: parties.filter((r) => r.source_channel === "form" && r.completed_at).length };
  return { person: { id: person.id, firstName: person.first_name, lastName: person.last_name, email: person.email, language: person.language ?? null, createdAt: person.created_at, lastActivityAt: person.last_activity_at }, counts, items: items.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 500)) };
}

/** The editor's "add from people you have sent to": a short list by name or address. */
export async function searchContacts(tx, { q = "", limit = 8 }) {
  const { contacts } = await listContacts(tx, { q, limit });
  return contacts.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim() || c.email, email: c.email, role: "person" }));
}
