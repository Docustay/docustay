// src/documents/pdfArchive.mjs — THE SEALED COPY OF AN EXECUTED UPLOADED DOCUMENT (QUEUE §23.4.8). Called by archive.mjs for builder `pdf`: read the original pages (hash-checked), burn in everyone's field values,
// append the Certificate of Completion (on the lead document of a send), seal, store through the `files` port, and record the original's hash AND the final hash.
//
// Returns the same shape as the contract/form path ({objectKey, bucket, sha256, byteSize, reused, bytes, title, signatures}) plus `recipients` (everyone who should be emailed the copy).
import { hiddenNow } from "./rules.mjs";
import { certificateLanguage, languageFor } from "./signerLanguage.mjs";
import { randomUUID } from "node:crypto";
import { dependency, invalid } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { chromeInputsFor } from "./chromeInputs.mjs";
import { gatherCertificateFacts } from "./certificateFacts.mjs";
import { documentsOfSend } from "./parties.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import "./pdfFlattenFonts.mjs";   // the server's fallback fonts for burned-in text (pdfFlatten.mjs itself also runs in the browser)
import { flattenOntoOriginal } from "./pdfFlatten.mjs";
import { readFileBytes, sha256Hex } from "./files.mjs";
import { renderExecutedFlattenedPdf, addTrustedTimestamp } from "./pdf.mjs";
import { verifySignedPdf } from "./verifyPdf.mjs";
import { getDocumentSetting } from "./settings.mjs";
import { signatureIdOf } from "./signingPolicy.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { readKeyDates } from "./keyDates.mjs";

/** Executed uploaded documents that still have no sealed copy a quarter of an hour after they were executed — the worker queues the archive again (migration 0701 lets the viewer-less sweep see exactly these). */
export async function staleUnarchivedDocuments(tx) {
  const { rows } = await tx.query(`SELECT id, created_by FROM keystone.document_instance WHERE builder = 'pdf' AND state = 'executed' AND archived_at IS NULL AND executed_at <= now() - interval '15 minutes' AND NOT EXISTS (SELECT 1 FROM keystone.document_pdf p WHERE p.instance_id = document_instance.id) ORDER BY executed_at LIMIT 50`);
  return rows;
}

/** B-3 (Run 6): executed uploaded documents whose sealed copy went out without a trusted timestamp and has not been re-stamped yet (migration 0703 lets the viewer-less sweep see exactly these; recent ones only, so a service that never answers is not asked for ever). */
export async function untimestampedSealedDocuments(tx) {
  const { rows } = await tx.query(`SELECT id, created_by FROM keystone.document_instance WHERE builder = 'pdf' AND state = 'executed' AND archived_at IS NULL AND executed_at > now() - interval '30 days' AND executed_at <= now() - interval '15 minutes'
    AND EXISTS (SELECT 1 FROM keystone.document_audit_event a WHERE a.instance_id = document_instance.id AND a.kind = 'seal_untimestamped')
    AND NOT EXISTS (SELECT 1 FROM keystone.document_audit_event a WHERE a.instance_id = document_instance.id AND a.kind = 'seal_restamped')
    AND EXISTS (SELECT 1 FROM keystone.document_pdf p WHERE p.instance_id = document_instance.id) LIMIT 50`);
  return rows;
}

/**
 * B-3 (Run 6): give a sealed copy its trusted timestamp after the fact. The stored copy is read, checked to still be a valid seal without a timestamp, stamped (an incremental update after the seal, so the seal's own signature stays valid), and stored under a NEW object key; the old object is left in storage. The copy's recorded hash moves to the new file (`document_pdf`, the `final` file row, the instance's `final_sha256`) and the audit trail says `seal_restamped` with both hashes — never silent. Returns { restamped: boolean, reason? }; a timestamp service that still does not answer is not an error (the sweep asks again).
 */
