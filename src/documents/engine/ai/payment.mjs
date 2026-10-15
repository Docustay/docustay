// THE SHARED DOCUMENT ENGINE — THE PAYMENT TERMS HOOK (B9). Pure, plain code: NO model decides an amount.
// The person types the payment in the wizard (an amount, a currency, who pays, what for). The model may only DRAFT around it and PROPOSE a payment plan as data. This file
//   · checks what the person typed (cleanPayment),
//   · tells the model what was typed (paymentPrompt) — and that it may not place a payment field,
//   · and ASSEMBLES: it throws away every payment field the model wrote, rejects a plan whose amounts differ from what the person typed, writes the payment terms from the person's own values and places
//     the one Payment field for the payer. Signing then waits for Stripe's own "paid" (pdfPayments.mjs, unchanged).
// Version one is a single payment at signing. Later instalments are text (schedule_note) — a Stripe price or payment link can be set on the field by hand.
import { PAYMENT_CURRENCIES } from "../../flowDefinition.mjs";
/** Two-decimal currencies Docustay offers when it asks (Stripe supports many more; a zero-decimal currency would need its own amount rules, so none is offered). */
const MIN_MINOR = 50, MAX_MINOR = 99_999_999;
const money = (minor, cur) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(minor / 100); } catch { return `${(minor / 100).toFixed(2)} ${cur.toUpperCase()}`; } };

/** The wizard's payment answers → { ok:true, payment:{ amount_minor, currency, payer_role, description, schedule_note } } | { ok:false, error }. `amount` is what the person typed, in major units. */
export function cleanPayment(p) {
  if (!p || typeof p !== "object" || p.collect !== true) return { ok: true, payment: null };
  const raw = String(p.amount ?? "").trim().replace(/^[$€£]/, "").replace(/,/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) return { ok: false, error: "Type the payment amount as a number, for example 1500 or 1500.50." };
  const minor = Math.round(Number(raw) * 100);
  if (minor < MIN_MINOR || minor > MAX_MINOR) return { ok: false, error: "The payment must be between 0.50 and 999,999.99." };
  const currency = String(p.currency ?? "usd").toLowerCase();
  if (!PAYMENT_CURRENCIES.includes(currency)) return { ok: false, error: "Pick one of the offered currencies." };
  const description = String(p.description ?? "").trim().slice(0, 200), schedule_note = String(p.schedule_note ?? "").trim().slice(0, 300), payer_role = String(p.payer_role ?? "").trim().slice(0, 80);
  if (!description) return { ok: false, error: "Say what the payment is for." };
  return { ok: true, payment: { amount_minor: minor, currency, payer_role, description, schedule_note } };
}

/** What the model is told. It is told the typed values as facts, and that the system (not it) places the payment. */
export function paymentPrompt(pay) {
  if (!pay) return "";
  return [`Payment the person will collect: ${money(pay.amount_minor, pay.currency)} (${pay.currency.toUpperCase()}), paid once, by card, when ${pay.payer_role || "the paying person"} signs. What it is for: ${pay.description}.${pay.schedule_note ? ` Later payments, in the person's words: ${pay.schedule_note}.` : ""}`,
    "Do NOT write the amount, a payment field or payment terms into the document: the system adds them. Return payment_plan with ONE item: label, amount_minor exactly as typed above, payer_role, and when (\"at signing\")."].join("\n");
}

const walk = (n, fn) => { if (!n || typeof n !== "object") return; fn(n); if (Array.isArray(n.content)) n.content.forEach((c) => walk(c, fn)); };
const hasSig = (b) => { let f = false; walk(b, (n) => { if (n.type === "fieldTag" && n.attrs?.type === "signature") f = true; }); return f; };

/** → { source, warnings[], placed:boolean }. `roles` are the role words of the people in the draft; `plan` is whatever the model proposed (data only). */
export function assemblePayment(source, { payment, plan, roles = [] }) {
  const warnings = [];
  if (!payment) return { source, warnings, placed: false };
  const doc = JSON.parse(JSON.stringify(source));
  // 1 · the model may never place a payment: every payment field it wrote is removed
  let stripped = 0;
  const strip = (blocks) => (blocks ?? []).map((b) => ({ ...b, content: Array.isArray(b.content) ? strip(b.content).filter((c) => !(c.type === "fieldTag" && c.attrs?.type === "payment" && ++stripped)) : b.content }));
  doc.content = strip(doc.content).filter((b) => !(b.type === "paragraph" && Array.isArray(b.content) && b.content.length === 0 && stripped));
  if (stripped) warnings.push("The assistant tried to place a payment field itself. It was removed and replaced with the one you asked for.");
  // 2 · the model's plan is data: every amount must equal what the person typed, or it is ignored (the person's own figure is used either way)
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const bad = items.some((i) => !Number.isInteger(i?.amount_minor) || i.amount_minor !== payment.amount_minor) || items.length > 1;
  if (items.length && bad) warnings.push("The assistant proposed a payment plan that did not match the amount you typed, so it was ignored. Your amount is what is charged.");
  // 3 · who pays: the role the person named, else the first signer role in the draft
  const payer = roles.includes(payment.payer_role) ? payment.payer_role : (roles[0] ?? payment.payer_role ?? "");
  if (!payer) warnings.push("No one is named to pay, so the payment field has no owner yet. Pick who pays on the Prepare step.");
  const major = (payment.amount_minor / 100).toFixed(2);
  const terms = `${payer || "The payer"} pays ${money(payment.amount_minor, payment.currency)} for ${payment.description}. It is paid by card, through Stripe, when signing.${payment.schedule_note ? ` ${payment.schedule_note.replace(/\s*$/, "").replace(/([^.!?])$/, "$1.")}` : ""}`;
  const text = (t) => ({ type: "text", text: t });
  const block = [
    { type: "heading", attrs: { level: 2 }, content: [text("Payment")] },
    { type: "paragraph", content: [text(terms)] },
    { type: "paragraph", content: [{ type: "fieldTag", attrs: { name: "Payment", type: "payment", role: payer, amount: major, currency: payment.currency, required: "true" } }] },
  ];
  let at = doc.content.findIndex((b) => hasSig(b));   // before the signatures
  if (at > 0 && doc.content[at - 1]?.type === "heading") at -= 1;
  doc.content.splice(at < 0 ? doc.content.length : at, 0, ...block);
  return { source: doc, warnings, placed: true };
}
