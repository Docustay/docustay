// src/documents/files.mjs — THE BYTES OF AN UPLOADED DOCUMENT (QUEUE §23.4.1, §23.4.2, §23.4.12). Sniff what the file REALLY is, hash it the moment it arrives, keep it through the `files` port,
// read the PDF, and start a draft document whose body is the third builder (`pdf`, pdfBody.mjs). ONLY PDF FILES ARE ACCEPTED (the maintainer, 9 Oct 2026): Docustay converts nothing.
//
// ★ The type comes from the file's own bytes (`file-type`), never from its name or the browser's claim: a .pdf that is a zip is refused, and a .docx that is really an .exe is refused.
// ★ The ORIGINAL is stored untouched and its SHA-256 is recorded the moment it arrives; every later copy (converted, final) is a separate row with its own hash.
// ★ Nothing here runs a file: bytes are parsed for structure (pdf-lib, pdf.js with eval off) or handed to the converter service; a file that cannot be read is refused with a sentence, never stored as a document.
import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { invalid, notFound, dependency } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { uploadCapMb } from "./uploadLimit.mjs";
import { createInstance } from "./writes.mjs";
import { inspectPdf, PdfProblem, looksLikePdf, stripActiveContent, hasDigitalSignature } from "./pdfProcess.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { defaultTeamFor } from "./teams.mjs";

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

export const ACCEPTED_FORMATS = Object.freeze(["PDF"]);
export const PDF_ONLY_MESSAGE = "Docustay only accepts PDF files.";

/**
 * What is this file, really? → { kind: 'pdf', mime, ext } or a refusal in plain words. The decision is the file's own first bytes (`%PDF-` in the first 1024), never its name or the browser's claim.
 * A scanned PDF is still a PDF and stays allowed.
 */
export async function sniffUpload(bytes) {
  if (!bytes || bytes.length === 0) throw invalid("That file is empty.", { code: "empty" });
  if (looksLikePdf(bytes)) return { kind: "pdf", mime: "application/pdf", ext: "pdf" };
  throw invalid(PDF_ONLY_MESSAGE, { code: "wrong_type" });
}

const problemToRefusal = (e) => invalid(e.message, { code: e.code });

async function insertFile(tx, { tenantId, instanceId, id, kind, name, mime, bytes, key, inspected = null, meta = {}, position = 1, actorUserId = null }) {
  await tx.query(
    `INSERT INTO keystone.document_file (id, tenant_id, instance_id, kind, name, mime, byte_size, sha256, storage_key, page_count, pages, meta, position, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)`,
    [id, tenantId, instanceId, kind, name, mime, bytes.length, sha256Hex(bytes), key, inspected?.pageCount ?? null,
      inspected ? JSON.stringify(inspected.pages) : null, JSON.stringify(meta), position, actorUserId]);
}

const hasDigitalSignatureBytes = (b) => hasDigitalSignature(b);   // one rule (pdfProcess.mjs): a usage-rights-only file is NOT signed   // an already-signed file is attached untouched: rewriting it would break its signature
const baseName = (name) => String(name || "Document").replace(/[\\/]/g, "_").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim().slice(0, 120) || "Document";
const safeName = (name) => String(name || "document").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255);

/**
 * Receive an upload and start a draft document from it (steps 1 and 2 of the flow).
 * @returns {{instanceId, title, file:{id,name,sha256,pageCount,pages}, flags:{scanned,alreadySigned,converted}, suggestions}}
 */
