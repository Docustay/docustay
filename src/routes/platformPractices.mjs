// Stage 18 task 18.11 — Practice facts: Overview, Practices list and Practice record routes.
//
// ★★★ THE PLATFORM CHAIN, NO INJECTED DEPS (C-NEW-1).
// This routes file imports `handlePlatformRequest` from `../paths/index.mjs` and `callerIsPlatform`
// from `../db/index.mjs` the way 11.20's `operatorRead` does. It asks the single question
// `if (!(await callerIsPlatform(db))) throw forbidden(…)`, and calls **no** `tenantIsPlatform`,
// **no** `authoriseSection` (§C9 rule (i) — there is no nav path check on the platform chain).
//
// Each route handler returns `assertNoNoteFields(<the payload>)` to prove the response contains
// no note fields. These are cross-tenant reads under RLS (withTenant per practice).

import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { handlePlatformRequest } from "../paths/index.mjs";
import { callerIsPlatform, withTenant } from "../db/index.mjs";
import { assertNoNoteFields } from "../platform/redact.mjs";
import { practiceFacts } from "../platform/practiceFacts.mjs";

/**
 * Register the platform practices routes.
 * - GET /api/platform/overview — Overview screen data
 * - GET /api/platform/practices — Practices list with filtering
 * - GET /api/platform/practices/:tenantId — One practice record
 */
