#!/usr/bin/env node
// Run 9 Part 4.4 — the operator's view of the per-workspace file keys. Needs what the app needs: the database URL, the object store (KEYSTONE_S3_*) and KEYSTONE_MASTER_KEY.
//   node scripts/file-keys.mjs status                 every workspace: its keys and whether the sealing pass has completed
//   node scripts/file-keys.mjs seal [tenantId]        seal / move the stored files (the same pass the worker runs at start); prints the counts
//   node scripts/file-keys.mjs rotate <tenantId>      make a new data key active for the workspace, then move its files onto it
//   node scripts/file-keys.mjs verify <tenantId> [n]  open up to n stored files (default 20) and say whether each opens — run it after a restore
// Self-hosted: docker compose exec app node docustay/entrypoint.mjs run scripts/file-keys.mjs status
import pg from "pg";
import { withTenant } from "../src/db/index.mjs";
import { rotateFileKey, reencryptFiles, verifyStoredFiles } from "../src/storage/fileCrypto.mjs";
import { storageIsConfigured } from "../src/storage/s3.mjs";

const [cmd, a, b] = process.argv.slice(2);
if (!cmd || !["status", "seal", "rotate", "verify"].includes(cmd)) { console.error("usage: file-keys.mjs status | seal [tenantId] | rotate <tenantId> | verify <tenantId> [n]"); process.exit(2); }
if (cmd !== "status" && !storageIsConfigured()) { console.error("object storage is not configured (KEYSTONE_S3_* are not all set)"); process.exit(2); }
const listTenants = async () => {
  const url = process.env.KEYSTONE_WORKER_DATABASE_URL || process.env.KEYSTONE_DATABASE_URL;
  const c = new pg.Client({ connectionString: url, ssl: process.env.KEYSTONE_DB_SSL === "off" ? false : undefined }); await c.connect();
  try { return (await c.query(`SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`)).rows.map((r) => r.tenant_id); } finally { await c.end(); }
};
const need = (id) => { if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) { console.error("a workspace id (uuid) is required"); process.exit(2); } return id; };
try {
  if (cmd === "status") {
    for (const tenantId of await listTenants()) {
      const rows = (await withTenant(tenantId, (tx) => tx.query(`SELECT key_no, status, kek_version, files_sealed_at, created_at FROM keystone.workspace_file_key ORDER BY key_no`))).rows;
      console.log(`${tenantId}  ${rows.length ? rows.map((r) => `#${r.key_no} ${r.status}${r.status === "active" ? (r.files_sealed_at ? " (all files sealed)" : " (files not yet all sealed)") : ""}`).join(", ") : "no key yet (no file stored)"}`);
    }
  } else if (cmd === "seal") {
    for (const tenantId of a ? [need(a)] : await listTenants()) console.log(tenantId, JSON.stringify(await reencryptFiles(tenantId)));
  } else if (cmd === "rotate") {
    const tenantId = need(a), r = await rotateFileKey(tenantId);
    console.log(`new key #${r.keyNo} is active (previous: ${r.previous ?? "none"}); moving the files…`);
    console.log(JSON.stringify(await reencryptFiles(tenantId)));
  } else {
    const r = await verifyStoredFiles(need(a), { limit: Number(b) || 20 });
    console.log(JSON.stringify(r));
    if (r.failed.length) process.exit(1);
  }
  process.exit(0);
} catch (e) { console.error(String(e?.message ?? e)); process.exit(1); }
