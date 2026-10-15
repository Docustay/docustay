// Stage 18 task 18.4 — OPERATOR ACCESS REQUESTS. The new support access flow.
//
// ★★★ OPERATOR-ONLY (PLATFORM NAMESPACE): These routes admit a platform operator to ask
// for temporary access to a specific practice, and end that access early. The operator
// is gated through `handlePlatformRequest` imported directly from `../paths/index.mjs`.
// Each route opens `withTenant` for the target practice's own rows (§C9 rule (ii)).
//
// Callers: `askForAccess` and `endMyAccess` from `src/platform/accessRequests.mjs` (18.3),
// which handle the emits, notifications and audit writes. This file owns the route layer only.

import { invalid, forbidden, notFound } from "../http/errors.mjs";
import { withTenant } from "../db/index.mjs";
import { callerIsPlatform } from "../db/index.mjs";
import { askForAccess, endMyAccess } from "../platform/accessRequests.mjs";
import { handlePlatformRequest } from "../paths/index.mjs";

export function registerPlatformGrantAccessRoutes(app) {
  /**
   * ★ Wrapper to verify platform operator context, using the practice-less chain.
   *   Same shape as 11.20's `operatorRead`: `handlePlatformRequest` resolves the session
   *   and applies the one question — does the live operator grant exist.
   */
  const operatorRoute = (fn, status = 200) => async (c) => {
    try {
      return await handlePlatformRequest({ sessionId: c.get("principal")?.sessionId }, async (db) => {
        if (!(await callerIsPlatform(db))) throw forbidden("refused: no_operator_grant");
        return fn(c, db);
      }).then((result) => c.json(result, status));
    } catch (err) {
      throw err;
    }
  };

  // ───────────────────────────────────────────────────────────────────────────────────────
  // POST /api/platform/practices/:tenantId/access-requests — ASK FOR ACCESS
  // ───────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/platform/practices/:tenantId/access-requests", operatorRoute(async (c, db) => {
    const tenantId = c.req.param("tenantId");
    const body = await c.req.json().catch(() => ({}));
    const { why, durationMinutes } = body;

    if (!tenantId) throw invalid("tenantId is required");
    if (!why) throw invalid("why is required");
    if (!durationMinutes) throw invalid("durationMinutes is required");

    // Verify tenantId is a UUID of a non-platform tenant in platform_list_tenants()
    const { rows: tenants } = await db.query("SELECT id, is_platform FROM keystone.platform_list_tenants()");
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant || tenant.is_platform) {
      throw notFound("no such practice");
    }

    // Get the operator's grant id from the GUC set by handlePlatformRequest
    const { rows: grantRows } = await db.query("SELECT current_setting('keystone.operator_grant_id') AS id");
    const operatorGrantId = grantRows[0]?.id;

    return askForAccess({ tenantId, operatorGrantId, why, durationMinutes });
  }, 201));

  // ───────────────────────────────────────────────────────────────────────────────────────
  // POST /api/platform/practices/:tenantId/access/end — END MY ACCESS
  // ───────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/platform/practices/:tenantId/access/end", operatorRoute(async (c, db) => {
    const tenantId = c.req.param("tenantId");

    if (!tenantId) throw invalid("tenantId is required");

    // Get the operator's grant id from the GUC set by handlePlatformRequest
    const { rows: grantRows } = await db.query("SELECT current_setting('keystone.operator_grant_id') AS id");
    const operatorGrantId = grantRows[0]?.id;

    return endMyAccess({ tenantId, operatorGrantId });
  }));
}
