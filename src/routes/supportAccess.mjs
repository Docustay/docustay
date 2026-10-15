// Stage 18 task 18.5 — Tenant-side support-access routes (G27 server)
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PRACTICE'S OWNER SEES EVERY ASK, SAYS YES OR NO, AND ENDS LIVE ACCESS. Admins see it
// read-only; Coaches and clients cannot reach it. Routes are gated with `authoriseSection` at
// minRole `admin` to refuse Coaches, and Owner-only operations check `staff_role === 'owner'`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { listSupportAccess, answerAccessRequest, endSupportAccess } from "../platform/accessRequests.mjs";

export function registerSupportAccessRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Route guard: authoriseSection with minRole admin. Same pattern as settings.mjs.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const guarded = (navPath, minRank, fn, { status = 200, ...opts } = {}) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden(
          "support access is for staff. Your account is a client of this practice — this is a refusal, " +
          "not an empty form.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, navPath, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      return fn(ctx);
    }, opts).then((r) => c.json(r, status));

  const adminRead = (navPath, fn) => guarded(navPath, "admin", fn, { bucket: "settings" });
  const adminWrite = (navPath, fn) => guarded(navPath, "admin", fn, { bucket: "write" });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/settings/support-access — List all requests and grants
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/settings/support-access",
  // RUN-2 T11: the section was "/settings/support-access" — no nav row has that path, so authoriseSection refused
  //   EVERYONE ("unknown_path"). Support access is a data-and-audit decision: the admin row /settings/data.
    adminRead("/settings/data", async ({ db, tenantId, principal }) => {
      const { pending, live, history } = await listSupportAccess(db, { tenantId });
      return {
        pending,
        live,
        history,
        canAnswer: principal.user.staff_role === "owner",
      };
    }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/settings/support-access/:requestId/answer — Owner-only: answer a request
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/support-access/:requestId/answer",
    adminWrite("/settings/data", async ({ db, tenantId, principal, body, c }) => {
      // ★ Owner-only check
      if (principal.user.staff_role !== "owner") {
        throw forbidden("Only an Owner can let Workbench look at the account.");
      }

      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      const answer = String(body.answer ?? "").toLowerCase();
      if (!["yes", "no"].includes(answer)) {
        throw invalid("answer must be 'yes' or 'no'");
      }

      // Extract requestId from URL path
      const requestId = c.req.param("requestId");
      if (!requestId) throw invalid("requestId is required");

      // Call answerAccessRequest with the answer and actor info
      return await answerAccessRequest(db, {
        tenantId,
        requestId,
        answer,
        actorUserId: principal.appUserId,
      });
    }));

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/settings/support-access/:grantId/end — Owner-only: end a live grant
  // ───────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/settings/support-access/:grantId/end",
    adminWrite("/settings/data", async ({ db, tenantId, principal, c }) => {
      // ★ Owner-only check
      if (principal.user.staff_role !== "owner") {
        throw forbidden("Only an Owner can let Workbench look at the account.");
      }

      // Extract grantId from URL path
      const grantId = c.req.param("grantId");
      if (!grantId) throw invalid("grantId is required");

      // Call endSupportAccess with the grant ID and actor info
      return await endSupportAccess(db, {
        tenantId,
        supportAccessId: grantId,
        actorUserId: principal.appUserId,
      });
    }));
}
