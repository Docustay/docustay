// Stage 18 task 18.8 — Support view server (PlatViewingAs data).
//
// ★★★ THE PLATFORM CHAIN, NO INJECTED DEPS (C-NEW-1).
// This route imports `handlePlatformRequest` from `../paths/index.mjs` and `callerIsPlatform`
// from `../db/index.mjs` the way 11.20's `operatorRead` does, wraps its one route in that,
// asks the single question `if (!(await callerIsPlatform(db))) throw forbidden(…)`, and calls
// **no** `tenantIsPlatform` and **no** `authoriseSection` (§C9 rule (i) — there is no nav path
// check on the platform chain, because there is no practice to authorise a section in).
//
// SECTIONS: home (counts), billing (workbench_subscription), money (getSettings filtered).
// Each section is read-only and can never carry a note body.

import { forbidden, invalid, notFound, unauthenticated } from "../http/errors.mjs";
import { withTenant } from "../db/index.mjs";
import { callerIsPlatform } from "../db/index.mjs";
import { liveAccessFor } from "../platform/accessRequests.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { getSettings } from "../settings/writes.mjs";
import { handlePlatformRequest } from "../paths/index.mjs";
import { assertNoNoteFields } from "../platform/redact.mjs";

/**
 * Register the support view route.
 * GET /api/platform/practices/:tenantId/look?section=home|money|billing
 * Returns one read-only section of a practice the operator was allowed into.
 * Writes that read to the practice's audit log.
 * Can never carry a note body (18.8b's nullNoteBodies wraps the response).
 */
