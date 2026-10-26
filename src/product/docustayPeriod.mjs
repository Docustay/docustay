// THE ONE ALLOWANCE PERIOD (the maintainer, 18 Oct 2026, SIGNWITH.md 5.23): the window every Docustay counter is taken over.
//   Free ................ the UTC calendar month (and, after a paid plan ended this month, from the day that paid period ended: a fresh tally)
//   Pay as you go, Pro .. the workspace's current Stripe subscription period [current_period_start, current_period_end)
//   Lifetime ............ monthly from the purchase date (no Stripe period; its drafts-only subscription bills overage by event)
// All UTC. A month shorter than the anchor day clamps to its last day (Stripe does the same), leap years and the December to January wrap included.
// Pure: no database. `sub` is a mainstay_subscription row ({plan_key, status, current_period_start, current_period_end}); `plan` is what effectivePlan() made of it (null for a workspace on no Docustay plan).
import { effectivePlan } from "./docustayPlans.mjs";

const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** `anchor` moved by `k` whole months, keeping its day (clamped to the target month's length) and its time of day. */
export function addMonths(anchor, k) {
  const a = new Date(anchor), t = a.getUTCFullYear() * 12 + a.getUTCMonth() + k, y = Math.floor(t / 12), m = ((t % 12) + 12) % 12;
  return new Date(Date.UTC(y, m, Math.min(a.getUTCDate(), daysIn(y, m)), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds(), a.getUTCMilliseconds()));
}
export const calendarMonth = (now = new Date()) => ({ start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
const valid = (d) => d != null && !Number.isNaN(new Date(d).getTime());

/** The monthly slice of an anchored series that holds `now`. */
function slice(anchor, now) {
  const a = new Date(anchor);
  let k = (now.getUTCFullYear() - a.getUTCFullYear()) * 12 + (now.getUTCMonth() - a.getUTCMonth());
  while (addMonths(a, k).getTime() > now.getTime()) k -= 1;
  while (addMonths(a, k + 1).getTime() <= now.getTime()) k += 1;
  return { start: addMonths(a, k), end: addMonths(a, k + 1) };
}

/**
 * @returns {{start: Date, end: Date, kind: "calendar"|"billing"}} [start, end): the window of this workspace's allowance, tally, budget and alerts.
 * A paid subscription whose stored end has already passed (a late webhook) keeps rolling in whole months from that end, so the window never falls back to the calendar.
 */
export function allowancePeriod({ sub = null, plan = null, now = new Date() } = {}) {
  const cal = () => ({ ...calendarMonth(now), kind: "calendar" });
  if (!plan || !sub) return cal();
  if (plan.key === "docustay_free") {
    // a paid plan that ended this calendar month: Free starts fresh on the day the paid period ended
    const wasPaid = ["docustay_payg", "docustay_pro"].includes(sub.plan_key), end = valid(sub.current_period_end) ? new Date(sub.current_period_end) : null;
    const c = calendarMonth(now);
    if (wasPaid && end && end.getTime() <= now.getTime() && end.getTime() > c.start.getTime()) return { start: end, end: c.end, kind: "calendar" };
    return { ...c, kind: "calendar" };
  }
  if (plan.key === "docustay_lifetime") {
    if (!valid(sub.current_period_start)) return cal();
    // the purchase is stamped by the database clock; if this server's clock reads a moment earlier, the first month still starts at the purchase
    const a = new Date(sub.current_period_start);
    if (now.getTime() < a.getTime()) return { start: a, end: addMonths(a, 1), kind: "billing" };
    return { ...slice(a, now), kind: "billing" };
  }
  if (plan.key === "docustay_payg" || plan.key === "docustay_pro") {
    const end = valid(sub.current_period_end) ? new Date(sub.current_period_end) : null;
    if (!end) return cal();
    // Stripe's period is the window while it holds `now`; otherwise keep rolling from its end (monthly) until it does
    if (valid(sub.current_period_start)) {
      const s = new Date(sub.current_period_start);
      if (s.getTime() <= now.getTime() && now.getTime() < end.getTime()) return { start: s, end, kind: "billing" };
    }
    return { ...slice(end, now), kind: "billing" };
  }
  return cal();
}

/** Read the row and answer for a workspace (the plan is the one really in force: grace, lapse and cancellation applied). */
export async function periodFor(tx, tenantId, now = new Date()) {
  const { rows: [sub] } = await tx.query(`SELECT plan_key, status, current_period_start, current_period_end, cancel_at, past_due_since, updated_at FROM keystone.mainstay_subscription WHERE tenant_id = $1`, [tenantId]);
  const plan = effectivePlan(sub ?? null, process.env, now);
  return { ...allowancePeriod({ sub, plan, now }), plan, sub: sub ?? null };
}
