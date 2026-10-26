// src/documents/evidence.mjs — THE EVIDENCE PACKAGE AND THE AUDIT EXPORT (QUEUE §23.5.1). Everything someone needs to show, years later, that a document was signed by whom and when — as one zip: the original, the sealed signed copy,
// the audit log, and a plain-language facts file. Pure read; staff only (the route guards that). A signed record is never changed by exporting it.
import { zipSync, strToU8 } from "fflate";
import { stringify } from "csv-stringify/sync";
import { forbidden, notFound, conflict } from "../http/errors.mjs";
import { trackPdfDocument } from "./pdfSend.mjs";
import { readFileBytes } from "./files.mjs";
import { sha256Hex } from "./files.mjs";
import { csvCell, safeEntryName, uniquePath } from "./textSafety.mjs";

const iso = (d) => (d ? new Date(d).toISOString() : "");

/** CSV text for rows of cells: every text cell goes through csvCell, so a typed name like =HYPERLINK(...) is plain text in a spreadsheet (T-15). Exported for the one test of it. */
export const csvText = (rows) => stringify(rows.map((r) => r.map(csvCell)));

/** A zip entry path from its parts: every part made safe (no `..`, no slash, no reserved characters, any script kept) and the whole made unique among `taken` — the second same-named entry becomes "name (2).ext" instead of overwriting the first (T-9, T-10). */
export function zipEntryPath(taken, ...parts) {
  return uniquePath(taken, parts.filter((p) => p !== "" && p != null).map((p) => safeEntryName(p)).join("/"));
}

/** The audit log of one send (every document in it) as CSV: when, what, who (by seat and name), which document, detail. Works at any stage. */
export async function auditLogCsv(tx, { tenantId, instanceId }) {
  const t = await trackPdfDocument(tx, { tenantId, instanceId });
  const docTitle = Object.fromEntries(t.documents.map((d) => [d.id, d.title]));
  const rows = t.timeline.map((e) => [iso(e.at), e.kind, e.text, e.who ?? "", docTitle[e.documentId] ?? "", e.detail ? JSON.stringify(e.detail) : ""]);
  return { name: safeEntryName(`${t.title} - audit log.csv`, "audit log.csv"), csv: csvText([["time_utc", "event", "description", "person", "document", "detail"], ...rows]) };
}

/** The whole package as zip bytes. Only an executed document has a signed copy to put in it. */
export async function evidencePackage(tx, { tenantId, instanceId }) {
  const t = await trackPdfDocument(tx, { tenantId, instanceId });
  if (t.state !== "executed") throw conflict("the evidence package is available once everyone has signed");
  const files = {};
  const manifest = [];
  const taken = new Set();       // every path already in the zip (lower-cased) — nothing is ever overwritten
  const folders = new Set();
  const add = (parts, bytes) => { const path = zipEntryPath(taken, ...parts); files[path] = bytes; manifest.push({ path, sha256: sha256Hex(Buffer.from(bytes)), bytes: bytes.length }); };
  for (const d of t.documents) {
    const folder = t.documents.length > 1 ? uniquePath(folders, safeEntryName(d.title, "document")) : "";   // one folder per document, even when two share a title
    const { rows: fr } = await tx.query(`SELECT id, kind, name FROM keystone.document_file WHERE instance_id = $1 AND kind IN ('original','final') ORDER BY kind, position`, [d.id]);
    // the sender's extra files and whatever each signer uploaded into a file field
    const { rows: extra } = await tx.query(`SELECT id, name, meta FROM keystone.document_file WHERE instance_id = $1 AND kind = 'attachment' ORDER BY position, created_at`, [d.id]);
    for (const e of extra) {
      const kind = e.meta?.extra ? "attachments" : "signer-uploads";
      add([folder, kind, (e.meta?.field_id ? `${e.meta.field_id} - ` : "") + e.name], new Uint8Array((await readFileBytes(tx, { fileId: e.id })).bytes));
    }
    const original = fr.find((f) => f.kind === "original");
    if (original) add([folder, "original.pdf"], new Uint8Array((await readFileBytes(tx, { fileId: original.id })).bytes));
    const signed = fr.filter((f) => f.kind === "final").pop();   // read through the files port with its recorded fingerprint, the same way every other file is
    if (signed) add([folder, "signed.pdf"], new Uint8Array((await readFileBytes(tx, { fileId: signed.id })).bytes));
  }
  const audit = await auditLogCsv(tx, { tenantId, instanceId });
  add(["audit-log.csv"], strToU8(audit.csv));
  const { rows: sigs } = await tx.query(
    `SELECT s.instance_id, s.role, s.signer_order, s.signer_name, s.signed_at, s.signer_timezone, s.signer_ip, s.user_agent, s.mark_sha256, s.prev_hash, s.row_hash FROM keystone.signature_record s WHERE s.instance_id = ANY($1::uuid[]) ORDER BY s.instance_id, s.signer_order`,
    [t.documents.map((d) => d.id)]);
  const facts = {
    title: t.title, completedAt: iso(t.executedAt), sentAt: iso(t.sentAt),
    people: t.parties.map((p) => ({ name: p.name, email: p.email, role: p.actionRole, status: p.status, firstOpenedAt: iso(p.viewedAt), completedAt: iso(p.completedAt) })),
    signatures: sigs.map((s) => ({ documentId: s.instance_id, seat: s.role, order: s.signer_order, name: s.signer_name, signedAt: iso(s.signed_at), timezone: s.signer_timezone, ip: s.signer_ip, userAgent: s.user_agent, markSha256: s.mark_sha256, previousHash: s.prev_hash, hash: s.row_hash })),
    files: manifest,
  };
  add(["evidence.json"], strToU8(JSON.stringify(facts, null, 2)));
  add(["README.txt"], strToU8(
    `Evidence for "${t.title}"\n\nsigned.pdf is the sealed copy — it carries the certificate page and a digital seal. original.pdf is the file as it was uploaded.\naudit-log.csv lists every recorded step with its time (UTC).\nevidence.json gives each signature with its fingerprints; each signature's hash includes the one before it, so a change anywhere breaks the chain.\nTo check a copy of signed.pdf, open the verify link on its certificate page, or compare its SHA-256 with the value in the file list above.\n`));
  return { name: safeEntryName(`${t.title} - evidence.zip`, "evidence.zip"), bytes: Buffer.from(zipSync(files, { level: 6 })) };
}
void forbidden; void notFound;
