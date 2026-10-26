// src/secrets/rewrap.mjs — Stage 9 task 9.12 (06 §6, CT-063). The keyring RE-WRAP job.
//
// ★★★ THE POINT: `KEYSTONE_MASTER_KEY` can be rotated (move the old value to
//     `KEYSTONE_MASTER_KEY_PREVIOUS`, set a new current one) at any moment — but every row already
//     sealed stays wrapped under the OLD key until something re-wraps it. `keystone_meta.kek_version`
//     (0212) records which key is which; THIS file is what actually moves rows from one to the other.
//     Without it, "the master key can be rotated" is a claim nobody can act on.
//
// ★★ THE TWO STORING TABLES (MEASURED 21 Sep 2026 — see STAGE-9-PLAN.md task 9.12 field 3):
//     `keystone.webhook_endpoint` (`secret_envelope`, purpose `webhook_hmac`, fingerprint column
//     `secret_fingerprint`, plus `secret_rotated_at` to stamp) and `keystone.google_identity`
//     (`refresh_envelope`, purpose `google_refresh_token`, fingerprint column `token_fingerprint`,
//     no rotated-at column of its own). Both already carry `kek_version smallint NOT NULL DEFAULT 1`.
//     Both tables sit INSIDE the ordinary tenant RLS regime (0047, 0057) and `app_rw` already holds
//     SELECT/INSERT/UPDATE/DELETE on both — no new grant is needed for the per-row re-wrap itself.
//
// ★★★ RESUMABLE AND IDEMPOTENT, BY DESIGN, NOT BY LUCK. `rewrapSecrets` re-seals up to `limit` rows
//     in the SAME transaction the caller opened (its `tx`) and returns as soon as that batch commits.
//     Calling it again finds only what is STILL at `fromVersion` — a row already moved to `toVersion`
//     is invisible to the next call's own `WHERE kek_version = fromVersion`. So: call it with a small
//     `limit`, in a loop, each call its own `withTenant(...)` transaction (one transaction per small
//     batch — the caller decides how small; `limit: 1` gives literally one transaction per row, which
//     is what `test/kek_rewrap.test.mjs`'s "interrupt after the first row" case exercises). A crash
//     mid-batch rolls the WHOLE open transaction back — nothing is left half-written, and nothing is
//     ever double-wrapped, because a row that never reached `toVersion` is picked straight back up.
//
// ★ THE PLAINTEXT NEVER TOUCHES THE DATABASE OR A LOG LINE. `openSecret` → `sealSecret` happens
//   entirely in memory, per row; only the new envelope (ciphertext, never plaintext) and the new
//   `kek_version` are written back. Callers (the queue task, once registered — see the note at the
//   bottom of this file) must log only the counts and the version numbers, never a row's payload.
//
// ★★ QUEUE REGISTRATION (F622 follow-up, closed). `rewrapSecrets` is called by the `rewrap_secrets`
//    task (field 4's own name) registered in `src/queue/tasks.mjs`'s `TASK_LIST`, with a matching
//    `JOB_POLICY` entry added in the same pass to `src/queue/jobPolicy.mjs` — both together, so
//    `policeTaskList` (`src/queue/jobPolicy.mjs:474-482`) never sees one without the other (it THROWS
//    AT IMPORT if `TASK_LIST` names a task `JOB_POLICY` does not). See `src/queue/tasks.mjs`'s
//    `rewrap_secrets` task for the orchestration: enumerate tenants via
//    `keystone_auth.list_active_tenant_ids()`, sweep each with `withTenant(...)`, call
//    `retireKekVersion` only after every enumerated tenant confirms zero rows remain at `fromVersion`.
//
// ★★ RETIREMENT'S WRITE PATH (F622 follow-up, closed). `db/migrations/0212_kek_version.sql`'s own
//    header says task 9.12 "adds its own SECURITY DEFINER function and its own narrow EXECUTE grant
//    when it is built, the same pattern `keystone_meta.worker_beat()` and `keystone_meta.alert_transition()`
//    already use" — because `app_rw` holds only SELECT on `keystone_meta.kek_version` (0212), on
//    purpose (0212: "nothing here grants any role INSERT/UPDATE/DELETE"). `db/migrations/0217_kek_rewrap.sql`
//    now adds `keystone_meta.retire_kek_version(p_version smallint) RETURNS boolean` — SECURITY
//    DEFINER, REVOKE ALL FROM PUBLIC then GRANT EXECUTE TO app_worker only — mirroring
//    `keystone_meta.worker_beat()` (`db/migrations/0127_a_worker_that_stopped_must_be_visible_from_outside.sql:13-20`)
//    and `keystone_meta.alert_transition()` exactly. `retireKekVersion` below calls it by that name.
//    NOT APPLIED YET — the migration is written, not run (BUILD-PROCESS.md; migrations apply at step 3).