export async function restampSealedCopy(tx, { tenantId, instanceId }) {
  const P = await ports();
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`archive:${instanceId}`]);
  const { rows: [need] } = await tx.query(`SELECT
      EXISTS (SELECT 1 FROM keystone.document_audit_event WHERE instance_id = $1 AND kind = 'seal_untimestamped') AS missing,
      EXISTS (SELECT 1 FROM keystone.document_audit_event WHERE instance_id = $1 AND kind = 'seal_restamped') AS done`, [instanceId]);
  if (!need.missing || need.done) return { restamped: false, reason: "nothing to do" };
  const { rows: [had] } = await tx.query(`SELECT object_key, sha256 FROM keystone.document_pdf WHERE instance_id = $1`, [instanceId]);
  if (!had) return { restamped: false, reason: "no sealed copy stored yet" };
  const kept = await P.files.get({ key: had.object_key }).catch(() => null);
  if (!Buffer.isBuffer(kept) || sha256Hex(kept) !== had.sha256) return { restamped: false, reason: "the stored copy could not be read back intact" };
  const before = verifySignedPdf(kept);
  if (!before.signed || before.valid === false) return { restamped: false, reason: "the stored copy is not a valid seal; it is left as it is" };
  if (before.timestamped) return { restamped: false, reason: "already timestamped" };
  const stamped = await addTrustedTimestamp(kept);
  if (!stamped) return { restamped: false, reason: "the timestamp service did not answer" };
  const after = verifySignedPdf(stamped);
  if (!after.signed || after.valid === false || !after.timestamped) return { restamped: false, reason: "the stamped copy did not verify; the original is kept" };
  const fileId = randomUUID(), digest = sha256Hex(stamped);
  const stored = await P.files.put({ tenantId, id: fileId, bytes: stamped, contentType: "application/pdf" });
  await tx.query(`UPDATE keystone.document_pdf SET object_key = $2, sha256 = $3, byte_size = $4 WHERE instance_id = $1`, [instanceId, stored.key, digest, stamped.length]);
  await tx.query(`UPDATE keystone.document_file SET storage_key = $2, sha256 = $3, byte_size = $4 WHERE instance_id = $1 AND kind = 'final'`, [instanceId, stored.key, digest, stamped.length]);
  await tx.query(`UPDATE keystone.document_instance SET final_sha256 = $2 WHERE id = $1`, [instanceId, digest]);
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "seal_restamped", detail: { from_sha256: had.sha256, to_sha256: digest, reason: "a trusted timestamp was added after the copy was sealed" } });
  return { restamped: true, sha256: digest, from: had.sha256 };
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

