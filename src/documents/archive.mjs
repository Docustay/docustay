// @ts-check
// P18.9 — THE EXECUTED-INSTRUMENT PDF ARCHIVE. WHERE P18.3 AND P18.4 STOP BEING UNCALLED MODULES.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE MEASUREMENT THAT MADE THIS FILE NECESSARY, AND IT IS THE SAME DEFECT P18.8 IS ABOUT.
//     [MEASURED 2026-09-14] `src/storage/s3.mjs` had **ZERO call sites outside itself**, and so did
//     `src/email/send.mjs`. Both had passing gates — 31 and 33 assertions — and neither was reachable
//     from anything a person could do. That is exactly F5's shape, which P18.8 names for the queue:
//     **a module with no producer passes every check and moves nothing.**
//   ★★ So "P18.2 COMPLETE (code)" and "P18.3 the module exists" were true statements about the wrong
//      thing. P18.9 asks for a REAL email and a REAL stored-and-retrieved PDF; neither is possible
//      through a module nothing calls, no matter how well tested it is.
//
// ★★★ THE PRODUCER IS THE OUTBOX, NOT THE ROUTE. `documents.document.executed` is already emitted, in
//     the same transaction as the state change (U26), by `executeInstance`. This archive runs as a
//     TOPIC HANDLER off that event, which buys three things a route call could not:
//       · the S3 upload and the PDF render happen OUTSIDE the execute transaction — a network call
//         inside a transaction holds a row lock for the length of somebody else's outage;
//       · a failure RETRIES with backoff (0040) instead of failing the signature the client just made;
//       · and the event is the audit record of why the archive exists.
//   ★ It also means the archive cannot be forgotten by a new caller: anything that executes an
//     instrument emits that topic, and the handler is registered once.
//
// ★★★ IDEMPOTENT BY CONSTRUCTION, BECAUSE RETRIES ARE NORMAL. A queue with backoff will re-run this.
//     The unique index `document_pdf_one_per_instance` plus `ON CONFLICT … DO UPDATE` means a re-run
//     converges on one row. ★ And the object key is DETERMINISTIC, so a re-run overwrites the same
//     object rather than accumulating orphans — a random key per attempt would leak one object per
//     retry and nothing would ever notice.

import { certificateLanguage } from "./signerLanguage.mjs";
import { createHash } from "node:crypto";
import { renderExecutedPdf } from "./pdf.mjs";
import { chromeInputsFor } from "./chromeInputs.mjs";
import { gatherCertificateFacts } from "./certificateFacts.mjs";
import { ports } from "./ports.mjs";
import { storageIsConfigured } from "../storage/s3.mjs";
import { notFound, invalid, dependency } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ sha256 of the exact bytes. Hex, lower case — the migration's CHECK enforces that shape. */
export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * ★★ READ EVERYTHING THE RENDERER NEEDS, IN ONE TRANSACTION, FROM THE SNAPSHOT.
 *
 * ★★★ FROM THE **SNAPSHOT**, NOT FROM THE LIVE TEMPLATE. §M0 LAW 3. An executed instrument quotes the
 *     terms and the price that were frozen when it was sent; re-reading the template would render
 *     today's terms onto a document somebody signed last month. `rendered_from` on the archive row
 *     records which object was used, so a future disagreement between two renderings is answerable.
 */
