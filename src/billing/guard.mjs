// Task 6.5 (spec 06 §9) — A PRACTICE THAT HAS STOPPED PAYING STOPS WRITING, NOT READING.
//
// ★★★ CALLED FROM `runTenantScoped` (`src/http/app.mjs`), immediately after `MUTATING.has(method)`
//     is true and the tenant transaction is open (§11) — see the call site there for exactly where.
// ★★ EXEMPT, BY ROUTE: `/api/settings/billing/*` and `/api/settings/plans/*` (a read-only practice
//    must still be able to add a card or choose a plan) and `POST /api/auth/logout` (nobody should
//    be trapped signed in to a read-only practice). Every other mutating route, on every screen,
//    is covered — including the client app's own writes are explicitly OUT of this guard's reach,
//    because `runTenantScoped`'s staff-facing call site is the only one that calls it (§9: "this
//    guard only ever sits on the staff-facing mutating-route path, never on `/api/app/*` reads or
//    the client's own document-signing writes").
// ★ Refuses with `forbidden(...)`, never a 500 and never a silent no-op write.
import { forbidden } from "../http/errors.mjs";

/** ★ `mainstay_subscription.status` values this guard treats as READ-ONLY (§9: "Read-only after
 *    trial expiry or past_due/canceled"). Trial expiry is not a separate branch here — the
 *    trial-expiry sweep (§7, a different task) is what flips `status` OUT of 'trialing' into one of
 *    these two values once `trial_ends_at` has passed with no card; this guard only ever reads the
 *    column as it stands, never `trial_ends_at` directly. */
import { isDocustayPlanKey, effectivePlan, entitled } from "../product/docustayPlans.mjs";
const READ_ONLY_STATUSES = Object.freeze(["past_due", "canceled"]);

/** ★ Exact `METHOD path` strings, matching the `routeKey` shape `src/http/app.mjs` already builds
 *    (`` `${method} ${c.req.routePath}` ``). */
const EXEMPT_EXACT = Object.freeze(new Set(["POST /api/auth/logout"]));

/** ★ Path PREFIXES exempted regardless of method — every route under either tree. */
const EXEMPT_PATH_PREFIXES = Object.freeze(["/api/settings/billing", "/api/settings/plans"]);

/** Is this mutating route one of the ones a read-only practice must still be able to call? */
export function isBillingGuardExempt(routeKey) {
  if (EXEMPT_EXACT.has(routeKey)) return true;
  const path = routeKey.split(" ").slice(1).join(" ");
  return EXEMPT_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * ★★★ §12 test item 3, verbatim: "refuses a mutating call for a tenant whose
 *     `mainstay_subscription.status = 'past_due'` — positive control: the same call succeeds for
 *     `status = 'active'`; a second positive control: the billing-routes exemption list still lets
 *     a 'past_due' tenant call `POST /api/settings/billing/portal-session`."
 * ★ A tenant with NO `mainstay_subscription` row at all is treated as writable — every tenant past
 *   migration 0334's backfill has one, and a read function must never invent a refusal for a state
 *   the table itself cannot represent (an absent row is not one of the two read-only statuses).
 */
export async function assertPracticeWritable(tx, tenantId, routeKey, { staffRole = null, role = null } = {}) {
  if (routeKey && isBillingGuardExempt(routeKey)) return;
  const { rows } = await tx.query(
    `SELECT status, plan_key, past_due_since, updated_at FROM keystone.mainstay_subscription WHERE tenant_id = $1`,
    [tenantId]);
  // ★★★ Part 29 — A DOCUSTAY WORKSPACE IS NEVER MADE READ-ONLY BY BILLING. When Pro lapses (a failed payment past its grace, a cancellation) the workspace falls to Free: documents already sent still finish, signing links keep
  //   working, nothing is locked. What changes is the plan's limits (checked where they apply) and the people: on a plan without team roles every user except the owner can look but not change, and nobody is ever deleted.
  if (rows[0] && isDocustayPlanKey(rows[0].plan_key)) {
    const plan = effectivePlan(rows[0]);
    if (plan && !entitled(plan, "team_roles") && role === "staff" && staffRole && staffRole !== "owner") throw forbidden("Only the owner can make changes on this plan. You can still look at everything.", { code: "plan_pro_required", item: "team_roles", plan: plan.key, upgrade: "pro" });
    return;
  }
  const status = rows[0]?.status ?? null;
  if (status && READ_ONLY_STATUSES.includes(status)) {
    throw forbidden("this practice is read-only until billing is resolved");
  }
}
