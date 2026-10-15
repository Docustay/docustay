// The prices the public pages show. Live values come from the billing system when it answers; when it does not, these defaults keep the page whole (the pricing page must never say "loading").
// Pro is $39 a month, flat per workspace with unlimited users; founders (anyone who subscribes by the end of the cut-off day, Pacific; provisionally 27 Jan 2027) pay $25 a month for as long as the subscription stays active (the maintainer, 6 Oct 2026). Yearly billing is a setting that is OFF, so no yearly figure is shown unless the billing system sends one.
export const DEFAULT_PLANS = { free: { docsPerMonth: 15, templatesPerMonth: 5 }, pro: { monthlyMinor: 3900, foundersMonthlyMinor: 2500, items: ["unlimited documents", "unlimited templates", "automated reminders", "bulk send", "team roles", "no Docustay footer", "signing links on your own domain"] }, foundersUntil: "2027-01-28T08:00:00Z", live: false };   // the same instant the server uses: the first moment of 28 Jan 2027 Pacific, i.e. the end of 27 Jan
// The other prices, fixed by decision (the maintainer, 5 Oct 2026): Self-host Pro is $390 a year per install, for the buyer's own business; a commercial licence (embedding, white-label, resale, a private fork) is quoted from about $3,000 a year.
export const SELFHOST_PRO_YEARLY_MINOR = 39000;
export const COMMERCIAL_FROM_MINOR = 300000;
// ★ FLAGGED PLACEHOLDER (Run 9 Part 2 decision): the YEARLY price is not decided. These figures are shown only when the billing system itself sends a yearly price (yearly billing switched on);
//   until then the pricing page has no Monthly/Yearly switch. the maintainer sets the real yearly price before yearly billing is switched on.
export const YEARLY_PLACEHOLDER = Object.freeze({ yearlyMinor: 39000, foundersYearlyMinor: 25000, placeholder: true });
// Run 8 (the maintainer, 11 Oct 2026): Free makes 5 new templates a month (documents and forms together, however they are made); Pro and self-hosted installs have no template limit. The server's number is
// docustayPlans.mjs `templatesPerMonth`; the claims gate binds this copy to it.
// Scribe AI credits a month by plan. The claims gate checks both numbers against the server (src/product/docustayPlans.mjs).
export const AI_CREDITS = { free: 10, pro: 150 };
export function viewPlans(live) {
  const ok = live && live.free && live.pro && Number.isFinite(live.pro.monthlyMinor);
  return ok ? { ...DEFAULT_PLANS, ...live, free: { ...DEFAULT_PLANS.free, ...live.free }, pro: { ...DEFAULT_PLANS.pro, ...live.pro, items: live.pro.items?.length ? live.pro.items : DEFAULT_PLANS.pro.items }, live: true } : DEFAULT_PLANS;
}
export const dollars = (minor) => `$${(minor / 100) % 1 === 0 ? (minor / 100).toLocaleString("en-US") : (minor / 100).toFixed(2)}`;

/** What the Pro card shows right now: the founders price while the window is open, the list price after; a yearly figure only when the billing system sent one. */
export function proShown(p, now = new Date()) {
  const fm = p.pro.foundersMonthlyMinor, open = now.getTime() < new Date(p.foundersUntil).getTime(), founders = open && Number.isFinite(fm);
  return { founders, monthlyMinor: founders ? fm : p.pro.monthlyMinor, listMonthlyMinor: p.pro.monthlyMinor, yearlyMinor: founders && Number.isFinite(p.pro.foundersYearlyMinor) ? p.pro.foundersYearlyMinor : (Number.isFinite(p.pro.yearlyMinor) ? p.pro.yearlyMinor : null) };
}
/** The last day of the founders window, written the way a person reads it (Pacific time). */
export const foundersLastDay = (p) => new Date(new Date(p.foundersUntil).getTime() - 1).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
