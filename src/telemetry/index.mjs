// ★★ TELEMETRY — SCREEN VIEWS AND FLOW STEPS, FOR EVIDENCE-BASED ANALYSIS
// Separate from the outbox: these are high-volume UI events, not auditable business facts.

/**
 * Record a screen view. Cheap, fail-silent, no subject/actor validation.
 * @param tx       a pg client inside the caller's transaction
 * @param tenantId the tenant id (from GUC)
 * @param appUserId the app_user id (null if anonymous)
 * @param path    the screen path (e.g. "/people", "/accounts/123")
 */
export async function recordScreenView(tx, { tenantId, appUserId, path }) {
  try {
    await tx.query(
      `INSERT INTO keystone.telemetry_event (tenant_id, app_user_id, kind, path)
       VALUES ($1, $2, 'screen_view', $3)`,
      [tenantId, appUserId ?? null, path]);
  } catch (err) {
    // ★ Fail silent: telemetry write failures never interrupt user work. Log it if debugging.
    if (process.env.DEBUG_TELEMETRY) console.error('[telemetry] recordScreenView failed:', err.message);
  }
}

/**
 * Record a flow step (e.g. "step 1 of onboarding", "merge confirmation dialog opened").
 * Cheap, fail-silent, no validation.
 * @param tx       a pg client inside the caller's transaction
 * @param tenantId the tenant id (from GUC)
 * @param appUserId the app_user id (null if anonymous)
 * @param path    context/flow path (e.g. "/onboarding/checklist")
 * @param detail  optional object, e.g. { step: 2, total: 5, action: "completed" }
 */
export async function recordFlowStep(tx, { tenantId, appUserId, path, detail = null }) {
  try {
    await tx.query(
      `INSERT INTO keystone.telemetry_event (tenant_id, app_user_id, kind, path, detail)
       VALUES ($1, $2, 'flow_step', $3, $4)`,
      [tenantId, appUserId ?? null, path, detail ? JSON.stringify(detail) : null]);
  } catch (err) {
    if (process.env.DEBUG_TELEMETRY) console.error('[telemetry] recordFlowStep failed:', err.message);
  }
}
