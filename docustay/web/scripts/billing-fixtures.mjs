// The Billing page's states as the server would answer them (status payload, billing details, AI usage). Built from the REAL price list and plan cards (src/product/docustayPrices.mjs, planCards in
// src/product/docustay.mjs), so a number on the screen is checked against the list and not against a copy of it. Dates are relative to now. Used by billing-e2e.mjs (stood in with page.route).
process.env.KEYSTONE_DOCUSTAY_PRO_PRICE_MINOR ??= "3900"; process.env.KEYSTONE_DOCUSTAY_FOUNDERS_PRICE_MINOR ??= "2500";
const { planCards } = await import("../../../src/product/docustay.mjs");
const { PRICES } = await import("../../../src/product/docustayPrices.mjs");
export { PRICES, planCards };
export const CARDS = planCards(false);
const DAY = 86400_000, iso = (ms) => new Date(ms).toISOString();
const now = Date.now();
const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1), monthEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);
const pro = CARDS.find((p) => p.key === "docustay_pro");
const upgradePlan = { key: "docustay_pro", name: "Pro", priceMinor: PRICES.pro.foundersMonthlyMinor, listPriceMinor: PRICES.pro.listMonthlyMinor, founders: true, foundersUntil: PRICES.foundersUntil, yearlyPriceMinor: null, listYearlyPriceMinor: null, currency: "usd", interval: "month" };
void pro;

const budget = ({ used = 1850, budgetMinor = PRICES.budget.defaultMinor, paused = false, docs = 4, drafts = 2 } = {}) => ({
  budgetMinor, defaultMinor: PRICES.budget.defaultMinor, usedMinor: used, percent: Math.floor((used * 100) / budgetMinor), paused, alertsSent: [], usage: { amountMinor: used, documents: { units: docs }, drafts: { units: drafts } },
  period: { start: iso(now - 12 * DAY), end: iso(now + 18 * DAY) }, alertPercents: PRICES.budget.alertPercents, earlyInvoiceMinor: PRICES.budget.earlyInvoiceMinor });

/** status for a plan key and options */
export function status(planKey, o = {}) {
  const key = `docustay_${planKey}`, card = CARDS.find((p) => p.key === key);
  const paid = planKey !== "free", sub = ["payg", "pro"].includes(planKey), life = planKey === "lifetime";
  const per = paid ? { start: now - 12 * DAY, end: now + 18 * DAY } : { start: monthStart, end: monthEnd };
  const out = {
    demo: null, workspace: true, shape: "documents", product: "docustay",
    plan: { key, name: card.name, status: o.paymentProblem ? "past_due" : "active", renewsAt: sub ? iso(per.end) : null, cancelsAt: o.cancelsAt ? iso(per.end) : null, interval: sub ? "month" : null, founders: Boolean(o.founders), ended: o.ended ?? null },
    paymentProblem: Boolean(o.paymentProblem),
    entitlements: {},
    usage: { documentsThisMonth: o.docs ?? (planKey === "free" ? 11 : 24), documentsLimit: card.docsPerMonth, emailsToday: 3, emailsLimit: card.emailsPerDay, templatesThisMonth: o.templates ?? 2, templatesLimit: card.templatesPerMonth, resetsAt: iso(per.end), periodStart: iso(per.start), periodEnd: iso(per.end), periodKind: paid ? "billing" : "calendar", everSent: true },
    seats: planKey === "payg" ? { used: 3, included: 1, extraSeatPriceMinor: PRICES.payg.personMonthlyMinor } : null,
    billing: { canManage: sub, canUpgrade: !paid && o.ended !== "payment" },
    budget: card.docOverMinor != null || card.draftOverMinor != null ? budget(o.budget ?? {}) : null,
    upgrade: { available: !paid && o.ended !== "payment", plan: upgradePlan },
    plans: CARDS,
  };
  return out;
}
const day = (n) => iso(now + n * DAY);
export function details(planKey, o = {}) {
  const sub = ["payg", "pro"].includes(planKey);
  const card = o.noCard ? null : { brand: o.brand ?? "visa", last4: o.last4 ?? "4242", expMonth: o.expMonth ?? 8, expYear: o.expYear ?? new Date().getUTCFullYear() + 3 };
  const amount = planKey === "pro" ? (o.founders === false ? PRICES.pro.listMonthlyMinor : PRICES.pro.foundersMonthlyMinor) : PRICES.payg.personMonthlyMinor * 3;
  const inv = (id, ago, total, st) => ({ id, number: id, at: day(-ago), totalMinor: total, currency: "usd", status: st, pdf: `/api/product/docustay/invoices/${id}/pdf` });
  return {
    nextPayment: sub && !o.cancelsAt ? { at: day(18), amountMinor: amount, currency: "usd", interval: "month" } : null,
    card: sub || planKey === "lifetime" ? card : null,
    invoices: o.invoices ?? (planKey === "free" ? [] : [inv("in_paid1", 12, amount, "paid"), inv("in_open1", 3, 1260, "open"), inv("in_void1", 40, amount, "void"), inv("in_unc1", 70, amount, "uncollectible")]),
    savedThisMonth: { minor: 1240, currency: "usd", payments: 3 }, ...(o.stale ? { stale: true } : {}),
  };
}
export function ai(planKey, o = {}) {
  const card = CARDS.find((p) => p.key === `docustay_${planKey}`), allowance = card.draftsPerMonth ?? 0;
  if (o.ownKey) return { mode: "own_key", state: "ok" };
  const used = o.used ?? Math.min(allowance, 4);
  return { mode: "hosted", state: used >= allowance ? "used" : used / allowance >= 0.8 ? "low" : "ok", used, allowance, percent: Math.round((used / allowance) * 100), resetsAt: iso(planKey === "free" ? monthEnd : now + 18 * DAY), byFeature: { drafts: { credits: used }, edits: { credits: 0 }, file_reading: { credits: 0 } } };
}

/** every state the page has, by name: [plan, status options, details options, ai options, note] */
export const STATES = {
  "free": ["free", {}, {}, {}],
  "payg": ["payg", {}, {}, {}],
  "pro-founder": ["pro", { founders: true }, { founders: true }, {}],
  "pro-regular": ["pro", { founders: false }, { founders: false }, {}],
  "lifetime": ["lifetime", {}, {}, {}],
  "cancelled-running": ["pro", { founders: true, cancelsAt: true }, { cancelsAt: true }, {}],
  "ended": ["free", { ended: "cancelled" }, { stale: false, invoices: [] }, {}],
  "payment-failed": ["pro", { paymentProblem: true }, {}, {}],
  "payment-ended": ["free", { ended: "payment" }, { invoices: [] }, {}],
  "payment-failed-expired-card": ["pro", { paymentProblem: true }, { expMonth: 1, expYear: new Date().getUTCFullYear() - 1 }, {}],
  "budget-paused": ["payg", { budget: { used: PRICES.budget.defaultMinor, paused: true, docs: 40, drafts: 20 } }, {}, { used: 14 }],
  "card-expired": ["pro", {}, { expMonth: 1, expYear: new Date().getUTCFullYear() - 1 }, {}],
  "no-card": ["pro", {}, { noCard: true }, {}],
  "own-key": ["pro", {}, {}, { ownKey: true }],
  "stale-invoices": ["pro", {}, { invoices: [], stale: true }, {}],
};