export function registerPlatformSupportViewRoutes(app) {
  /**
   * Wrapper to verify platform operator context, using the practice-less chain.
   * Same shape as 11.20's `operatorRead`: `handlePlatformRequest` resolves the session
   * and applies the one question — does the live operator grant exist.
   */
  const operatorRoute = (fn, { status = 200 } = {}) => (c) =>
    handlePlatformRequest({ sessionId: c.get("principal")?.sessionId }, async (db) => {
      if (!(await callerIsPlatform(db))) throw forbidden("refused: no_operator_grant");
      return fn(c, db);
    }).then((result) => c.json(result, status));

  // ───────────────────────────────────────────────────────────────────────────────────────
  // GET /api/platform/practices/:tenantId/look — SUPPORT VIEW ONE SECTION
  // ───────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/platform/practices/:tenantId/look", operatorRoute(async (c, db) => {
    const tenantId = c.req.param("tenantId");
    const section = c.req.query("section");

    if (!tenantId) throw invalid("tenantId is required");
    if (!section) throw invalid("section is required");

    const validSections = ["home", "money", "billing"];
    if (!validSections.includes(section)) throw invalid("section must be one of: home, money, billing");

    // Extract the operator grant ID from the principal
    const operatorGrantId = c.get("principal")?.operatorGrantId;
    if (!operatorGrantId) throw forbidden("refused: no_operator_grant");

    // Inside withTenant for the target practice, check if the operator has live access
    return withTenant(tenantId, async (tx) => {
      // Check if this operator has a live grant for this practice
      const live = await liveAccessFor(tx, { tenantId, operatorGrantId });

      if (!live) {
        // Never approved — 403
        throw forbidden("They haven't said yes. Ask from their record.");
      }

      // Fetch practice data for the response and for error messages
      const { rows: practiceRows } = await tx.query(
        `SELECT id, name FROM keystone.tenant WHERE id = $1`,
        [tenantId]
      );
      const practice = practiceRows[0];
      if (!practice) throw notFound("practice not found");

      if (new Date(live.expiresAt) <= new Date()) {
        // Expired — 401
        const endedAtDate = new Date(live.expiresAt);
        const endedAtTime = endedAtDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        throw unauthenticated(`Your hour inside ${practice.name} is up — it ended at ${endedAtTime}.`);
      }

      // Get the workbench_subscription for billing section
      const { rows: subRows } = await tx.query(
        `SELECT plan_key, status, trial_ends_at, seat_count, seat_limit, updated_at
         FROM keystone.workbench_subscription WHERE tenant_id = $1`,
        [tenantId]
      );
      const subscription = subRows[0];

      // Build the response based on section
      let data = {};

      if (section === "home") {
        // Count clients (adult/adolescent role)
        const { rows: clientRows } = await tx.query(
          `SELECT count(*) as count FROM keystone.app_user
           WHERE tenant_id = $1 AND role IN ('client:adult', 'client:adolescent')`,
          [tenantId]
        );

        // Count staff
        const { rows: staffRows } = await tx.query(
          `SELECT count(*) as count FROM keystone.app_user
           WHERE tenant_id = $1 AND role = 'staff'`,
          [tenantId]
        );

        // Count open invoices
        const { rows: invoiceRows } = await tx.query(
          `SELECT count(*) as count FROM keystone.invoice_effective
           WHERE tenant_id = $1 AND status = 'open'`,
          [tenantId]
        );

        // Sum payments succeeded this month
        const { rows: paymentRows } = await tx.query(
          `SELECT sum(amount_minor) as total FROM keystone.payment_effective
           WHERE tenant_id = $1 AND status = 'succeeded'
           AND created_at >= date_trunc('month', now())`,
          [tenantId]
        );

        data = {
          clients: parseInt(clientRows[0]?.count || 0),
          staff: parseInt(staffRows[0]?.count || 0),
          openInvoices: parseInt(invoiceRows[0]?.count || 0),
          processedThisMonthMinor: parseInt(paymentRows[0]?.total || 0),
        };
      } else if (section === "billing") {
        // Return workbench_subscription fields
        data = subscription ? {
          planKey: subscription.plan_key,
          status: subscription.status,
          trialEndsAt: subscription.trial_ends_at,
          seatCount: subscription.seat_count,
          seatLimit: subscription.seat_limit,
          updatedAt: subscription.updated_at,
        } : null;
      } else if (section === "money") {
        // Get all settings and filter to money.* and invoices.*
        const allSettings = await getSettings(tx);
        data = Object.fromEntries(
          Object.entries(allSettings).filter(([key]) =>
            key.startsWith("money.") || key.startsWith("invoices.")
          )
        );
      }

      // Get the practice currency for the response
      const { rows: currencyRows } = await tx.query(
        `SELECT value FROM keystone.tenant_setting
         WHERE tenant_id = $1 AND key = 'money.currency'`,
        [tenantId]
      );
      const currency = currencyRows[0]?.value || "USD";

      // Get the list of page views (support.page_viewed audit entries) since this grant was answered
      const { rows: auditRows } = await tx.query(
        `SELECT at, object
         FROM keystone.audit_entry
         WHERE tenant_id = $1
           AND action = 'support.page_viewed'
           AND actor_operator_grant_id = $2
           AND at >= $3
         ORDER BY at DESC`,
        [tenantId, operatorGrantId, live.answeredAt]
      );

      // Write the audit entry for this view
      await writeAudit(tx, {
        tenantId,
        action: "support.page_viewed",
        object: `support_view.${section}`,
        actorOperatorGrantId: operatorGrantId,
        reason: live.why,
      });

      // Build the practice object
      const practiceObj = {
        name: practice.name,
        currency,
      };

      // For home section, add the counts to practice object as shown in the example
      if (section === "home") {
        practiceObj.clients = data.clients;
        practiceObj.staff = data.staff;
        practiceObj.processedThisMonthMinor = data.processedThisMonthMinor;
      }

      // Build and return the payload
      const payload = {
        practice: practiceObj,
        cameFor: live.why,
        endsAt: live.expiresAt,
        answeredAt: live.answeredAt,
        section,
        data,
        opened: auditRows.map((r) => ({ at: r.at, object: r.object })),
      };

      // Wrap with assertNoNoteFields (18.8's guard) and nullNoteBodies (18.8b's guard)
      // The return expression wraps this object in nullNoteBodies inside assertNoNoteFields
      // 18.8b owns the nullNoteBodies call; this task just wraps in assertNoNoteFields
      return assertNoNoteFields(payload);
    });
  }));
}