export async function loadInstanceForArchive(tx, { instanceId }) {
  const r = await run(tx, db
    .selectFrom("keystone.document_instance")
    .select(["id", "title", "state", "executed_at", "sent_at", "created_by", "original_sha256", "template_snapshot", "builder", "template_id"])
    .where("id", "=", instanceId)
    .where("archived_at", "is", null));
  if (r.rowCount === 0) throw notFound(`no document instance ${instanceId} is visible here`);
  const row = r.rows[0];

  // ★★ ONLY AN EXECUTED INSTRUMENT IS ARCHIVED, AND THE REFUSAL NAMES WHY. Archiving a `sent` draft
  //    would produce a PDF of an unsigned agreement that looks exactly like a signed one — the single
  //    most dangerous artefact this product could emit.
  if (row.state !== "executed") {
    throw invalid(
      `only an EXECUTED instrument is archived — ${instanceId} is "${row.state}". A PDF of an unsigned ` +
      `agreement is indistinguishable from a signed one once it leaves this system, which is why this ` +
      `is a refusal rather than a best effort.`);
  }
  if (!row.template_snapshot) {
    throw invalid(
      `document ${instanceId} is executed but has NO template_snapshot, so there is nothing to render ` +
      `from. ★ This is a data defect, not a rendering problem: §M0 LAW 3 requires the snapshot to be ` +
      `frozen at send time, and an executed row without one cannot be reproduced at all.`);
  }

  // ★ The signature rows are the parties. One row per party (P15C.7) — read them in signing order so
  //   the PDF's signature block matches the order the instrument was actually signed in.
  const sigs = await run(tx, db
    // ★ `mark_sha256` IS SELECTED because the renderer prints it — it is the digest of the mark the
    //   signer actually drew, and it is what lets a reader check the rendered signature against the
    //   stored one. Mapping a column I had not selected would have rendered `undefined` silently.
    // ★ `signer_uid` ADDED, 30 Sep 2026 — the "email the signed copy" brief's caller resolves each
    //   signer's email from it; a NULL uid is an in-person signer with no account, correctly skipped.
    .selectFrom("keystone.signature_record")
    .select(["role", "signer_name", "signer_order", "signed_at", "signed_local_date", "signer_timezone", "mark_sha256", "mark_image", "signer_ip", "user_agent", "signer_uid"])
    .where("instance_id", "=", instanceId)
    .orderBy("signer_order", "asc")
    .orderBy("signed_at", "asc"));

  return { instance: row, signatures: sigs.rows };
}

/**
 * ★★★ RENDER, UPLOAD, RECORD — IN THAT ORDER, AND THE ORDER IS THE SAFETY PROPERTY.
 *
 * The row is written LAST, after the bytes are actually in the object store. The alternative
 * (record-then-upload) produces a row that claims an object exists when it does not — and this project
 * has already paid for that shape once, in `notification_delivery`, where the fix was to write the
 * `attempted` row before the request. ★★ The two are not contradictory: for a DELIVERY the attempt
 * itself is the fact worth recording even if it fails. For an ARCHIVE the only fact worth recording is
 * that the bytes are retrievable, so the row must not exist until they are.
 *
 * @returns {{objectKey: string, bucket: string, sha256: string, byteSize: number, reused: boolean}}
 */