import { openSecret, sealSecret, CURRENT_KEK_VERSION } from "./envelope.mjs";

/** ★ The two storing tables, and nothing else — CT-062's closed purpose list decides what "secret"
 *   means; these are the only two tables today whose rows carry a `kek_version` (MEASURED). Adding a
 *   third later (Stage 8's `totp_factor`/`backup_code`, per STAGE-9-PLAN.md task 9.12 field 6's own
 *   REFRESH note) means adding a row here, not inventing a second sweep function. */
export const REWRAP_TABLES = Object.freeze([
  Object.freeze({
    table: "keystone.webhook_endpoint",
    envelopeColumn: "secret_envelope",
    fingerprintColumn: "secret_fingerprint",
    purpose: "webhook_hmac",
    // ★ webhook_endpoint alone carries a rotation timestamp (0047) — stamped on every re-wrap.
    extraSetSql: "secret_rotated_at = now()",
  }),
  Object.freeze({
    table: "keystone.google_identity",
    envelopeColumn: "refresh_envelope",
    fingerprintColumn: "token_fingerprint",
    purpose: "google_refresh_token",
    extraSetSql: null,
  }),
  // QUEUE §23.3.4 — the Documents island's secrets (an organisation's SMTP password) re-seal with the same job.
  Object.freeze({
    table: "keystone.mail_secret",
    envelopeColumn: "secret_envelope",
    fingerprintColumn: "secret_fingerprint",
    purpose: "document_smtp_password",
    extraSetSql: null,
  }),
  // shared document engine — a workspace's own AI provider key re-seals with the same job.
  Object.freeze({
    table: "keystone.document_ai_secret",
    envelopeColumn: "secret_envelope",
    fingerprintColumn: "secret_fingerprint",
    purpose: "document_ai_key",
    extraSetSql: null,
  }),
  // Run 9 Part 4.4 — a workspace's data key for its stored document files re-seals with the same job; the files themselves are not touched (that is the point of an envelope).
  Object.freeze({
    table: "keystone.workspace_file_key",
    envelopeColumn: "secret_envelope",
    fingerprintColumn: "secret_fingerprint",
    purpose: "workspace_file_key",
    extraSetSql: null,
  }),
]);

const DEFAULT_BATCH_LIMIT = 200;

/**
 * ★★★ THE JOB. `tx` is an already-open, tenant-scoped connection (the same shape every task in
 *     `src/queue/tasks.mjs` passes around after opening `withTenant(tenantId, ...)`) — RLS restricts
 *     every SELECT/UPDATE issued here to that one tenant's rows, exactly like every other write in
 *     this codebase. Re-wraps up to `limit` rows PER TABLE still at `fromVersion`, moves them to
 *     `toVersion`, and returns the per-table counts. Never touches a row already at `toVersion`.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}> }} tx
 * @param {{ fromVersion: number, toVersion?: number, limit?: number }} opts
 * @returns {Promise<{ webhookEndpoint: number, googleIdentity: number }>}
 */
