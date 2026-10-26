// Run 9 Part 4.4 — PER-WORKSPACE ENCRYPTION OF THE STORED DOCUMENT FILES.
//
// What is encrypted: every byte the Documents island hands the file port (src/ports/documentsFiles.mjs): uploaded PDFs, the converted copy, the sealed (signed) copy, the certificate, the
// printed templates, the chunks of a large upload. The bucket only ever holds ciphertext. What is NOT covered (and the Trust page says so): the database's own pages, the other the platform
// attachments (staff photos, brand logos, data exports) and anything before this ran until the re-encrypt job has been through it (see `reencryptFiles`).
//
// THE LAYERS (all AES-256-GCM, all through src/secrets/envelope.mjs for the key handling):
//   platform key (KEYSTONE_MASTER_KEY, outside the database)  →  seals each workspace's DATA KEY (purpose "workspace_file_key", AAD = workspace + purpose, one row in keystone.workspace_file_key)
//   workspace data key  →  encrypts each file, with a fresh 12-byte IV, and AAD = workspace + key number + the object's own path.
// So: a file copied to another workspace's path will not open (AAD names the workspace and path); a data key row copied into another workspace will not open (the seal's AAD names the workspace);
// rotating the platform key re-wraps a handful of small key rows and never touches a file; rotating a workspace's data key makes a new key active and the re-encrypt job moves the files.
//
// FILE LAYOUT:  "DSFE1\0\0\0" (8) | key number (u32, big-endian) | IV (12) | ciphertext | GCM tag (16).
// The sha256 the island records for a file is of the PLAINTEXT it was given (and is checked after this layer opens the file), so nothing the island knows changes.
//
// A file with no header is a legacy plaintext file from before this existed: it still opens (so nothing stored is lost), and `reencryptFiles` seals it. Set DOCUSTAY_REFUSE_PLAINTEXT_FILES=on
// once the job has finished everywhere and a plaintext file in the bucket is then refused instead of served.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sealSecret, openSecret, CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
import { withTenant } from "../db/index.mjs";
import { getObject, putObject, listTenantObjects } from "./s3.mjs";

const ALG = "aes-256-gcm";
const MAGIC = Buffer.from("DSFE1\0\0\0", "latin1");
const HEAD = MAGIC.length + 4 + 12;
const TAG = 16;
const PURPOSE = "workspace_file_key";
const KEY_TTL_MS = 5 * 60_000;
const KEY_TENANT_RE = /^t\/([0-9a-f-]{36})\//i;
export const FILE_KINDS = Object.freeze(["document_file", "executed_document"]);

export class FileOpenError extends Error {
  constructor(key) { super(`could not open the stored file ${key}`); this.name = "FileOpenError"; }
}

const sha = (b) => createHash("sha256").update(b).digest("hex");
const tenantOf = (key) => { const m = typeof key === "string" ? KEY_TENANT_RE.exec(key) : null; if (!m) throw new Error(`file key ${JSON.stringify(key)} is not in the t/{tenantId}/… shape objectKey() makes`); return m[1].toLowerCase(); };
const aadFor = (tenantId, keyNo, key) => Buffer.from(`docustay:file:v1:${tenantId}:${keyNo}:${key}`, "utf8");
export const isSealedFile = (b) => Buffer.isBuffer(b) && b.length >= HEAD + TAG && b.subarray(0, MAGIC.length).equals(MAGIC);
const refusePlaintext = (env = process.env) => String(env.DOCUSTAY_REFUSE_PLAINTEXT_FILES ?? "").toLowerCase() === "on";

// ── the workspace's keys ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map();   // `${tenantId}:${keyNo}` → { dek, at } · `${tenantId}:active` → { keyNo, at }
export function forgetFileKeys() { for (const v of cache.values()) v.dek?.fill?.(0); cache.clear(); }
const fresh = (e) => e && Date.now() - e.at < KEY_TTL_MS;

async function openRow(tenantId, row) {
  const b64 = openSecret(row.secret_envelope, { tenantId, purpose: PURPOSE, kekVersion: row.kek_version });
  const dek = Buffer.from(b64, "base64");
  if (dek.length !== 32) throw new Error("the workspace file key has the wrong length");
  return dek;
}

