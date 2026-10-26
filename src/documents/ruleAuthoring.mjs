// Docustay v1 items 6 and 10: conditional fields ("show if"), formulas ("works itself out") and conditional sections are no longer AUTHORED. A document or template that already has them keeps working
// (evaluation stays: rules.mjs, formula.mjs, the signing page, the PDF seal); what is refused is putting in a rule, formula or section rule that the stored version did not already have.
import { invalid } from "../http/errors.mjs";

export const NO_RULES = "Show-if rules, formulas and conditional sections are not part of Docustay any more. Documents that already use them keep working, but new ones cannot be added.";
const j = (x) => JSON.stringify(x);

/** Every rule, formula and section rule in a PDF body, as comparable strings. */
export function pdfRuleItems(body) {
  const out = new Set();
  for (const f of body?.fields ?? []) { if (f.show_when != null) out.add(`f:${f.id}:show:${j(f.show_when)}`); if (f.calc != null) out.add(`f:${f.id}:calc:${f.calc}`); }
  for (const p of body?.page_rules ?? []) out.add(`p:${p.page}:${j(p.show_when)}`);
  return out;
}

/** Every rule, formula and section rule in a written source (any node: a heading's showWhen, a field's show or calc). */
export function sourceRuleItems(source) {
  const out = new Set();
  const walk = (n, path) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}.${i}`));
    if (!n || typeof n !== "object") return;
    const a = n.attrs;
    if (a && typeof a === "object") {
      if (a.showWhen != null) out.add(`s:${j(a.showWhen)}`);
      if (typeof a.show === "string" && a.show.trim()) out.add(`show:${a.name ?? ""}:${a.show}`);
      if (typeof a.calc === "string" && a.calc.trim()) out.add(`calc:${a.name ?? ""}:${a.calc}`);
    }
    for (const k of Object.keys(n)) if (k !== "attrs") walk(n[k], `${path}.${k}`);
  };
  walk(source, "$");
  return out;
}

/** Throws unless `next` has no rule item that `prev` lacked. `items` is pdfRuleItems or sourceRuleItems. */
export function assertNoNewRules(items, next, prev = null) {
  const had = prev ? items(prev) : new Set();
  for (const x of items(next)) if (!had.has(x)) throw invalid(NO_RULES, { code: "rules_removed" });
}

// Item 10: payment plans (installments, subscriptions), amounts the signer chooses, formula amounts, Stripe prices and Stripe payment links are no longer AUTHORED. One fixed amount, a deposit,
// and an amount the sender sets before sending (amount_from) stay. A document already made or sent with one of the removed kinds still completes, refunds and processes its subscription events.
export const NO_PAYMENT_MODES = "Payment plans, amounts the signer chooses, formula amounts and Stripe prices or links are not part of Docustay any more. Documents that already use them keep working, but new ones cannot be added. A payment takes one set amount, or a deposit.";

export function pdfPaymentModeItems(body) {
  const out = new Set();
  for (const f of body?.fields ?? []) {
    if (f.type !== "payment") continue;
    if (f.plan) out.add(`pay:${f.id}:plan:${j(f.plan)}`);
    if (f.amount_ask) out.add(`pay:${f.id}:ask:${j(f.amount_ask)}`);
    if (f.amount_formula) out.add(`pay:${f.id}:formula:${f.amount_formula}`);
    if (f.price_id) out.add(`pay:${f.id}:price:${f.price_id}`);
    if (f.payment_link) out.add(`pay:${f.id}:link:${f.payment_link}`);
  }
  return out;
}

/** A written source's payment fields that use a removed way of setting the amount. */
export function sourcePaymentModeItems(source) {
  const out = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const a = n.attrs;
    if (a && typeof a === "object" && a.type === "payment") {
      for (const k of ["formula", "price", "link", "every", "count"]) if (a[k] != null && String(a[k]).trim() !== "") out.add(`pay:${a.name ?? ""}:${k}:${a[k]}`);
      if (String(a.amount ?? "").toLowerCase() === "ask") out.add(`pay:${a.name ?? ""}:ask`);
    }
    for (const k of Object.keys(n)) if (k !== "attrs") walk(n[k]);
  };
  walk(source);
  return out;
}

export function assertNoNewPaymentModes(items, next, prev = null) {
  const had = prev ? items(prev) : new Set();
  for (const x of items(next)) if (!had.has(x)) throw invalid(NO_PAYMENT_MODES, { code: "payment_modes_removed" });
}