async function flattenedFor(tx, memberId, { showSignatureId = false, isTest = false } = {}) {
  const { rows: [m] } = await tx.query(`SELECT id, title, template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [memberId]);
  const body = parsePdfBodyData(m.template_body_snapshot);
  const { bytes: original } = await readFileBytes(tx, { fileId: body.file.file_id });
  const { rows } = await tx.query(`SELECT field_id, value, mark_image FROM keystone.document_field_value WHERE instance_id = $1`, [memberId]);
  const values = new Map(rows.map((r) => [r.field_id, { value: r.value, mark: r.mark_image }]));
  // a file field's value is the uploaded file's id; the page shows its name (the file itself is in the evidence package)
  for (const f of body.fields.filter((x) => x.type === "file")) {
    const v = values.get(f.id);
    if (!v?.value) continue;
    const { rows: [fr] } = await tx.query(`SELECT name FROM keystone.document_file WHERE id = $1`, [v.value]);
    values.set(f.id, { value: `File attached: ${fr?.name ?? "uploaded"}`, mark: null });
  }
  // Part 30 item 5 — a signature ID beside each signature/initials mark: the first 12 hex characters of that seat's signature record hash (anyone can recompute it from the record)
  let signatureIds = null;
  if (showSignatureId) {
    const { rows: recs } = await tx.query(`SELECT role, row_hash FROM keystone.signature_record WHERE instance_id = $1`, [memberId]);
    const byRole = new Map(recs.map((r) => [r.role, signatureIdOf(r.row_hash)]));
    signatureIds = new Map(body.fields.filter((f) => ["signature", "initials"].includes(f.type) && byRole.get(f.role)).map((f) => [f.id, byRole.get(f.role)]));
  }
  // Run 9: what the rules left out, worked out again from what was signed (the same function the signing page and the signature used)
  const plain = Object.fromEntries([...values].map(([k, v]) => [k, v.value]));
  for (const f of body.fields) if (f.locked && f.default != null && plain[f.id] == null) plain[f.id] = String(f.default);
  const hidden = hiddenNow({ fields: body.fields, pages: body.page_rules ?? [] }, plain);
  const shown = body.fields.filter((f) => !hidden.fields.has(f.id));
  const bytes = await flattenOntoOriginal(original, shown, values, { signatureIds, testWatermark: isTest, dropPages: hidden.pages });
  return { id: m.id, title: m.title, pageCount: body.file.page_count - [...hidden.pages].filter((n) => n <= body.file.page_count).length, bytes, originalSha256: body.file.sha256, hiddenPages: [...hidden.pages].sort((a, b) => a - b) };
}

export async function archivePdfDocument(tx, { tenantId, instanceId, instance, signatures }) {
  const P = await ports();
  // Round 3 R-7: the in-process archive (a moment after the last signature) and the queued job can start together; both would render and seal a DIFFERENT copy (the timestamp differs) and the second would overwrite the stored object while the document keeps the first digest.
  // One at a time per document: the second waits for the first to commit, then finds the stored copy and keeps it (the "sealed copy never changes" rule below).
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`archive:${instanceId}`]);
  if (!P.files.configured()) throw dependency("file storage is not configured, so this executed document cannot be archived — the retry will close the gap once it is");
  const snapshot = typeof instance.template_snapshot === "string" ? JSON.parse(instance.template_snapshot) : instance.template_snapshot;
  const { rows: [inst] } = await tx.query(`SELECT package_lead_id FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const leadId = inst.package_lead_id ?? instanceId;
  const { rows: [ld] } = await tx.query(`SELECT send_options AS opts FROM keystone.document_instance WHERE id = $1`, [leadId]);
  const certLanguage = await certificateLanguage(tx, { leadId, sendOptions: ld?.opts });
  const isLead = leadId === instanceId;
  const members = await documentsOfSend(tx, { instanceId: leadId });
  const flattened = [];
  const showSignatureId = (await getDocumentSetting(tx, "signing.show_signature_id")) === true;
  const { rows: [tst] } = await tx.query(`SELECT is_test FROM keystone.document_instance WHERE id = $1`, [leadId]);
  for (const m of members) flattened.push(await flattenedFor(tx, m.id, { showSignatureId, isTest: tst?.is_test === true }));
  const idx = flattened.findIndex((f) => f.id === instanceId);

  const { settings, brand, logoBytes, zone, publicBase } = await chromeInputsFor(tx, { tenantId, templateId: null });
  const { rows: sigRows } = await tx.query(`SELECT * FROM keystone.signature_record WHERE instance_id = $1 ORDER BY signer_order`, [instanceId]);
  const leadInstance = isLead ? instance : (await tx.query(`SELECT id, title, state, executed_at, sent_at, created_by, original_sha256 FROM keystone.document_instance WHERE id = $1`, [leadId])).rows[0];
  const leadSignatures = isLead ? signatures : (await tx.query(`SELECT * FROM keystone.signature_record WHERE instance_id = $1 ORDER BY signer_order`, [leadId])).rows;
  const certificate = settings["certificate.enabled"] && isLead ? await gatherCertificateFacts(tx, { tenantId, instanceId: leadId, instance: leadInstance, signatures: leadSignatures }) : null;
  // ★ §23.5.1: the QR names THIS send (tenant.lead.code) so the verify page can show who signed what; the code does not depend on the sealed file, so it can live inside it
  const { rows: [vc] } = await tx.query(`SELECT keystone.document_verify_code($1) AS code`, [leadId]);
  const verifyUrl = publicBase && vc?.code ? `${publicBase}/verify/${tenantId}.${leadId}.${vc.code}` : (publicBase ? `${publicBase}/verify` : null);
  const combine = (await getDocumentSetting(tx, "signed_copy.combine_audit")) !== false;
  const pdf = await renderExecutedFlattenedPdf({
    title: instance.title, executedAt: iso(instance.executed_at), documents: flattened, includeIndexes: [idx], withCertificate: isLead, separateCertificate: !combine,
    signatures: sigRows.map((s) => ({ role: s.role, signerName: s.signer_name, signedAt: iso(s.signed_at), signedLocalDate: s.signed_local_date, signerTimezone: s.signer_timezone, markSha256: s.mark_sha256, markImage: s.mark_image ?? null, signerEmail: null, signerIp: s.signer_ip ?? null })),
    settings, brand, logoBytes, zone, documentId: instanceId, certificate, verifyUrl,
    originalSha256: flattened[idx].originalSha256, disclosure: snapshot?.disclosure ?? null, language: certLanguage,
  });
  if (!Buffer.isBuffer(pdf.bytes) || pdf.bytes.length === 0) throw invalid(`the renderer produced no bytes for ${instanceId} — refusing to archive`);

  // FIX PASS 3: a sealed copy never changes. The signing process archives it first and the queue job runs again afterwards; a second render differs in a few bytes, and overwriting the row left the served file not matching final_sha256. If the sealed copy is already stored and still verifies, keep it and hand ITS bytes on.
  const { rows: [had0] } = await tx.query(`SELECT object_key, sha256 FROM keystone.document_pdf WHERE instance_id = $1`, [instanceId]);
  let sealedKept = false;
  if (had0) {
    // only an object that is GONE (a 404) may be replaced by a fresh render; a copy that cannot be read for any other reason (the store is down, the key will not open it) stops this run, so a sealed copy is never replaced because it was unreadable for a moment
    const kept = await P.files.get({ key: had0.object_key }).catch((e) => { if (/responded 404\b/.test(String(e?.message))) return null; throw dependency(`the stored sealed copy of ${instanceId} could not be read, so it was not replaced: ${e?.message ?? e}`); });
    if (Buffer.isBuffer(kept) && sha256Hex(kept) === had0.sha256) { pdf.bytes = kept; sealedKept = true; }
  }
  const fileId = randomUUID();
  const stored = sealedKept ? { key: had0.object_key } : await P.files.put({ tenantId, id: fileId, bytes: pdf.bytes, contentType: "application/pdf" });
  const digest = sha256Hex(pdf.bytes);
  const r = await tx.query(
    `INSERT INTO keystone.document_pdf (tenant_id, instance_id, object_key, bucket, sha256, byte_size, rendered_from) VALUES ($1,$2,$3,$4,$5,$6,'template_snapshot')
     ON CONFLICT (tenant_id, instance_id) DO UPDATE SET object_key = EXCLUDED.object_key, bucket = EXCLUDED.bucket, sha256 = EXCLUDED.sha256, byte_size = EXCLUDED.byte_size, archived_at = now()
     RETURNING (xmax = 0) AS inserted`, [tenantId, instanceId, stored.key, P.files.bucket(), digest, pdf.bytes.length]);
  const reused = r.rows[0]?.inserted === false;
  if (!reused && !sealedKept && pdf.timestamped === false) await recordAuditEvent(tx, { tenantId, instanceId, kind: "seal_untimestamped", detail: { reason: "the timestamp authority did not answer" } });   // Round 3 R-11: never silent
  if (!reused) {
    await tx.query(
      `INSERT INTO keystone.document_file (id, tenant_id, instance_id, kind, name, mime, byte_size, sha256, storage_key, page_count, meta)
       VALUES ($1,$2,$3,'final',$4,'application/pdf',$5,$6,$7,$8,$9::jsonb)`,
      [fileId, tenantId, instanceId, `${instance.title} (signed).pdf`.slice(0, 255), pdf.bytes.length, digest, stored.key, pdf.pages, JSON.stringify({ original_sha256: flattened[idx].originalSha256, content_sha256: pdf.contentSha256 })]);
    await tx.query(`UPDATE keystone.document_instance SET final_sha256 = $2 WHERE id = $1`, [instanceId, digest]);
  }

  // Part 30 item 5 — with "put the audit log inside the signed PDF" off, the certificate is its own sealed file beside the signed one
  let certificateBytes = null;
  if (pdf.certificateBytes && isLead) {
    certificateBytes = pdf.certificateBytes;
    const certId = randomUUID(), cdigest = sha256Hex(certificateBytes);
    const cstored = await P.files.put({ tenantId, id: certId, bytes: certificateBytes, contentType: "application/pdf" });
    const { rows: [had] } = await tx.query(`SELECT 1 AS x FROM keystone.document_file WHERE instance_id = $1 AND kind = 'certificate'`, [instanceId]);
    if (!had) await tx.query(
      `INSERT INTO keystone.document_file (id, tenant_id, instance_id, kind, name, mime, byte_size, sha256, storage_key, page_count, meta) VALUES ($1,$2,$3,'certificate',$4,'application/pdf',$5,$6,$7,NULL,'{}'::jsonb)`,
      [certId, tenantId, instanceId, `${instance.title} (certificate).pdf`.slice(0, 255), certificateBytes.length, cdigest, cstored.key]);
  }

  // who gets the copy: every person on the send with an address, if the practice has that on
  let recipients = [], copyEnabled = false;
  if (tst?.is_test === true) {
    // a test document's copy goes only to its sender
    const sender = leadInstance.created_by ? (await P.people.byIds(tx, [leadInstance.created_by]))[0] : null;
    if (sender?.email) recipients = [{ name: sender.display_name, email: sender.email }];
  } else if (await getDocumentSetting(tx, "upload.email_signed_copy")) {
    copyEnabled = true;   // D-055: the organisation wants the copy emailed — even when no one on it has an address (everyone signed on this device), the sender still gets it   // every document of a package is sealed on its own, so each one's copy is emailed (Stage T, 8 Oct 2026: the second document's copy was never sent)
    const { rows } = await tx.query(`SELECT id, name, email, signer_language FROM keystone.document_party WHERE instance_id = $1 AND email IS NOT NULL AND action_role IN ('signer','cc','approver','viewer')`, [leadId]);
    // each person's copy is written in their own language (the sender's choice if forced, else theirs)
    recipients = []; for (const p of rows) recipients.push({ partyId: p.id, name: p.name, email: p.email, language: (await languageFor(tx, { sendOptions: ld?.opts, party: p })).language });
  }
  // Run 7: a FORM response follows the form's own two email switches — the person's confirmation is their signed copy (left out when "Email the person a confirmation" is off), and the owner gets
  // one short "new response" notice (formNotice) instead of a second copy of every response.
  const form = await formFactsOf(tx, leadId);
  if (form && tst?.is_test !== true) {
    if (!form.confirmRespondent) recipients = recipients.filter((r) => r.partyId !== form.respondentPartyId);
    else if (form.respondentPartyId && !recipients.some((r) => r.partyId === form.respondentPartyId)) {   // the form's own switch wins over the workspace's "email the signed copy"
      const { rows: [p] } = await tx.query(`SELECT id, name, email, signer_language FROM keystone.document_party WHERE id = $1 AND email IS NOT NULL`, [form.respondentPartyId]);
      if (p) recipients.push({ partyId: p.id, name: p.name, email: p.email, language: (await languageFor(tx, { sendOptions: ld?.opts, party: p })).language });
    }
    copyEnabled = false;   // the sender (the owner) is not mailed a copy; the notice below is theirs
  }
  // when the workspace sends signed copies as links, the sender's own copy is a link too: it is issued against the first signer's row, as "share a download link" does
  // Run 9 Part 3.4 (R9-h): the sealed document's date and amount boxes go into the contract repository (idempotent; a person's correction is never overwritten)
  await readKeyDates(tx, { tenantId, instanceId });
  const ownerParty = (await tx.query(`SELECT id FROM keystone.document_party WHERE instance_id = $1 AND action_role IN ('signer','approver') ORDER BY position, created_at LIMIT 1`, [leadId])).rows[0]?.id ?? null;
  return { ownerPartyId: ownerParty, objectKey: stored.key, bucket: P.files.bucket(), sha256: digest, byteSize: pdf.bytes.length, reused, bytes: pdf.bytes, certificateBytes, title: instance.title, signatures, recipients, copyEnabled, leadId, downloadDays: Number(await getDocumentSetting(tx, "download.link_days")) || 0, pdf: true, language: certLanguage, formNotice: form?.notifyOwner ? { leadId } : null };
}

/** A form response's email switches, or null when the document is not a form response. */
async function formFactsOf(tx, leadId) {
  const { rows: [r] } = await tx.query(
    `SELECT t.form_settings AS s, (SELECT p.id FROM keystone.document_party p WHERE p.instance_id = i.id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1) AS party
       FROM keystone.document_instance i JOIN keystone.document_template t ON t.family_id = COALESCE(i.form_id, (SELECT x.family_id FROM keystone.document_template x WHERE x.id = i.template_id))
      WHERE i.id = $1 AND i.source_channel = 'form' ORDER BY t.version DESC LIMIT 1`, [leadId]);
  if (!r) return null;
  const s = r.s ?? {};
  return { notifyOwner: s.notifyOwner !== false, confirmRespondent: s.confirmRespondent !== false, respondentPartyId: r.party };
}