/** The key new files are sealed with. Makes the workspace's first key the first time it is asked (two racing writers: the loser reads the winner's row). */
export async function activeFileKey(tenantId) {
  const hit = cache.get(`${tenantId}:active`);
  if (fresh(hit)) { const k = cache.get(`${tenantId}:${hit.keyNo}`); if (fresh(k)) return { keyNo: hit.keyNo, dek: k.dek }; }
  const row = await withTenant(tenantId, async (tx) => {
    let { rows: [r] } = await tx.query(`SELECT key_no, secret_envelope, kek_version FROM keystone.workspace_file_key WHERE status = 'active'`);
    if (r) return r;
    const dek = randomBytes(32);
    const env = sealSecret({ plaintext: dek.toString("base64"), tenantId, purpose: PURPOSE });
    dek.fill(0);
    await tx.query(`INSERT INTO keystone.workspace_file_key (tenant_id, key_no, status, secret_envelope, kek_version, secret_fingerprint)
      VALUES ($1, (SELECT COALESCE(max(key_no), 0) + 1 FROM keystone.workspace_file_key), 'active', $2::jsonb, $3, $4) ON CONFLICT DO NOTHING`, [tenantId, JSON.stringify(env), CURRENT_KEK_VERSION, env.fingerprint]);
    ({ rows: [r] } = await tx.query(`SELECT key_no, secret_envelope, kek_version FROM keystone.workspace_file_key WHERE status = 'active'`));
    return r;
  });
  if (!row) throw new Error("the workspace's file key could not be made");
  const dek = await openRow(tenantId, row);
  cache.set(`${tenantId}:${row.key_no}`, { dek, at: Date.now() }); cache.set(`${tenantId}:active`, { keyNo: row.key_no, at: Date.now() });
  return { keyNo: row.key_no, dek };
}

/** One named key (any status — an older file may still be on a retiring or retired key). */
async function fileKey(tenantId, keyNo) {
  const hit = cache.get(`${tenantId}:${keyNo}`);
  if (fresh(hit)) return hit.dek;
  const row = await withTenant(tenantId, async (tx) => (await tx.query(`SELECT key_no, secret_envelope, kek_version FROM keystone.workspace_file_key WHERE key_no = $1`, [keyNo])).rows[0]);
  if (!row) throw new Error("no such workspace file key");
  const dek = await openRow(tenantId, row);
  cache.set(`${tenantId}:${keyNo}`, { dek, at: Date.now() });
  return dek;
}

// ── one file ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** @param {{key:string, bytes:Buffer}} a  `key` is the object's own path (objectKey()); it is part of what the tag covers. */
export async function sealFile({ key, bytes }) {
  if (!Buffer.isBuffer(bytes)) throw new Error("sealFile: bytes must be a Buffer");
  const tenantId = tenantOf(key);
  const { keyNo, dek } = await activeFileKey(tenantId);
  const iv = randomBytes(12), c = createCipheriv(ALG, dek, iv);
  c.setAAD(aadFor(tenantId, keyNo, key));
  const ct = Buffer.concat([c.update(bytes), c.final()]);
  const no = Buffer.alloc(4); no.writeUInt32BE(keyNo);
  return Buffer.concat([MAGIC, no, iv, ct, c.getAuthTag()]);
}

/** @returns {Promise<{bytes:Buffer, sealed:boolean, keyNo:number|null}>} a legacy plaintext file comes back as it is, `sealed:false`. One error for every way a sealed file can fail to open. */
export async function openFile({ key, bytes }, { env = process.env } = {}) {
  if (!isSealedFile(bytes)) {
    if (refusePlaintext(env)) throw new FileOpenError(key);
    return { bytes, sealed: false, keyNo: null };
  }
  try {
    const tenantId = tenantOf(key), keyNo = bytes.readUInt32BE(MAGIC.length);
    const dek = await fileKey(tenantId, keyNo);
    const d = createDecipheriv(ALG, dek, bytes.subarray(MAGIC.length + 4, HEAD));
    d.setAAD(aadFor(tenantId, keyNo, key)); d.setAuthTag(bytes.subarray(bytes.length - TAG));
    return { bytes: Buffer.concat([d.update(bytes.subarray(HEAD, bytes.length - TAG)), d.final()]), sealed: true, keyNo };
  } catch { throw new FileOpenError(key); }
}

// ── rotation and the re-encrypt job ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Make a new data key active; the old one stays readable ('retiring') until `reencryptFiles` has moved every file off it. */
export async function rotateFileKey(tenantId) {
  const out = await withTenant(tenantId, async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`file_key:${tenantId}`]);
    const { rows: [old] } = await tx.query(`SELECT key_no FROM keystone.workspace_file_key WHERE status = 'active'`);
    if (old) await tx.query(`UPDATE keystone.workspace_file_key SET status = 'retiring' WHERE key_no = $1`, [old.key_no]);
    const dek = randomBytes(32);
    const env = sealSecret({ plaintext: dek.toString("base64"), tenantId, purpose: PURPOSE });
    dek.fill(0);
    const { rows: [n] } = await tx.query(`INSERT INTO keystone.workspace_file_key (tenant_id, key_no, status, secret_envelope, kek_version, secret_fingerprint)
      VALUES ($1, (SELECT COALESCE(max(key_no), 0) + 1 FROM keystone.workspace_file_key), 'active', $2::jsonb, $3, $4) RETURNING key_no`, [tenantId, JSON.stringify(env), CURRENT_KEK_VERSION, env.fingerprint]);
    return { keyNo: n.key_no, previous: old?.key_no ?? null };
  });
  forgetFileKeys();
  return out;
}

