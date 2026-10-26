// @ts-check
/**
 * COMPETITOR WATCH — Stage 16 task 16.13. Manual-entered observations about competitor activity.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ BOTH FUNCTIONS TAKE `tx`, NOT A POOL, AND THAT IS THE CONTRACT — the same one `emit()`
 *     enforces (P15B.2a). A watch entry created outside the dispatcher's transaction survives a
 *     rollback of the event that created it, leaving a row with no audit trail to who made it.
 *     `entered_by` lives on the row, so the entry's source is verifiable; breaking that here would
 *     leave it unverifiable.
 *
 * ★★ RECORD EMITS AN EVENT. This is an audit trail: "who saw what about competitors, and when".
 *    The event topic is 'run.competitor.watch_recorded', subject is null (tenant-level, not tied to
 *    a specific record), payload carries `kind` only — never names, notes or observations themselves.
 */

import { emit } from "../events/outbox.mjs";
import { withTenant } from "../db/index.mjs";
import { db, run } from "../db/kysely.mjs";

/**
 * Record an observation of competitor activity (e.g. "they run ads on your name").
 *
 * @param tx           the transaction client
 * @param tenantId     the owning tenant
 * @param competitorName  the competitor name (trimmed, 1-120 chars)
 * @param kind         the observation type (closed enum: 'ads_on_your_name')
 * @param note         optional observation (max 500 chars)
 * @param enteredBy    uuid of the app_user who made this observation, or null for system
 * @returns {Promise<{id: string}>} the inserted row's id
 */
export async function recordCompetitorWatch(tx, {
  tenantId, competitorName, kind, note = null, enteredBy = null,
}) {
  if (!tenantId) throw new Error("recordCompetitorWatch needs a tenantId");
  if (!competitorName || !String(competitorName).trim()) {
    throw new Error("recordCompetitorWatch needs a non-empty competitorName");
  }
  if (!kind) throw new Error("recordCompetitorWatch needs a kind");

  const { rows } = await run(tx, db
    .insertInto("keystone.run_competitor_watch")
    .values({
      tenant_id: tenantId ?? null,
      competitor_name: String(competitorName).trim() ?? null,
      kind: kind ?? null,
      note: note ?? null,
      source: "manual",
      entered_by: enteredBy ?? null,
    })
    .returning(["id"]));

  const id = rows[0].id;

  // ★★ Emit the audit event. Payload carries ONLY `kind`, not the name or note (privacy rule: events
  //    carry IDs and safe facts only, never typed text — spec 02 §2).
  await emit(tx, {
    tenantId,
    topic: "run.competitor.watch_recorded",
    emittedBy: "run",
    subjectType: null,
    subjectId: null,
    payload: { kind },
  });

  return { id };
}

/**
 * List competitor watch entries for a tenant, within the last N days.
 *
 * @param tx         the transaction client
 * @param tenantId   the owning tenant
 * @param sinceDays  how many days back to include (default 90)
 * @returns {Promise<Array>} rows ordered by observed_at descending
 */
export async function listCompetitorWatch(tx, {
  tenantId, sinceDays = 90,
}) {
  if (!tenantId) throw new Error("listCompetitorWatch needs a tenantId");

  const { rows } = await tx.query(
    `SELECT id, tenant_id, competitor_name, kind, note, source, entered_by, observed_at, created_at
       FROM keystone.run_competitor_watch
      WHERE tenant_id = $1
        AND observed_at >= now() - (interval '1 day' * $2)
      ORDER BY observed_at DESC`,
    [tenantId, sinceDays]);

  return rows;
}

/**
 * ★ Platform route wrapper for recordCompetitorWatch. Opens a withTenant transaction to the
 * target tenant so a platform operator can record observations for any practice.
 * Called from POST /api/platform/run/competitor-watch with body {tenantId, competitorName, kind, note}.
 */
export async function recordCompetitorWatchForTenant({
  tenantId, competitorName, kind, note, enteredBy,
}) {
  if (!tenantId) throw new Error("recordCompetitorWatchForTenant needs a tenantId");
  return withTenant(tenantId, (db) =>
    recordCompetitorWatch(db, { tenantId, competitorName, kind, note, enteredBy })
  );
}
