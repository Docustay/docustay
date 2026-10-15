// 12.10 — GOALS ROUTES. GET/POST /api/people/:personId/goals · POST /api/people/goals/:goalId.
//
// ★★★ STAFF-ONLY, behind the `/people` section floor (`authoriseSection`), same shape as
//     `src/routes/payerGroups.mjs`'s `/money` guard. The FINER permission — which staff member may
//     see or write THIS person's goals — is `src/people/goals.mjs`'s `mayGoal` (OQ-12.11), called
//     by the module functions themselves; this file adds only the coarse section floor on top —
//     two layers, per spec 05. A client, teen or parent session never reaches these routes at all.
//
// ★ Mounted by task 12.35 — not wired into `src/http/app.mjs` here.

import { invalid, forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listGoals, createGoal, updateGoal } from "../people/goals.mjs";
import { personCreditLedger, personPaymentMethods, personTaxIds } from "../people/moneyReads.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerPeopleRecordRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  /**
   * ★ Staff-only + the `/people` section floor — the same coarse shape every other staff record
   *   surface in this file group uses. The person-level check (who owns THIS client) happens
   *   inside `src/people/goals.mjs`, not here.
   */
  const guarded = (fn) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.user?.role || ctx.principal.user.role !== "staff") {
        throw forbidden("this route is for staff only");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/people", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) {
        throw forbidden("access to people requires access to the people section");
      }
      return fn(ctx);
    }).then((r) => c.json(r));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/people/:personId/goals — { rightNow, parked, done }
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/people/:personId/goals", guarded(async (ctx) => {
    const personId = ctx.c.req.param("personId");
    if (!UUID_RE.test(personId)) throw invalid("personId must be a valid UUID");

    return listGoals(ctx.db, { viewerId: ctx.principal.appUserId, personId });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/:personId/goals — { title, detail? } → { id }
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/:personId/goals", guarded(async (ctx) => {
    const personId = ctx.c.req.param("personId");
    if (!UUID_RE.test(personId)) throw invalid("personId must be a valid UUID");

    const { title, detail = null } = ctx.body || {};

    return createGoal(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      personId,
      title,
      detail,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/goals/:goalId — { title?, detail?, state? } → { id, fields }
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/goals/:goalId", guarded(async (ctx) => {
    const goalId = ctx.c.req.param("goalId");
    if (!UUID_RE.test(goalId)) throw invalid("goalId must be a valid UUID");

    const { title, detail, state } = ctx.body || {};

    return updateGoal(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      goalId,
      title,
      detail,
      state,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/people/:personId/credit-ledger — { id, amountMinor, type, note, createdAt }[]
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/people/:personId/credit-ledger", guarded(async (ctx) => {
    const personId = ctx.c.req.param("personId");
    if (!UUID_RE.test(personId)) throw invalid("personId must be a valid UUID");

    await assertMay(ctx.db, ctx.principal, { object: "person", action: "view", subjectId: personId });

    return personCreditLedger(ctx.db, { tenantId: ctx.tenantId, personId });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/people/:personId/payment-methods — { id, kind, brand, lastFour, expMonth, expYear, isDefault }[]
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/people/:personId/payment-methods", guarded(async (ctx) => {
    const personId = ctx.c.req.param("personId");
    if (!UUID_RE.test(personId)) throw invalid("personId must be a valid UUID");

    await assertMay(ctx.db, ctx.principal, { object: "person", action: "view", subjectId: personId });

    return personPaymentMethods(ctx.db, { tenantId: ctx.tenantId, personId });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/people/:personId/tax-ids — { id, type, value, verificationState }[]
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/people/:personId/tax-ids", guarded(async (ctx) => {
    const personId = ctx.c.req.param("personId");
    if (!UUID_RE.test(personId)) throw invalid("personId must be a valid UUID");

    await assertMay(ctx.db, ctx.principal, { object: "person", action: "view", subjectId: personId });

    return personTaxIds(ctx.db, { tenantId: ctx.tenantId, personId });
  }));
}