export async function archiveExecutedPdf(tx, { tenantId, instanceId }, { env = process.env } = {}) {
  if (!tenantId) throw invalid("archiveExecutedPdf needs a tenantId");
  if (!instanceId) throw invalid("archiveExecutedPdf needs an instanceId");

  // ★★ FAIL LOUD, NOT SILENTLY SKIP. Unlike email — where `skipped` is a legitimate recorded outcome
  //    because a practice may genuinely not have email configured — an executed instrument with no
  //    archive is a gap in the record of a signed agreement. If storage is unconfigured this THROWS,
  //    the event goes to `failed` with the reason, and the backoff retries it once storage exists.
  if (!storageIsConfigured(env)) {
    throw dependency(
      "object storage is not configured (KEYSTONE_S3_* are not all set), so this executed instrument " +
      "cannot be archived. ★ This is deliberately a FAILURE and not a skip: an executed agreement with " +
      "no archived rendering is a hole in the record, and the retry will close it once storage exists.");
  }

  const { instance, signatures } = await loadInstanceForArchive(tx, { instanceId });
  // QUEUE §23.4.8 — an uploaded document is the flattened original plus the certificate, not a drawing of the view
  if (instance.builder === "pdf") {
    const pa = await import("./pdfArchive.mjs");
    await pa.restampSealedCopy(tx, { tenantId, instanceId }).catch((e) => console.error(`restamp ${instanceId}: ${e.message}`));   // B-3: a copy sealed without a trusted timestamp gets one when the service answers; never blocks the archive
    return pa.archivePdfDocument(tx, { tenantId, instanceId, instance, signatures });
  }

  const snapshot = typeof instance.template_snapshot === "string"
    ? JSON.parse(instance.template_snapshot)
    : instance.template_snapshot;

  // ★ QUEUE §23 Part 2 — everything the document view needs, read here and handed in: the island's settings, the practice's brand (through the brand port), the logo bytes, the signers'
  //   emails (through the people port) and the Certificate of Completion facts. The renderer does no I/O of its own.
  const { settings, brand, logoBytes, zone, publicBase } = await chromeInputsFor(tx, { tenantId, templateId: instance.template_id });
  const P = await ports();
  const signerPeople = new Map((await P.people.byIds(tx, signatures.map((x) => x.signer_uid).filter(Boolean))).map((p) => [p.id, p]));
  const certificate = settings["certificate.enabled"] ? await gatherCertificateFacts(tx, { tenantId, instanceId, instance, signatures }) : null;
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

  const { rows: [sendOpt] } = await tx.query(`SELECT send_options AS opts FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  const certLanguage = await certificateLanguage(tx, { leadId: instanceId, sendOptions: sendOpt?.opts });
  const pdf = await renderExecutedPdf({
    snapshot,
    language: certLanguage,
    title: instance.title,
    // ★★★ AN ISO **STRING**, NOT THE `Date` pg HANDS BACK (the renderer checks the TYPE — a Date stringifies to the very text it asks for, which cost six worker retries on 14 Sep).
    executedAt: instance.executed_at instanceof Date ? instance.executed_at.toISOString() : String(instance.executed_at),
    // ★★★ THE FIELD NAMES ARE THE RENDERER'S, NOT THE TABLE'S. A wrong shape does not throw — it renders a plausible PDF with the evidence missing — so each name is mapped here, once.
    signatures: signatures.map((s) => ({
      role: s.role,
      signerName: s.signer_name,
      signedAt: iso(s.signed_at),
      signedLocalDate: s.signed_local_date,
      signerTimezone: s.signer_timezone,
      markSha256: s.mark_sha256,
      markImage: s.mark_image ?? null,
      signerEmail: signerPeople.get(s.signer_uid)?.email ?? null,
      signerIp: s.signer_ip ?? null,
    })),
    settings, brand, logoBytes, zone,
    documentId: instanceId, certificate, verifyUrl: publicBase ? `${publicBase}/verify` : null,
    originalSha256: instance.original_sha256 ?? null,
  });

  // ★★★ `renderExecutedPdf` RETURNS `{bytes, sha256, pages}` — NOT A BUFFER. [MEASURED from its own
  //     @returns and EXECUTED: my first version did `Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf)`,
  //     which fed the whole object to `Buffer.from` and threw *"The first argument must be of type
  //     string or an instance of Buffer … Received an instance of Object"* — an error that names
  //     Buffer's API and says nothing about the real mistake, which was assuming a return shape
  //     instead of reading it. Third time in this phase that assuming a shape cost a run.
  if (!pdf || !Buffer.isBuffer(pdf.bytes)) {
    throw invalid(
      `renderExecutedPdf did not return {bytes: Buffer} for ${instanceId} — got ` +
      `${pdf === null || pdf === undefined ? String(pdf) : Object.keys(pdf).join(", ")}. Refusing to ` +
      `archive something that is not the rendered document.`);
  }
  const body = pdf.bytes;
  if (body.length === 0) {
    throw invalid(`the renderer produced ZERO bytes for ${instanceId} — refusing to archive an empty PDF`);
  }
  // ★★ AND THE RENDERER'S OWN DIGEST MUST AGREE WITH OURS. It returns `sha256`; we compute one from the
  //    bytes we are about to upload. If those ever differ, something between the render and the upload
  //    altered the document — which is precisely what the archive exists to make impossible to miss.
  const rendererDigest = pdf.sha256;

  // ★★ DETERMINISTIC KEY, tenant-first (see objectKey's own note: it refuses traversal and puts the
  //    tenant at the front so a prefix rule can scope by tenant). A re-run overwrites the same object.
  // ★ `kind` is `executed_document` with an UNDERSCORE, not a hyphen: objectKey enforces
  //   /^[a-z][a-z0-9_]*$/ and a hyphen throws. [MEASURED — src/storage/s3.mjs:170] My first version of
  //   this line used a hyphen and would have failed on every archive, at the point where the fix looks
  //   like a storage problem rather than a two-character typo.
  const cfg = { bucket: P.files.bucket() };

  // ★★★ `putObject` DOES NOT THROW — IT RETURNS A DESCRIBED OUTCOME. [MEASURED — src/storage/s3.mjs:127]
  //     the module's own header says so explicitly, and the reason it does so is that a thrown storage
  //     error invites `catch {}`. So the result MUST be checked; `await putObject(...)` with no check is
  //     a silent success on every failure, and the archive row would then be written for bytes that
  //     never arrived. This is the one line that the ordering comment above depends on.
  // Run 9 Part 4.4 — through the files port, which seals the bytes with the workspace's own key before they reach the bucket. The port throws when the store refuses.
  let key;
  try { ({ key } = await P.files.put({ tenantId, id: instanceId, kind: "executed_document", bytes: body })); }
  catch (e) {
    throw dependency(
      `the object store refused the PDF for ${instanceId}, so NO archive row was written: ${e?.message ?? e}`);
  }

  const digest = sha256Hex(body);
  if (rendererDigest && rendererDigest !== digest) {
    throw dependency(
      `the PDF changed between rendering and upload for ${instanceId}: the renderer reported ` +
      `${String(rendererDigest).slice(0, 16)}… and the uploaded bytes hash to ${digest.slice(0, 16)}…`);
  }
  const r = await tx.query(
    `INSERT INTO keystone.document_pdf
       (tenant_id, instance_id, object_key, bucket, sha256, byte_size, rendered_from)
     VALUES ($1,$2,$3,$4,$5,$6,'template_snapshot')
     ON CONFLICT (tenant_id, instance_id) DO UPDATE
       SET object_key = EXCLUDED.object_key, bucket = EXCLUDED.bucket,
           sha256 = EXCLUDED.sha256, byte_size = EXCLUDED.byte_size,
           archived_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [tenantId, instanceId, key, cfg.bucket, digest, body.length]);

  return {
    objectKey: key, bucket: cfg.bucket, sha256: digest, byteSize: body.length,
    // ★ `xmax = 0` is Postgres's own answer to "did this INSERT actually insert, or did it update?".
    //   Reporting it means the caller can tell a first archive from a retry without guessing.
    reused: r.rows[0]?.inserted === false,
    // ★★★ FIX, 30 Sep 2026 ("email the signed copy" brief) — the caller (`archive_document_pdf`,
    //   src/queue/tasks.mjs) attaches this exact PDF to the signed-copy email. Returning the bytes
    //   here means the email attaches the SAME artefact just verified against the object store's own
    //   digest, above — never a second render that could disagree with what was actually archived.
    bytes: body,
    title: instance.title,
    signatures,
  };
}

