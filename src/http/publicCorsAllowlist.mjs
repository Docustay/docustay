// @ts-check
// lead-intake brief, 30 Sep 2026 — THE ONE EXCEPTION TO CT-020's SAME-ORIGIN GUARD.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CT-020/Q5-3 (RULED 21 Sep 2026, src/http/app.mjs's own comment) refuses any mutating `/api/*`
//     request whose Origin/Referer does not match this deployment's own host — a deliberate,
//     RULED security control, not something this brief overrides wholesale. The public lead form
//     is the FIRST route that legitimately needs a different origin (the marketing site is a
//     separate Railway deployment) — so this is ONE NAMED, NARROW exception: a path that CORS
//     already allows for exactly this origin is not a forged cross-site write, and the CSRF guard
//     (app.mjs) and the CORS middleware (publicLeads.mjs) read the SAME list so the two can never
//     drift — a request the guard admits and the CORS header refuses (or the reverse) is exactly
//     the kind of two-declarations defect P4.10 already measured the cost of elsewhere.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★ Batch A (the maintainer, 3 Oct 2026): no organisation's website is typed in here any more. Each organisation lists its own site origins in its own settings (`growth.lead_form_origins`); a request is allowed
//   when the host it was sent to belongs to an organisation whose list contains the page's origin. One lookup serves both the CSRF guard and the CORS header, so the two cannot drift.
import { withTenant } from "../db/index.mjs";
import { getSetting } from "../settings/writes.mjs";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { resolvePublicTenantId } from "../booking/publicBooking.mjs";

/** Exactly the one mutating path this exception covers — never a prefix, never "every /api/public/*". */
const LEAD_FORM_MUTATING_PATH = "/api/public/leads";

/** The origins the organisation reached by this request's host allows (empty when the host is not an organisation's or it lists none). */
export async function leadFormOriginsFor(c) {
  let tenantId = null;
  try { tenantId = await resolvePublicTenantId(subdomainFromRequest(c)); } catch { return []; }
  if (!tenantId) return [];
  return withTenant(tenantId, (tx) => getSetting(tx, "growth.lead_form_origins", []), { userId: null });
}

export async function isLeadFormCrossOriginAllowed(pathname, origin, c) {
  if (pathname !== LEAD_FORM_MUTATING_PATH || !origin) return false;
  return (await leadFormOriginsFor(c)).includes(origin);
}
