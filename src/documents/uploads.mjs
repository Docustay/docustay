// src/documents/uploads.mjs — A RESUMABLE UPLOAD IN NUMBERED PARTS (QUEUE §23.4.1; migration 0607). The application takes at most 1 MiB per request, so a file of up to 100 MB travels as parts of at most 768 KiB:
//   start({name,size,sha256?}) → {uploadId, partBytes, parts} · putPart(uploadId, n, bytes) · status(uploadId) → which parts arrived · complete(uploadId) → the draft document (files.mjs `acceptUpload`).
// ★ Resuming is just asking `status` and sending the parts that are missing. Parts are stored through the `files` port; the file is joined, its length and (when the page sent one) SHA-256 checked, and only then is it read.
// ★ A part is addressed by its number, so re-sending the same part is harmless (the same object is overwritten). A part over the size, or out of range, is refused.

import { invalid, notFound, conflict } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { uploadCapMb } from "./uploadLimit.mjs";
import { acceptUpload, acceptAttachment, sha256Hex } from "./files.mjs";

export const PART_BYTES = 768 * 1024;

async function load(tx, uploadId) {
  const { rows: [u] } = await tx.query(`SELECT * FROM keystone.document_upload WHERE id = $1`, [uploadId]);
  if (!u) throw notFound("no such upload");
  return u;
}
const partCount = (u) => Math.ceil(Number(u.size_bytes) / u.part_bytes);

export async function startUpload(tx, { tenantId, actorUserId = null, name, size, sha256 = null, packageLeadId = null, attachTo = null }) {
  const P = await ports();
  if (!P.files.configured()) throw invalid("File storage is not set up here, so documents cannot be uploaded yet.", { code: "no_storage" });
  if (typeof name !== "string" || !name.trim()) throw invalid("the file needs a name", { field: "name" });
  if (!Number.isInteger(size) || size <= 0) throw invalid("the file is empty", { field: "size", code: "empty" });
  const maxMb = await uploadCapMb(tx, { tenantId });
  if (size > maxMb * 1024 * 1024) throw invalid(`That file is ${(size / 1048576).toFixed(1)} MB; the most that can be uploaded is ${maxMb} MB.`, { field: "size", code: "too_big", maxMb });
  if (sha256 !== null && !/^[0-9a-f]{64}$/.test(sha256)) throw invalid("sha256 must be 64 hex characters", { field: "sha256" });
  const { rows: [u] } = await tx.query(
    `INSERT INTO keystone.document_upload (tenant_id, created_by, name, size_bytes, part_bytes, sha256, package_lead_id, attach_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [tenantId, actorUserId, name.trim().slice(0, 255), size, PART_BYTES, sha256, packageLeadId, attachTo]);
  return { uploadId: u.id, partBytes: PART_BYTES, partCount: Math.ceil(size / PART_BYTES) };
}

export async function uploadStatus(tx, { uploadId }) {
  const u = await load(tx, uploadId);
  return { uploadId, status: u.status, size: Number(u.size_bytes), partBytes: u.part_bytes, partCount: partCount(u), received: Object.keys(u.parts).map(Number).sort((a, b) => a - b), instanceId: u.instance_id };
}

export async function putPart(tx, { tenantId, uploadId, n, bytes }) {
  const u = await load(tx, uploadId);
  if (u.status !== "open") throw conflict("this upload is already finished");
  const total = partCount(u);
  if (!Number.isInteger(n) || n < 1 || n > total) throw invalid(`part ${n} is out of range (this file has ${total} parts)`, { field: "n" });
  const expected = n < total ? u.part_bytes : Number(u.size_bytes) - u.part_bytes * (total - 1);
  if (bytes.length !== expected) throw invalid(`part ${n} should be ${expected} bytes and is ${bytes.length}`, { field: "n", code: "part_size" });
  const P = await ports();
  const { key } = await P.files.put({ tenantId, id: `${uploadId}-${n}`, bytes });
  await tx.query(`UPDATE keystone.document_upload SET parts = jsonb_set(parts, ARRAY[$2], $3::jsonb), updated_at = now() WHERE id = $1`, [uploadId, String(n), JSON.stringify({ key, size: bytes.length })]);
  return { received: n, of: total };
}

/** Join the parts, check them, and start the draft. The parts are deleted afterwards (failures to delete are not failures of the upload). */
export async function completeUpload(tx, { tenantId, actorUserId = null, uploadId, title = null }) {
  const u = await load(tx, uploadId);
  if (u.status === "complete" && u.instance_id) return { alreadyComplete: true, instanceId: u.instance_id };
  if (u.status !== "open") throw conflict("this upload was abandoned");
  const total = partCount(u);
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !u.parts[String(n)]);
  if (missing.length) throw invalid(`${missing.length} part${missing.length === 1 ? " is" : "s are"} still missing — send ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""} and try again`, { code: "parts_missing", missing });
  const P = await ports();
  const chunks = [];
  for (let n = 1; n <= total; n += 1) chunks.push(await P.files.get({ key: u.parts[String(n)].key }));
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== Number(u.size_bytes)) throw invalid("the parts do not add up to the size announced", { code: "size_mismatch" });
  if (u.sha256 && sha256Hex(bytes) !== u.sha256) throw invalid("The file arrived damaged (its fingerprint does not match). Please upload it again.", { code: "hash_mismatch" });
  // ★ §23.5.4 — an upload started "for" a draft becomes one of its extra files, not a new document
  const result = u.attach_to
    ? { ...(await acceptAttachment(tx, { tenantId, actorUserId, instanceId: u.attach_to, name: u.name, bytes })), instanceId: u.attach_to, attached: true }
    : await acceptUpload(tx, { tenantId, actorUserId, name: u.name, bytes, title });
  await tx.query(`UPDATE keystone.document_upload SET status = 'complete', instance_id = $2, parts = '{}'::jsonb, updated_at = now() WHERE id = $1`, [uploadId, result.instanceId]);
  for (const p of Object.values(u.parts)) await P.files.delete({ key: p.key }).catch(() => {});
  return result;
}


