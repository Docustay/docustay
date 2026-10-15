// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PERSON ATTACHMENTS — FILE STORAGE TIED TO A PERSON RECORD.
//
// ★★★ MIRRORS `src/documents/archive.mjs`'s PATTERN: read an unverified id, verify it exists
//     in the tenant, compute the storage key via `objectKey()`, call `putObject`/getObject`/
//     `deleteObject` on the S3 storage layer. Store/retrieve/soft-delete the row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { objectKey, putObject, getObject, deleteObject, storageIsConfigured } from "../storage/s3.mjs";
import { notFound, invalid, dependency } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★ VERIFY THE PERSON EXISTS IN THIS TENANT, using the same check every other module uses:
 *   zero-rowCount = 404. Composite FK prevents a name outside the tenant; RLS handles row-level.
 */
async function ensurePersonExists(tx, { tenantId, personId }) {
  const r = await tx.query(
    "SELECT id FROM keystone.app_user WHERE id = $1 AND tenant_id = $2",
    [personId, tenantId]
  );
  if (r.rowCount === 0) throw notFound(`person ${personId} is not visible here`);
}

/**
 * ★★ LIST ATTACHMENTS. Excludes soft-deleted rows (deleted_at IS NOT NULL).
 * @returns {Promise<Array>} Array of {id, filename, contentType, sizeBytes, uploadedBy, createdAt}
 */
export async function listAttachments(tx, { tenantId, personId }) {
  await ensurePersonExists(tx, { tenantId, personId });

  const r = await tx.query(
    `SELECT
       id, filename, content_type, size_bytes, uploaded_by, created_at
       FROM keystone.person_attachment
      WHERE tenant_id = $1 AND person_id = $2 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [tenantId, personId]
  );

  return r.rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  }));
}

/**
 * ★★★ CREATE ATTACHMENT. Upload the file to storage, then record the row. Order is critical:
 *     RENDER, UPLOAD, RECORD. The row is written LAST, after bytes are in the store.
 *
 * @param {object} tx - transaction
 * @param {object} opts - {tenantId, personId, filename, contentType, fileBuffer, actorUserId}
 * @returns {Promise<object>} {id, filename, sizeBytes, uploadedBy, createdAt}
 */
export async function createAttachment(tx, {
  tenantId, personId, filename, contentType, fileBuffer, actorUserId
}, { env = process.env } = {}) {
  // ★ Fail loud if storage is not configured — a file uploaded with no storage is lost.
  if (!storageIsConfigured(env)) {
    throw dependency(
      "object storage is not configured (KEYSTONE_S3_* are not all set), so this attachment " +
      "cannot be stored. ★ This is deliberately a FAILURE and not a skip: a file the caller " +
      "just uploaded and then discarded silently is data loss with no audit trail."
    );
  }

  await ensurePersonExists(tx, { tenantId, personId });

  // ★ Validate inputs — filename is required, content-type and size are advisory.
  if (!filename || typeof filename !== "string") {
    throw invalid("filename is required and must be a string");
  }
  if (fileBuffer && !Buffer.isBuffer(fileBuffer)) {
    throw invalid("fileBuffer must be a Buffer");
  }

  // ★★ DETERMINISTIC KEY — re-uploads of the same attachment id overwrite the same object.
  //    kind is `person_attachment` with underscores (objectKey enforces /^[a-z][a-z0-9_]*$/).
  const attachmentId = crypto.randomUUID();
  const key = objectKey({ tenantId, kind: "person_attachment", id: attachmentId });

  // ★★★ putObject DOES NOT THROW — it returns a described outcome.
  const put = await putObject(
    { key, body: fileBuffer, contentType: contentType || "application/octet-stream" },
    { env }
  );
  if (!put.ok) {
    throw dependency(
      `the object store refused the attachment for ${personId}, so NO row was written: ${put.error}`
    );
  }

  const sizeBytes = fileBuffer ? fileBuffer.length : 0;

  // ★ Record the attachment in the database, now that bytes are safely stored.
  const r = await run(tx, db
    .insertInto("keystone.person_attachment")
    .values({
      id: attachmentId ?? null,
      tenant_id: tenantId ?? null,
      person_id: personId ?? null,
      storage_key: key ?? null,
      filename: filename ?? null,
      content_type: contentType ?? null,
      size_bytes: sizeBytes ?? null,
      uploaded_by: actorUserId ?? null,
    })
    .returning(["id", "filename", "content_type", "size_bytes", "uploaded_by", "created_at"])
  );

  const row = r.rows[0];
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

/**
 * ★★ DELETE ATTACHMENT. Soft-delete: sets deleted_at, does not call deleteObject.
 *    An archived file is recoverable the way every other record here is.
 *
 * @param {object} tx - transaction
 * @param {object} opts - {tenantId, id, actorUserId}
 * @returns {Promise<object>} {id}
 */
export async function deleteAttachment(tx, { tenantId, id, actorUserId }) {
  const r = await tx.query(
    `UPDATE keystone.person_attachment
       SET deleted_at = now()
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [tenantId, id]
  );

  if (r.rowCount === 0) {
    throw notFound(`attachment ${id} is not visible here or is already deleted`);
  }

  return { id: r.rows[0].id };
}

/**
 * ★ RETRIEVE ATTACHMENT. Read metadata and fetch bytes from storage.
 */
export async function getAttachment(tx, { tenantId, id }, { env = process.env } = {}) {
  const r = await tx.query(
    `SELECT id, person_id, storage_key, filename, content_type, size_bytes
       FROM keystone.person_attachment
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, id]
  );

  if (r.rowCount === 0) {
    throw notFound(`attachment ${id} is not visible here`);
  }

  const row = r.rows[0];

  // ★★ Same rule as documents/archive.mjs: getObject returns a described outcome, never throws.
  const got = await getObject({ key: row.storage_key }, { env });
  if (!got.ok || got.body === null) {
    throw dependency(
      `the attachment row for ${id} names object "${row.storage_key}" but the object store ` +
      `did not return it: ${got.error ?? "no body"}. ★ A row without its bytes is the worst ` +
      `state — the record says a file was stored and it cannot be produced.`
    );
  }

  return {
    id: row.id,
    personId: row.person_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
    body: got.body,
  };
}
