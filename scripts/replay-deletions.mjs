#!/usr/bin/env node
// scripts/replay-deletions.mjs — RUN THIS AFTER RESTORING A DATABASE BACKUP (Round 3, 10 Oct 2026).
// A restore rewinds the database, so anyone deleted since the backup would come back. Every deletion Docustay carries out leaves one small entry in the platform deletion ledger in object storage (a SHA-256 of the address or a workspace id, never a name),
// and that ledger is NOT part of the database a restore rewinds. This script reads it and carries out again every deletion whose person or workspace has reappeared.
//   node scripts/replay-deletions.mjs            list what would be done (changes nothing)
//   node scripts/replay-deletions.mjs --apply    do it
// Needs the same environment as the app (KEYSTONE_DATABASE_URL and the storage settings, plus the Firebase credentials on a hosted install). Safe to run twice: whatever is already gone is reported and skipped.
import { withTenant } from "../src/db/index.mjs";
import { getLedgerEntry, listLedgerEntries, storageIsConfigured } from "../src/storage/s3.mjs";
import * as deletion from "../src/product/deletion.mjs";
import { erasePerson } from "../src/documents/frontDoor.mjs";
import { installHostDocumentsPorts } from "../src/ports/documents.mjs";

const apply = process.argv.includes("--apply");
if (!process.env.KEYSTONE_DATABASE_URL) { console.error("This script needs the app's environment (database login, storage, master key). On a self-hosted install run it as:\n  docker compose exec app node docustay/entrypoint.mjs run scripts/replay-deletions.mjs [--apply]\nOn a hosted install run it with the same environment variables as the app."); process.exit(2); }
if (!storageIsConfigured()) { console.error("Object storage is not configured here, so the ledger cannot be read. Set the storage variables the app uses and run again."); process.exit(2); }
const listed = await listLedgerEntries();
if (!listed.ok) { console.error(`Could not list the ledger: ${listed.error}`); process.exit(2); }
console.log(`${listed.keys.length} ledger entr${listed.keys.length === 1 ? "y" : "ies"}${apply ? "" : " (dry run — nothing will be changed; add --apply to do it)"}`);
const tally = { gone: 0, replayed: 0, wouldReplay: 0, failed: 0 };

async function personId(tenantId, hash) {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(`SELECT id, email FROM keystone.app_user WHERE tenant_id = $1 AND lifecycle_status <> 'former' AND email NOT LIKE '%@deleted.invalid'`, [tenantId]);
    return rows.find((r) => deletion.emailHash(r.email) === hash)?.id ?? null;
  });
}
async function tenantExists(tenantId) {
  // an error here is an error, never "gone": reporting a person as already deleted because the database could not be read is the one mistake this script must not make
  return withTenant(tenantId, async (tx) => (await tx.query(`SELECT 1 FROM keystone.tenant WHERE id = $1`, [tenantId])).rowCount === 1);
}
async function replay(entry) {
  if (!(await tenantExists(entry.tenantId))) return "gone";
  let subject = null;
  if (entry.kind === "account") { subject = await personId(entry.tenantId, entry.emailHash); if (!subject) return "gone"; }
  if (!apply) return "would";
  const req = await withTenant(entry.tenantId, async (tx) => {
    const { rows: [r] } = await tx.query(`INSERT INTO keystone.deletion_request (tenant_id, kind, subject_user_id, requested_by, requested_at, scheduled_for) VALUES ($1,$2,$3,$3,now() - interval '1 minute', now() - interval '1 second') RETURNING id`, [entry.tenantId, entry.kind, subject]);
    return r.id;
  });
  const done = await withTenant(entry.tenantId, (tx) => deletion.runRequest(tx, { tenantId: entry.tenantId, requestId: req, documents: { erasePerson } }));
  await deletion.afterCommit(done, { ledger: async () => true });   // the entry already exists; do not write another
  return "replayed";
}

installHostDocumentsPorts();
for (const key of listed.keys) {
  const g = await getLedgerEntry({ key });
  let entry; try { entry = JSON.parse(g.body.toString("utf8")); } catch { console.log(`  ?  ${key} — unreadable, skipped`); tally.failed += 1; continue; }
  if (!g.ok || entry?.v !== 1 || !["account", "workspace"].includes(entry.kind) || !/^[0-9a-f-]{36}$/.test(String(entry.tenantId))) { console.log(`  ?  ${key} — not a ledger entry this version understands, skipped`); tally.failed += 1; continue; }
  try {
    const r = await replay(entry);
    console.log(`  ${r === "gone" ? "·" : r === "would" ? "→" : "✓"}  ${entry.kind} ${entry.at.slice(0, 10)} ${r === "gone" ? "already gone" : r === "would" ? "has come back — would be deleted again" : "deleted again"}`);
    if (r === "gone") tally.gone += 1; else if (r === "would") tally.wouldReplay += 1; else tally.replayed += 1;
  } catch (e) { console.log(`  ✗  ${key} — ${e.message}`); tally.failed += 1; }
}
console.log(`already gone ${tally.gone} · ${apply ? `deleted again ${tally.replayed}` : `would delete again ${tally.wouldReplay}`} · problems ${tally.failed}`);
process.exit(tally.failed ? 1 : 0);