/**
 * ★★★ RETRIEVE — AND VERIFY THE BYTES AGAINST THE RECORDED HASH.
 *
 * ★★ THE HASH CHECK IS THE WHOLE POINT OF THE RETRIEVE PATH. "Store and retrieve a real PDF" is
 *    satisfied by a 200 and some bytes — but a 200 and some bytes proves only that *something* came
 *    back. Comparing against the sha256 written at archive time is what makes it the SAME document.
 *  ★ A mismatch throws rather than serving. Serving a document whose bytes do not match what was
 *    archived is worse than serving nothing, because the reader has no way to tell.
 */
export async function fetchArchivedPdf(tx, { instanceId }, { env = process.env } = {}) {
  const r = await run(tx, db
    .selectFrom("keystone.document_pdf")
    .select(["object_key", "bucket", "sha256", "byte_size", "archived_at"])
    .where("instance_id", "=", instanceId));
  if (r.rowCount === 0) {
    throw notFound(
      `no archived PDF for document ${instanceId}. ★ Either it is not executed yet, or the archive job ` +
      `has not run — the two are different and the document's own state says which.`);
  }
  const rec = r.rows[0];

  // ★★ SAME RULE ON THE READ SIDE: `getObject` returns `{ok, status, error, body}` and never throws.
  //    A missing object comes back as `ok:false` with `body:null` — and `Buffer.from(null)` throws a
  //    TypeError, which would surface as an unrelated crash instead of "the object is gone".
  // Run 9 Part 4.4 — through the files port, which opens what it sealed. It throws when the object is missing or will not open.
  let body;
  try { body = await (await ports()).files.get({ key: rec.object_key }); }
  catch (e) {
    throw dependency(
      `the archive row for ${instanceId} names object "${rec.object_key}" but the object store did not ` +
      `return it: ${e?.message ?? "no body"}. ★ A row without its bytes is the worst state here — the ` +
      `record says a signed agreement was archived and it cannot be produced.`);
  }
  const digest = sha256Hex(body);
  if (digest !== rec.sha256) {
    throw dependency(
      `the archived PDF for ${instanceId} does NOT match its recorded hash — refusing to serve it. ` +
      `recorded ${rec.sha256.slice(0, 12)}…, retrieved ${digest.slice(0, 12)}…, ` +
      `${body.length} bytes vs ${rec.byte_size} recorded.`);
  }
  return { body, sha256: digest, byteSize: body.length, archivedAt: rec.archived_at,
           objectKey: rec.object_key };
}