export async function acceptUpload(tx, { tenantId, actorUserId = null, name, bytes, title = null, subjectUserId = null, instanceId = null, position = 1, preset = null, origin = "upload" }) {
  const P = await ports();
  if (!P.files.configured()) throw dependency("File storage is not set up here, so documents cannot be uploaded yet.");
  const maxMb = await uploadCapMb(tx, { tenantId });
  if (bytes.length > maxMb * 1024 * 1024) throw invalid(`That file is ${(bytes.length / 1048576).toFixed(1)} MB; the most that can be uploaded is ${maxMb} MB.`, { code: "too_big", maxMb });

  const type = await sniffUpload(bytes);
  const originalId = randomUUID();
  const originalSha = sha256Hex(bytes);

  // 1 · the working PDF (the original when it is one; a conversion otherwise)
  let pdfBytes = bytes, converted = false;
  let stripped = [];
  if (!hasDigitalSignatureBytes(pdfBytes)) { try { const r = await stripActiveContent(pdfBytes); if (r.removed.length || r.rightsDropped) { pdfBytes = r.bytes; converted = true; stripped = r.removed; } } catch { /* a file that cannot be rewritten is read as it is: nothing in it is run */ } }
  let inspected;
  try { inspected = await inspectPdf(pdfBytes); } catch (e) { if (e instanceof PdfProblem) throw problemToRefusal(e); throw e; }

  // 1b · text tags — `{{Name;type=signature;role=Buyer}}` written in the document become fields, and the tag text is covered (Part 30 item 7)
  // (`preset` = fields already placed by the caller, as the HTML route does — the PDF it prints has no tags to find)
  let tagged = preset ? { roles: preset.roles, fields: preset.fields, warnings: preset.warnings ?? [] } : null;
  if (!preset && inspected.hasText && !inspected.alreadySigned) {
    const { locateTags, coverTags } = await import("./textTagPlacement.mjs");
    const { fieldsFromTags } = await import("./textTags.mjs");
    const found = await locateTags(pdfBytes);
    if (found.errors.length) throw invalid(`A text tag on page ${found.errors[0].page} cannot be used: ${found.errors[0].error}.`, { code: "text_tag_invalid", tags: found.errors });
    if (found.tags.length) {
      tagged = fieldsFromTags(found.tags, found.tags.map((t) => t.box));
      pdfBytes = await coverTags(pdfBytes, found.tags);
      converted = true;
      try { inspected = await inspectPdf(pdfBytes); } catch (e) { if (e instanceof PdfProblem) throw problemToRefusal(e); throw e; }
    }
  }

  // 1c · field detection: the boxes a person would draw by hand, found for them (lines, boxes, tick boxes, bars, the words beside them, who signs). Never blocks an upload: a file it cannot read simply has no suggestions.
  let detection = null, fingerprint = null;
  if (!tagged && !preset && origin !== "created" && !inspected.alreadySigned && process.env.KEYSTONE_DETECT !== "off") {
    try {
      // Nothing is guessed at upload (Part 1, 9 Oct 2026): only a form sent before is recognised, from the page fingerprints. The editor's "Find fields" button does the guessing, when the person asks.
      const { detect } = await import("./detect/index.mjs");
      const r = await detect(pdfBytes, { timeoutMs: 30_000, hashOnly: true, ocr: false });
      if (r.ok) {
        fingerprint = r.result.pages.map((x) => ({ hash: x.hash }));
        const { findLayout, suggestionsFromLayout } = await import("./detect/remember.mjs");
        const lay = await findLayout(tx, { pages: fingerprint }).catch(() => null);
        if (lay) { const m = suggestionsFromLayout(lay); detection = { roles: m.roles, suggestions: m.suggestions, note: { fields: m.suggestions.length, signers: m.roles.length, lowConfidence: 0, pages: [], documents: [], remembered: lay.name } }; }
      }
    } catch { /* the editor falls back to the simple suggestions */ }
  }

  // 2 · keep the bytes (the original, untouched; then the conversion if there is one) BEFORE any row says they exist
  const origStore = await P.files.put({ tenantId, id: originalId, bytes, contentType: type.mime });
  let workingId = originalId, workingStoreKey = origStore.key;
  let convertedId = null, convertedStore = null;
  if (converted) {
    convertedId = randomUUID();
    convertedStore = await P.files.put({ tenantId, id: convertedId, bytes: pdfBytes, contentType: "application/pdf" });
    workingId = convertedId; workingStoreKey = convertedStore.key;
  }

  // 3 · the draft document
  const docTitle = (title && title.trim()) || baseName(name);
  let id = instanceId;
  if (!id) {
    const created = await createInstance(tx, { tenantId, builder: "pdf", title: docTitle, subjectUserId, actorUserId });
    id = created.id;
    const team = await defaultTeamFor(tx, actorUserId);
    if (team) await tx.query(`UPDATE keystone.document_instance SET team_id = $2 WHERE id = $1`, [id, team]);   // a new document starts in its maker's only team
  }
  await insertFile(tx, { tenantId, instanceId: id, id: originalId, kind: "original", name: safeName(name), mime: type.mime, bytes, key: origStore.key, inspected: type.kind === "pdf" ? inspected : null,
    meta: { scanned: inspected.scanned, already_signed: type.kind === "pdf" ? inspected.alreadySigned : false, acroform: type.kind === "pdf" ? inspected.acroform : [], ...(fingerprint ? { fingerprint } : {}) }, position, actorUserId });
  if (converted) {
    await insertFile(tx, { tenantId, instanceId: id, id: convertedId, kind: "converted", name: `${baseName(name)}.pdf`, mime: "application/pdf", bytes: pdfBytes, key: convertedStore.key, inspected,
      meta: { scanned: inspected.scanned, already_signed: inspected.alreadySigned, from: tagged ? `${type.ext}+tags` : type.ext, ...(tagged ? { tags: tagged.fields.length } : {}), ...(stripped.length ? { stripped } : {}), ...(fingerprint ? { fingerprint } : {}) }, position, actorUserId });
  }
  const workingSha = sha256Hex(pdfBytes);
  const body = {
    kind: "pdf", schema_version: 1,
    file: { file_id: workingId, sha256: workingSha, page_count: inspected.pageCount, pages: inspected.pages, name: converted ? `${baseName(name)}.pdf` : safeName(name) },
    roles: tagged ? tagged.roles : detection ? detection.roles : [{ key: "signer_1", label: "Signer 1" }],
    fields: tagged ? tagged.fields : [],
    suggestions: inspected.alreadySigned || tagged ? [] : detection ? detection.suggestions : inspected.suggestions.filter((x) => /^f\d+$/.test(x.id)),   // only the file's own form fields; guessed ones come from "Find fields"
    ...(detection ? { detect: { pages: detection.note.pages.slice(0, 2000), documents: detection.note.documents.slice(0, 500), ...(detection.note.remembered ? { remembered: detection.note.remembered } : {}), ...(detection.note.truncated ? { truncated: true } : {}) } } : {}),
  };
  // a tag the shape refuses (a formula naming a field that is not there, say) is the sender's to fix: say so in plain words, not as a server fault
  try { parsePdfBodyData(body); } catch (e) { throw invalid(String(e.message).replace(/^this pdf body is not the one permitted shape — fields\.\d+\./, "A payment tag: "), { issues: e.issues ?? [] }); }
  await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, original_sha256 = $3, updated_at = now() WHERE id = $1`, [id, JSON.stringify(body), originalSha]);
  await recordAuditEvent(tx, { tenantId, instanceId: id, kind: "uploaded", detail: { ...(origin === "created" ? { origin } : {}), name: safeName(name), mime: type.mime, bytes: bytes.length, sha256: originalSha, pages: inspected.pageCount } });
  return {
    instanceId: id, title: docTitle,
    file: { id: workingId, name: body.file.name, sha256: workingSha, pageCount: inspected.pageCount, pages: inspected.pages, originalSha256: originalSha },
    flags: { scanned: inspected.scanned, alreadySigned: inspected.alreadySigned, converted, stripped, tagged: tagged ? tagged.fields.length : 0, tagWarnings: tagged?.warnings ?? [] },
    suggestions: body.suggestions, detection: detection?.note ?? null,
  };
}

/** Load a stored file's bytes, verified against the recorded hash (a mismatch is refused, never served). */
export async function readFileBytes(tx, { fileId }) {
  const { rows: [f] } = await tx.query(`SELECT id, instance_id, kind, name, mime, sha256, storage_key FROM keystone.document_file WHERE id = $1`, [fileId]);
  if (!f) throw notFound("no such file in this organisation");
  const bytes = await (await ports()).files.get({ key: f.storage_key });
  if (sha256Hex(bytes) !== f.sha256) throw dependency(`the stored file “${f.name}” does not match its recorded fingerprint — refusing to serve it`);
  return { row: f, bytes };
}

/** The files of a document, as the screens need them (no storage keys). */
export async function filesOf(tx, { instanceId }) {
  const { rows } = await tx.query(
    `SELECT id, kind, name, mime, byte_size, sha256, page_count, pages, meta, position FROM keystone.document_file WHERE instance_id = $1 ORDER BY position, created_at`, [instanceId]);
  return rows;
}

// ── extra files (QUEUE §23.5.4) ─────────────────────────────────────────────────────────────────────────────────
/** What a SIGNER may put into a `file` field (a copy of an ID is usually a photo): PDF, JPEG or PNG. Stored as it is and never converted. Sender uploads and attachments are PDF only. */
async function sniffFieldFile(bytes) {
  if (!bytes || bytes.length === 0) throw invalid("That file is empty.", { code: "empty" });
  if (looksLikePdf(bytes)) return { kind: "pdf", mime: "application/pdf" };
  const t = await fileTypeFromBuffer(bytes);
  if (t?.mime === "image/png" || t?.mime === "image/jpeg") return { kind: "image", mime: t.mime };
  throw invalid("Upload a PDF, or a JPEG or PNG picture.", { code: "wrong_type" });
}
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** An EXTRA file the sender wants the recipients to be able to read alongside the document (a price list, terms…). Stored as kind `attachment` on the draft, listed in `send_options.attachments`; draft only. */
export async function acceptAttachment(tx, { tenantId, actorUserId = null, instanceId, name, bytes }) {
  const P = await ports();
  if (!P.files.configured()) throw dependency("File storage is not set up here, so files cannot be attached yet.");
  const { rows: [i] } = await tx.query(`SELECT state, builder, send_options, package_lead_id FROM keystone.document_instance WHERE id = $1 AND archived_at IS NULL`, [instanceId]);
  if (!i || i.builder !== "pdf") throw notFound("no such uploaded document");
  if (i.state !== "draft") throw invalid("Files can only be attached before the document is sent.", { code: "not_draft" });
  if (bytes.length > ATTACHMENT_MAX_BYTES) throw invalid(`That file is ${(bytes.length / 1048576).toFixed(1)} MB; an attachment can be at most 25 MB.`, { code: "too_big" });
  const type = await sniffUpload(bytes);   // PDF only: Docustay only accepts PDF files
  const existing = i.send_options?.attachments ?? [];
  if (existing.length >= 20) throw invalid("A document can carry at most 20 attachments.", { code: "too_many" });
  const id = randomUUID();
  const stored = await P.files.put({ tenantId, id, bytes, contentType: type.mime });
  await insertFile(tx, { tenantId, instanceId, id, kind: "attachment", name: safeName(name), mime: type.mime, bytes, key: stored.key, meta: { extra: true }, position: existing.length + 2, actorUserId });
  await tx.query(`UPDATE keystone.document_instance SET send_options = jsonb_set(send_options, '{attachments}', $2::jsonb, true), updated_at = now() WHERE id = $1`, [instanceId, JSON.stringify([...existing, id])]);
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "uploaded", detail: { attachment: true, sha256: sha256Hex(bytes), bytes: bytes.length } });
  return { fileId: id, name: safeName(name), size: bytes.length, mime: type.mime };
}

/** Take an extra file off a draft. */
export async function removeAttachment(tx, { instanceId, fileId }) {
  const { rows: [i] } = await tx.query(`SELECT state, send_options FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [instanceId]);
  if (!i) throw notFound("no such uploaded document");
  if (i.state !== "draft") throw invalid("Files can only be removed before the document is sent.", { code: "not_draft" });
  const list = i.send_options?.attachments ?? [];
  if (!list.includes(fileId)) throw notFound("that file is not attached to this document");
  const { rows: [f] } = await tx.query(`SELECT storage_key FROM keystone.document_file WHERE id = $1 AND instance_id = $2 AND kind = 'attachment'`, [fileId, instanceId]);
  await tx.query(`UPDATE keystone.document_instance SET send_options = jsonb_set(send_options, '{attachments}', $2::jsonb, true), updated_at = now() WHERE id = $1`, [instanceId, JSON.stringify(list.filter((x) => x !== fileId))]);
  await tx.query(`DELETE FROM keystone.document_file WHERE id = $1 AND instance_id = $2 AND kind = 'attachment'`, [fileId, instanceId]);
  if (f) await (await ports()).files.delete({ key: f.storage_key }).catch(() => {});
  return { removed: true };
}

/** A file a SIGNER uploads into a `file` field (a copy of an ID, a certificate…): small (the request body is capped), sniffed, stored as an attachment owned by that person and field. → { fileId, name, size } */
export async function acceptFieldFile(tx, { tenantId, instanceId, partyId, fieldId, name, bytes }) {
  const P = await ports();
  if (!P.files.configured()) throw dependency("File storage is not set up here, so files cannot be uploaded yet.");
  if (bytes.length > 700 * 1024) throw invalid("That file is over 700 KB. A photo is shrunk for you; for a PDF, send a smaller one.", { code: "too_big" });
  const type = await sniffFieldFile(bytes);
  const id = randomUUID();
  const stored = await P.files.put({ tenantId, id, bytes, contentType: type.mime });
  await insertFile(tx, { tenantId, instanceId, id, kind: "attachment", name: safeName(name), mime: type.mime, bytes, key: stored.key, meta: { field_id: fieldId, party_id: partyId }, position: 99 });
  return { fileId: id, name: safeName(name), size: bytes.length };
}
