// src/documents/pdfData.mjs — GETTING DATA OUT, AND TAKING A PERSON'S DETAILS OFF (QUEUE §23.15.3).
//   · exportOrganization: every signed document of a period as one zip — the sealed PDF and its audit log for each, and an index. Read-only.
//   · personReport: everything held about one email address across uploaded documents (what a person asks for in a "send me my data" request). Read-only.
//   · erasePerson: a person's "remove my details" request.
// ★★★ A SIGNED RECORD IS NEVER TOUCHED HERE. A document with any signature on it stands alone (§23.3) — the retention guard in the database refuses its deletion inside the window, and OUTSIDE the window it is a
//   deliberate, audited delete on the document itself, not a side effect of a person's request. So erasure only does the part that is always safe: for every document that is NOT signed it voids anything still out for
//   signature, removes the person's name, address, phone, link and anything they typed or uploaded, and notes it in the audit trail; and it REPORTS the signed ones it kept and until when.
import { zipSync, strToU8 } from "fflate";
import { invalid } from "../http/errors.mjs";
import { revokeLinkTokenById } from "../auth/linkToken.mjs";
import { voidPdfDocument } from "./pdfSend.mjs";
import { apiSignedCopy } from "./pdfApi.mjs";
import { auditLogCsv, csvText, zipEntryPath } from "./evidence.mjs";
import { safeEntryName } from "./textSafety.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { getDocumentSetting } from "./settings.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const iso = (v) => (v ? new Date(v).toISOString() : "");
const safe = (s) => Array.from(safeEntryName(s, "document")).slice(0, 80).join("").replace(/[. ]+$/, "") || "document";   // any script kept; never `..` or a slash (T-9)
const EXPORT_MAX_DOCUMENTS = 100;
const EXPORT_MAX_BYTES = 120 * 1024 * 1024;

/** The signed documents of a period (by the day they were completed), newest first, as one zip. A bigger set than the caps is cut off and says so — export the next period for the rest. */
export async function exportOrganization(tx, { tenantId, from = null, to = null }) {
  for (const [n, v] of [["from", from], ["to", to]]) if (v != null && Number.isNaN(Date.parse(v))) throw invalid(`${n} must be a date like 2026-01-31`, { field: n });
  const { rows } = await tx.query(
    `SELECT id, title, executed_at FROM keystone.document_instance
      WHERE builder = 'pdf' AND state = 'executed' AND archived_at IS NULL AND (package_lead_id IS NULL OR package_lead_id = id)
        AND ($1::timestamptz IS NULL OR executed_at >= $1) AND ($2::timestamptz IS NULL OR executed_at < ($2::timestamptz + interval '1 day'))
      ORDER BY executed_at DESC, id LIMIT $3`, [from, to, EXPORT_MAX_DOCUMENTS + 1]);
  const files = {}; const index = []; const taken = new Set(); let bytes = 0; let included = 0;
  for (const d of rows.slice(0, EXPORT_MAX_DOCUMENTS)) {
    const copy = await apiSignedCopy(tx, { instanceId: d.id });
    if (bytes + copy.bytes.length > EXPORT_MAX_BYTES) break;
    const folder = `${String(included + 1).padStart(3, "0")} - ${safe(d.title)}`;
    const signedPath = zipEntryPath(taken, folder, "signed.pdf");   // unique by construction (the NNN prefix), and checked: nothing is ever overwritten
    files[signedPath] = new Uint8Array(copy.bytes);
    files[zipEntryPath(taken, folder, "audit log.csv")] = strToU8((await auditLogCsv(tx, { tenantId, instanceId: d.id })).csv);
    index.push([d.id, d.title, iso(d.executed_at), signedPath]);
    bytes += copy.bytes.length; included += 1;
  }
  const truncated = rows.length > included;
  files["index.csv"] = strToU8(csvText([["document_id", "title", "completed_utc", "file"], ...index]));
  files["README.txt"] = strToU8(`${included} signed document(s)${from || to ? ` completed ${from ?? "…"} to ${to ?? "…"}` : ""}.${truncated ? ` The list was cut off at ${included}; export a narrower period for the rest.` : ""}\nEach folder holds the sealed PDF (with its certificate) and the audit log of that send.\n`);
  return { bytes: Buffer.from(zipSync(files, { level: 0 })), count: included, truncated };
}

async function partiesFor(tx, email) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) throw invalid("enter a valid email address", { field: "email" });
  const { rows } = await tx.query(
    `SELECT p.id AS party_id, p.role, p.action_role, p.name, p.status, p.viewed_at, p.completed_at, i.id AS lead_id, i.title, i.state, i.sent_at, i.executed_at,
            EXISTS (SELECT 1 FROM keystone.signature_record s JOIN keystone.document_instance m ON m.id = s.instance_id
                     WHERE s.signer_name IS NOT NULL AND (m.id = i.id OR m.package_lead_id = i.id) AND s.role = p.role) AS has_signed
       FROM keystone.document_party p JOIN keystone.document_instance i ON i.id = p.instance_id
      WHERE lower(p.email) = $1 AND i.builder = 'pdf' ORDER BY i.created_at DESC`, [address]);
  return { address, rows };
}