export async function rewrapSecrets(tx, { fromVersion, toVersion = CURRENT_KEK_VERSION, limit = DEFAULT_BATCH_LIMIT } = {}) {
  if (!tx || typeof tx.query !== "function") throw new Error("rewrapSecrets: tx must expose query()");
  if (fromVersion == null) throw new Error("rewrapSecrets: fromVersion is required");
  if (fromVersion === toVersion) {
    throw new Error(`rewrapSecrets: fromVersion and toVersion must differ (both ${fromVersion})`);
  }
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("rewrapSecrets: limit must be a positive integer");

  const counts = { webhookEndpoint: 0, googleIdentity: 0, documentSecret: 0, documentAiSecret: 0, workspaceFileKey: 0 };
  const outputKey = { "keystone.webhook_endpoint": "webhookEndpoint", "keystone.google_identity": "googleIdentity", "keystone.mail_secret": "documentSecret", "keystone.document_ai_secret": "documentAiSecret", "keystone.workspace_file_key": "workspaceFileKey" };

  for (const cfg of REWRAP_TABLES) {
    counts[outputKey[cfg.table]] = await rewrapOneTable(tx, cfg, { fromVersion, toVersion, limit });
  }
  return counts;
}

/** ★ One storing table's share of the work. Loops row by row so a `SecretOpenError` on row N (a
 *   missing/wrong `KEYSTONE_MASTER_KEY_PREVIOUS`, most likely) throws immediately, leaving every row
 *   before N re-sealed **in this same call's transaction** and every row from N onward untouched —
 *   the caller's transaction then rolls the whole batch back (field 7: "nothing is half-written"). */
async function rewrapOneTable(tx, { table, envelopeColumn, fingerprintColumn, purpose, extraSetSql }, { fromVersion, toVersion, limit }) {
  const { rows } = await tx.query(
    `SELECT id, tenant_id, ${envelopeColumn} AS envelope FROM ${table} WHERE kek_version = $1 ORDER BY id LIMIT $2`,
    [fromVersion, limit]
  );

  let rewrapped = 0;
  for (const row of rows) {
    // ★ Never logged, never returned — the plaintext lives only in these two local variables, for the
    //   width of one row's re-seal, and is overwritten by the next loop iteration (V8 does not scrub
    //   strings deterministically, but nothing here ever prints, stores or forwards this value).
    const plaintext = openSecret(row.envelope, { tenantId: row.tenant_id, purpose, kekVersion: fromVersion });
    const resealed = sealSecret({ plaintext, tenantId: row.tenant_id, purpose });

    const setClauses = [`${envelopeColumn} = $1`, `kek_version = $2`, `${fingerprintColumn} = $3`];
    const params = [JSON.stringify(resealed), toVersion, resealed.fingerprint];
    if (extraSetSql) setClauses.push(extraSetSql);
    params.push(row.id);

    await tx.query(`UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
    rewrapped += 1;
  }
  return rewrapped;
}

/**
 * ★ Marks `version` retired. **Never call this until the caller has itself confirmed — tenant by
 *   tenant, through the same RLS-scoped reads `rewrapSecrets` uses — that zero rows remain at that
 *   version across every tenant it knows about.** This function does not re-verify that; it trusts
 *   its caller, exactly the way `keystone_meta.worker_beat()` trusts the worker process that calls it.
 *   "Retirement is never early" (field 7) is therefore a property of the CALLER'S sweep completing in
 *   full before this is ever invoked, not a property this one write can enforce by itself.
 * ★ `keystone_meta.retire_kek_version` is the SECURITY DEFINER function `db/migrations/0217_kek_rewrap.sql`
 *   adds (F622 follow-up), EXECUTE-granted to `app_worker` only — see the file header. NOT APPLIED YET:
 *   the migration is written, not run (BUILD-PROCESS.md; migrations apply at step 3), so calling this
 *   against a database that has not run 0217 will fail with an undefined-function error until it does.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}> }} pg
 * @param {{ version: number }} opts
 * @returns {Promise<boolean>} whether this call retired the version (false if already retired).
 */
export async function retireKekVersion(pg, { version }) {
  if (!pg || typeof pg.query !== "function") throw new Error("retireKekVersion: pg must expose query()");
  if (version == null) throw new Error("retireKekVersion: version is required");
  const { rows } = await pg.query(`SELECT keystone_meta.retire_kek_version($1) AS retired`, [version]);
  return rows[0]?.retired === true;
}