/**
 * Move every stored file of one workspace onto its active key: legacy plaintext files are sealed, files on an older key are re-sealed. Safe to run twice and to stop part-way (each file is
 * replaced whole, in one put, with the same path). A file that changed while it was being moved is left alone and counted — the next pass takes it. Old keys are marked 'retired' only when a
 * full pass found nothing on them, and only once the active key has been in use longer than the key cache lives (so no process is still writing under an older one).
 * @returns {{scanned:number, sealedLegacy:number, moved:number, current:number, changed:number, failed:string[], retired:number}}
 */
export async function reencryptFiles(tenantId, { listKeys = listTenantObjects, get = getObject, put = putObject, limit = Infinity } = {}) {
  const out = { scanned: 0, sealedLegacy: 0, moved: 0, current: 0, changed: 0, failed: [], retired: 0 };
  const { keyNo: active } = await activeFileKey(tenantId);
  let complete = true;
  for (const kind of FILE_KINDS) {
    const l = await listKeys({ tenantId, kind });
    if (!l.ok) { out.failed.push(`list ${kind}: ${l.error}`); complete = false; continue; }
    for (const key of l.keys) {
      if (out.scanned >= limit) { complete = false; break; }
      out.scanned += 1;
      try {
        const first = await get({ key });
        if (!first.ok || !first.body) throw new Error(first.error ?? "no body");
        const body = Buffer.from(first.body);
        if (isSealedFile(body) && body.readUInt32BE(MAGIC.length) === active) { out.current += 1; continue; }
        const was = isSealedFile(body);
        const { bytes } = await openFile({ key, bytes: body }, { env: {} });
        const again = await get({ key });
        if (!again.ok || sha(Buffer.from(again.body)) !== sha(body)) { out.changed += 1; complete = false; continue; }   // somebody replaced it while we worked
        const r = await put({ key, body: await sealFile({ key, bytes }), contentType: "application/octet-stream" });
        if (!r.ok) throw new Error(r.error ?? `put ${r.status}`);
        const back = await get({ key });
        if (!back.ok || !isSealedFile(Buffer.from(back.body))) throw new Error("the sealed copy did not read back");
        if (was) out.moved += 1; else out.sealedLegacy += 1;
      } catch (e) { out.failed.push(`${key}: ${String(e?.message ?? e).slice(0, 120)}`); complete = false; }
    }
  }
  if (complete && out.failed.length === 0) {
    out.retired = await withTenant(tenantId, async (tx) => {
      await tx.query(`UPDATE keystone.workspace_file_key SET files_sealed_at = now() WHERE status = 'active' AND key_no = $1`, [active]);
      return (await tx.query(
        `UPDATE keystone.workspace_file_key SET status = 'retired', retired_at = now()
          WHERE status = 'retiring' AND EXISTS (SELECT 1 FROM keystone.workspace_file_key a WHERE a.status = 'active' AND a.created_at < now() - interval '10 minutes')`)).rowCount;
    });
  }
  return out;
}

/** Workspaces whose active key has not yet been through a complete pass (new, rotated, or a pass that failed) — what the startup job has to look at. */
export async function tenantsNeedingSealPass(tenantIds) {
  const out = [];
  for (const tenantId of tenantIds) {
    const r = await withTenant(tenantId, async (tx) => (await tx.query(`SELECT files_sealed_at FROM keystone.workspace_file_key WHERE status = 'active'`)).rows[0]);
    if (!r || !r.files_sealed_at) out.push(tenantId);
  }
  return out;
}

/** A read-only health check used after a restore and by the proof: open up to `limit` stored files and say whether each opens. Writes nothing. */
export async function verifyStoredFiles(tenantId, { limit = 20, listKeys = listTenantObjects, get = getObject } = {}) {
  const out = { checked: 0, opened: 0, plaintext: 0, failed: [] };
  for (const kind of FILE_KINDS) {
    const l = await listKeys({ tenantId, kind });
    if (!l.ok) { out.failed.push(`list ${kind}: ${l.error}`); continue; }
    for (const key of l.keys) {
      if (out.checked >= limit) return out;
      out.checked += 1;
      try {
        const g = await get({ key }); if (!g.ok || !g.body) throw new Error(g.error ?? "no body");
        const r = await openFile({ key, bytes: Buffer.from(g.body) }, { env: {} });
        if (r.sealed) out.opened += 1; else out.plaintext += 1;
      } catch (e) { out.failed.push(`${key}: ${e?.name === "FileOpenError" ? "does not open" : String(e?.message ?? e).slice(0, 80)}`); }
    }
  }
  return out;
}