export function registerPlatformPracticesRoutes(app) {
  /**
   * Wrapper to verify platform operator context, using the practice-less chain.
   * Same shape as 18.8's `operatorRoute`: `handlePlatformRequest` resolves the session
   * and applies the one question — does the live operator grant exist.
   */
  const operatorRoute = (fn, { status = 200 } = {}) => (c) =>
    handlePlatformRequest({ sessionId: c.get("principal")?.sessionId }, async (db) => {
      if (!(await callerIsPlatform(db))) throw forbidden("refused: no_operator_grant");
      return fn(c, db);
    }).then((result) => c.json(result, status));

  // ───────────────────────────────────────────────────────────────────────────────────────
  // GET /api/platform/overview — OVERVIEW SCREEN: top practices + totals
  // ───────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/platform/overview", operatorRoute(async (c, db) => {
    // Fetch all real (non-sandbox) practices from the platform list
    const { rows: tenantRows } = await db.query(
      `SELECT id, slug, name, timezone, status, is_platform FROM keystone.platform_list_tenants()`
    );

    // Compute facts for each real practice (isReal = not platform, not sandbox, not reference)
    const practicesWithFacts = [];
    for (const tenantRow of tenantRows) {
      const facts = await withTenant(tenantRow.id, async (tx) =>
        practiceFacts(tenantRow, tx)
      );
      if (facts.isReal) {
        practicesWithFacts.push(facts);
      }
    }

    // Sort by creation date, newest first, max 50
    const practices = practicesWithFacts
      .sort((a, b) => new Date(b.since) - new Date(a.since))
      .slice(0, 50);

    // Compute totals
    const count = practices.length;
    const joinedThisMonth = practices.filter(
      (p) => new Date(p.since) >= new Date(new Date().setDate(1))
    ).length;

    // MRR (monthly recurring revenue) of active practices (not trialing)
    const mrrMinor = practices
      .filter((p) => p.status === "active" && p.plan.status !== "trialing")
      .reduce((sum, p) => sum + (p.plan.monthlyMinor || 0), 0);

    // Total processed this month
    const processedThisMonthMinor = practices.reduce(
      (sum, p) => sum + p.processedThisMonthMinor,
      0
    );

    // Count of practices needing looking
    const needsLooking = practices.filter((p) => p.needsLooking).length;

    const result = {
      practices,
      totals: {
        count,
        joinedThisMonth,
        mrrMinor,
        processedThisMonthMinor,
        needsLooking,
      },
    };

    return assertNoNoteFields(result);
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────
  // GET /api/platform/practices — PRACTICES LIST WITH FILTERING AND SEARCH
  // ───────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/platform/practices", operatorRoute(async (c, db) => {
    const view = c.req.query("view") || "all";
    const q = (c.req.query("q") || "").toLowerCase();

    // Validate view parameter
    const validViews = ["all", "live", "trialling", "needs", "gone"];
    if (!validViews.includes(view)) {
      throw invalid(`view must be one of: ${validViews.join(", ")}`);
    }

    // Fetch all real practices
    const { rows: tenantRows } = await db.query(
      `SELECT id, slug, name, timezone, status, is_platform FROM keystone.platform_list_tenants()`
    );

    // Compute facts for each real practice
    const practicesWithFacts = [];
    for (const tenantRow of tenantRows) {
      const facts = await withTenant(tenantRow.id, async (tx) =>
        practiceFacts(tenantRow, tx)
      );
      if (facts.isReal) {
        practicesWithFacts.push(facts);
      }
    }

    // Filter by view
    let filtered = practicesWithFacts;
    if (view === "live") {
      filtered = filtered.filter(
        (p) => p.status === "active" && p.plan.status !== "trialing"
      );
    } else if (view === "trialling") {
      filtered = filtered.filter((p) => p.plan.status === "trialing");
    } else if (view === "needs") {
      filtered = filtered.filter((p) => p.needsLooking);
    } else if (view === "gone") {
      filtered = filtered.filter((p) => p.state === "Gone");
    }

    // Filter by search query (name or slug)
    if (q) {
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
      );
    }

    // Count each view category
    const allCount = practicesWithFacts.length;
    const liveCount = practicesWithFacts.filter(
      (p) => p.status === "active" && p.plan.status !== "trialing"
    ).length;
    const triallingCount = practicesWithFacts.filter(
      (p) => p.plan.status === "trialing"
    ).length;
    const needsCount = practicesWithFacts.filter((p) => p.needsLooking).length;
    const goneCount = practicesWithFacts.filter((p) => p.state === "Gone").length;

    const result = {
      practices: filtered,
      counts: {
        all: allCount,
        live: liveCount,
        trialling: triallingCount,
        needs: needsCount,
        gone: goneCount,
      },
    };

    return assertNoNoteFields(result);
  }));

  // ───────────────────────────────────────────────────────────────────────────────────────
  // GET /api/platform/practices/:tenantId — PRACTICE RECORD WITH TROUBLE HISTORY
  // ───────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/platform/practices/:tenantId", operatorRoute(async (c, db) => {
    const tenantId = c.req.param("tenantId");

    if (!tenantId) throw invalid("tenantId is required");

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) throw notFound("practice not found");

    // Fetch the practice from platform list
    const { rows: tenantRows } = await db.query(
      `SELECT id, slug, name, timezone, status, is_platform FROM keystone.platform_list_tenants()
       WHERE id = $1`,
      [tenantId]
    );

    if (tenantRows.length === 0) throw notFound("practice not found");
    const tenantRow = tenantRows[0];

    // Get practice facts (must run within withTenant)
    const facts = await withTenant(tenantId, async (tx) =>
      practiceFacts(tenantRow, tx)
    );

    // Check if it's a real practice
    if (!facts.isReal) throw notFound("practice not found");

    // Get trouble history: event rows with "settings.subscription.updated" for this practice
    const trouble = await withTenant(tenantId, async (tx) => {
      const { rows: eventRows } = await tx.query(
        `SELECT created_at as "at", topic as "kind", payload as detail
         FROM keystone.event
         WHERE topic = 'settings.subscription.updated'
         ORDER BY created_at DESC
         LIMIT 20`
      );
      return eventRows.map((row) => ({
        at: row.at,
        kind: row.kind,
        detail: row.detail,
      }));
    });

    // Get access history: latest 5 operator_access_request rows
    const accessHistory = await withTenant(tenantId, async (tx) => {
      const { rows: accessRows } = await tx.query(
        `SELECT operator_label, why, state, asked_at
         FROM keystone.operator_access_request
         ORDER BY asked_at DESC
         LIMIT 5`
      );
      return accessRows.map((row) => ({
        label: row.operator_label,
        why: row.why,
        state: row.state,
        askedAt: row.asked_at,
      }));
    });

    const result = {
      ...facts,
      trouble,
      accessHistory,
    };

    return assertNoNoteFields(result);
  }));
}