/** Everything held about this address on uploaded documents, as plain facts. The sealed files themselves are the sender's to give (the signed copy was emailed to the person when it was done). */
export async function personReport(tx, { email }) {
  const { address, rows } = await partiesFor(tx, email);
  return {
    email: address, generatedAt: new Date().toISOString(),
    documents: rows.map((r) => ({ id: r.lead_id, title: r.title, state: r.state, role: r.action_role, name: r.name, status: r.status, signed: r.has_signed, sentAt: iso(r.sent_at) || null, viewedAt: iso(r.viewed_at) || null, completedAt: iso(r.completed_at) || null, executedAt: iso(r.executed_at) || null })),
  };
}

/** The documents a staff member created (id, title, state, dates) — for their own data export. Newest first, bounded. */
export async function documentsCreatedBy(tx, { userId }) {
  const { rows } = await tx.query(`SELECT id, title, state, builder, created_at, sent_at, executed_at FROM keystone.document_instance WHERE created_by = $1 AND package_lead_id IS NULL ORDER BY created_at DESC LIMIT 5000`, [userId]);
  return rows;
}

/** A person's "remove my details". Returns what was removed, what was voided and what had to be kept (with the date its retention ends). Safe to repeat: nothing left to remove removes nothing. */
export async function erasePerson(tx, { tenantId, email, actorUserId = null }) {
  const { address, rows } = await partiesFor(tx, email);
  if (rows.length === 0) return { email: address, removed: [], voided: [], kept: [] };
  const years = await getDocumentSetting(tx, "retention_years");
  const removed = [], voided = [], kept = [];
  for (const r of rows) {
    if (r.state === "executed" || r.has_signed) {
      const until = Number.isInteger(years) && r.executed_at ? new Date(new Date(r.executed_at).getTime() + years * 365.25 * 86400000).toISOString().slice(0, 10) : null;
      kept.push({ id: r.lead_id, title: r.title, reason: "a signed record stands alone and is kept", keptUntil: until, indefinitely: until == null });
      continue;
    }
    if (["sent", "partially_signed"].includes(r.state)) {
      await voidPdfDocument(tx, { tenantId, instanceId: r.lead_id, reason: "Removed at the person's request", actorUserId });
      voided.push({ id: r.lead_id, title: r.title });
    }
    // what they typed lives in their `progress` (cleared below) until they sign — and once they have signed this branch is never reached, because that document is kept; their uploads are removed here
    await tx.query(
      `DELETE FROM keystone.document_file f USING keystone.document_instance m
        WHERE f.instance_id = m.id AND (m.id = $1 OR m.package_lead_id = $1) AND f.kind = 'attachment' AND f.meta->>'party_id' = $2`, [r.lead_id, r.party_id]);
    await tx.query(
      `UPDATE keystone.document_party SET name = 'Removed person', email = NULL, phone = NULL, external_ref = NULL, progress = NULL, viewed_ip = NULL, viewed_user_agent = NULL, consent_ip = NULL, consent_user_agent = NULL,
              verify_code_hash = NULL, verify_code_expires_at = NULL, email_message_id = NULL, decline_reason = NULL, updated_at = now() WHERE id = $1`, [r.party_id]);
    const { rows: links } = await tx.query(`SELECT id FROM keystone.link_token WHERE tenant_id = $1 AND subject_id = $2 AND issued_to = $3 AND revoked_at IS NULL AND redeemed_at IS NULL`, [tenantId, r.lead_id, r.party_id]);
    for (const l of links) await revokeLinkTokenById(tx, l.id, "details removed at the person's request");
    await recordAuditEvent(tx, { tenantId, instanceId: r.lead_id, kind: "erased", actorRole: null });
    removed.push({ id: r.lead_id, title: r.title });
  }
  // the log of emails sent to this address for the documents just cleaned (the address and the subject line) is cleaned with them; the log of a kept signed document stays with its record
  if (removed.length) await tx.query(
    `UPDATE keystone.document_email_log SET to_email = 'removed@removed.invalid', subject = '', error = NULL, updated_at = now()
      WHERE lower(to_email) = $1 AND instance_id IN (SELECT id FROM keystone.document_instance WHERE id = ANY($2::uuid[]) OR package_lead_id = ANY($2::uuid[]))`, [address, removed.map((x) => x.id)]);
  return { email: address, removed, voided, kept };
}
