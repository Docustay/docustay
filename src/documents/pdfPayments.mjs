// src/documents/pdfPayments.mjs — PAYING WHILE SIGNING (QUEUE §23.5.11; Part 30 item 11). A `payment` field is a payment the signer makes on Stripe's hosted Checkout page before their signature completes. The amount is ONE of: a fixed
// amount, a custom merge value, a formula over the signer's own other fields, a Stripe price, or a pasted Stripe payment link. The island never touches Stripe: it asks the `payments` port, and no card data ever reaches it.
//
// ★★★ THE RULES THIS FILE KEEPS
//   · THE SERVER WORKS OUT THE AMOUNT. The browser sends the values the signer typed and NEVER an amount; a formula is recomputed here from those values, a price or a link is read from Stripe. A tampered amount is not an input.
//   · STRIPE IS THE SOURCE OF TRUTH. A payment counts only when the Checkout Session reads `paid` FROM THE PROVIDER, for the amount frozen on our row, carrying THIS document, person and field. The browser's word and a webhook's body never count: both only prompt a re-read.
//   · THE FEE IS DECIDED HERE, NOW, AND STORED: the host says what the platform fee is for this workspace at this moment (2% on Free, none on Pro); basis points, cents and plan are written on the row and never recomputed.
//   · THE SIGNATURE COMPLETES ONLY AFTER THE PAYMENT: signAsParty calls `verifyPaidForSigning` before it writes anything; unpaid → nothing is signed. A formula's inputs must still give the paid amount when the person signs.
//   · PAYMENT SUCCEEDS BUT SIGNING FAILS: the money stays paid and tied to the person and field; the retry finds "paid" and goes straight to signing — never a second charge.
//   · DOUBLE SUBMIT / REPLAY: one row per (document, person, field), Stripe's idempotency key built from the same ids, and every transition to `paid` is `WHERE status = 'pending'` — two clicks are one Session and a replayed webhook changes nothing.
//   · REFUND: staff only (the delete verb), any time after payment, total never above what was paid; the platform fee goes back with it; it changes the money row only — a signed record stands (§23.3).
//   · NO LIVE CARD CHARGES WITHOUT TY: the host's charge path is closed unless a person opened it; this file adds no way around that.
import { sendReceipt } from "./emailNotices.mjs";
import { invalid, conflict, notFound, dependency } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";
import { documentsOfSend } from "./parties.mjs";
import { requireVerified } from "./pdfVerify.mjs";
import { formulaMinor, FormulaError } from "./formula.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { emit } from "../events/outbox.mjs";

export const money = (minor, currency) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency).toUpperCase() }).format(minor / 100); } catch { return `${(minor / 100).toFixed(2)} ${String(currency).toUpperCase()}`; } };

/** "150" / "150.5" / "150.50" → 15000 / 15050 / 15050; anything else (a formula, a negative, three decimals, words) → null. */
export function parseMajorAmount(v) {
  const s = String(v ?? "").trim().replace(/^[$]/, "");
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(String(m[2] ?? "").padEnd(2, "0") || 0);
}

async function loadFor(tx, { leadId, partyId, fieldId }) {
  const { rows: [lead] } = await tx.query(`SELECT * FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf'`, [leadId]);
  const { rows: [party] } = await tx.query(`SELECT * FROM keystone.document_party WHERE id = $1 AND instance_id = $2`, [partyId, leadId]);
  if (!lead || !party) throw notFound("no such document");
  requireVerified(party, lead);
  if (!["sent", "partially_signed"].includes(lead.state)) throw conflict("this document is not open for signing");
  if (party.action_role !== "signer" || party.status === "signed") throw conflict("there is nothing for you to pay on this document");
  const members = await documentsOfSend(tx, { instanceId: leadId });
  for (const m of members) {
    const { rows: [row] } = await tx.query(`SELECT template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [m.id]);
    const fields = parsePdfBodyData(row.template_body_snapshot).fields, field = fields.find((f) => f.id === fieldId && f.type === "payment" && f.role === party.role);
    // Run 9 (R8-57): the answers the sender locked (a deposit amount set before sending) are part of every formula, whatever the page sends
    if (field) return { lead, party, docId: m.id, title: m.title, field, locked: Object.fromEntries(fields.filter((f) => f.locked && f.default != null).map((f) => [f.id, String(f.default)])) };
  }
  throw notFound("that payment is not yours to make");
}

const MIN_MINOR = 50, MAX_MINOR = 99999999;
const EMBEDDED_UI = /^embedded/;   // Stripe API 2026-09-30 names the in-page Checkout `embedded_page` (it was `embedded`); a session made either way is the in-page kind

/** The amount, worked out on the server. `values` are the signer's submitted field values (a formula's inputs). → { amountMinor, currency, kind, lineItems|null, name|null } */
async function amountOf(P, tx, { tenantId, field, lead, values, chosenMinor = null }) {
  const cur = field.currency ?? "usd";
  if (field.amount_ask) {   // the SIGNER chooses, inside the sender's bounds: the one amount the browser sends, checked here before anything is created
    const lo = field.amount_ask.min_minor ?? MIN_MINOR, hi = field.amount_ask.max_minor ?? MAX_MINOR;
    if (!Number.isInteger(chosenMinor)) throw invalid("Choose how much you would like to pay.", { code: "amount_needed" });
    if (chosenMinor < lo || chosenMinor > hi) throw invalid(`Choose an amount between ${money(lo, cur)} and ${money(hi, cur)}.`, { code: "amount_out_of_range" });
    return { amountMinor: chosenMinor, currency: cur, kind: "chosen", lineItems: null, name: null };
  }
  if (field.amount_minor && field.deposit) {   // only the deposit is charged now; the balance is not collected here
    const dep = "percent" in field.deposit ? Math.round(field.amount_minor * field.deposit.percent / 100) : field.deposit.amount_minor;
    return { amountMinor: dep, totalMinor: field.amount_minor, currency: cur, kind: "deposit", lineItems: null, name: null };
  }
  if (field.amount_minor && field.plan) return { amountMinor: field.amount_minor, currency: cur, kind: field.plan.count ? "installments" : "subscription", plan: field.plan, lineItems: null, name: null };
  if (field.amount_minor) return { amountMinor: field.amount_minor, currency: cur, kind: "fixed", lineItems: null, name: null };
  if (field.amount_from) {
    const key = String(field.amount_from).slice("custom.".length);
    const minor = parseMajorAmount(lead.custom_values?.[key]);
    if (minor === null || minor < MIN_MINOR) throw invalid("The amount to pay is not set correctly on this document. Ask the sender to check it.", { code: "amount_unavailable" });
    return { amountMinor: minor, currency: cur, kind: "custom", lineItems: null, name: null };
  }
  if (field.amount_formula) {
    let minor; try { minor = formulaMinor(field.amount_formula, values ?? {}); } catch (e) { if (e instanceof FormulaError) throw invalid(`The amount cannot be worked out yet: ${e.message}.`, { code: "amount_unavailable" }); throw e; }
    if (!Number.isInteger(minor) || minor < MIN_MINOR || minor > MAX_MINOR) throw invalid("The amount works out to less than 0.50 or more than 999,999.99, which cannot be paid here. Check the numbers you entered.", { code: "amount_unavailable" });
    return { amountMinor: minor, currency: cur, kind: "formula", lineItems: null, name: null };
  }
  if (field.price_id) { const p = await P.payments.priceInfo(tx, { tenantId, priceId: field.price_id }); return { amountMinor: p.amountMinor, currency: p.currency, kind: "price", lineItems: [{ price: p.priceId, quantity: 1 }], name: p.name }; }
  if (field.payment_link) { const l = await P.payments.linkInfo(tx, { tenantId, url: field.payment_link }); return { amountMinor: l.amountMinor, currency: l.currency, kind: "link", lineItems: l.lineItems, name: l.name }; }
  throw invalid("This payment field has no amount.", { code: "amount_unavailable" });
}

const EVERY = { week: "week", month: "month", year: "year" };
/** What a payment is called to the person: "$125.00 deposit of $500.00", "$100.00 a month, 6 payments", "$25.00 a month until cancelled". */
function describePayment(row) {
  const base = money(row.amount_minor, row.currency);
  if (row.amount_kind === "deposit" && row.total_minor) return `${base} deposit of ${money(row.total_minor, row.currency)}`;
  if (row.amount_kind === "installments") return `${base} a ${EVERY[row.plan_every] ?? "month"}, ${row.plan_count} payments`;
  if (row.amount_kind === "subscription") return `${base} a ${EVERY[row.plan_every] ?? "month"} until cancelled`;
  return base;
}
const view = (row, extra = {}) => ({ paid: row.status !== "pending" && row.status !== "expired", amountMinor: row.amount_minor, currency: row.currency, label: money(row.amount_minor, row.currency), kind: row.amount_kind ?? "fixed", describe: describePayment(row), ...extra });

async function installed() { const P = await ports(); if (!P.payments?.configured?.() || !P.payments.checkout) throw dependency("Payments are not set up here, so this cannot be paid yet. Ask the sender."); return P; }

const rowOf = async (tx, docId, partyId, fieldId) => (await tx.query(`SELECT * FROM keystone.document_payment WHERE instance_id = $1 AND party_id = $2 AND field_id = $3`, [docId, partyId, fieldId])).rows[0] ?? null;

/** Does Stripe say THIS row's Session was paid, for exactly the frozen amount, on this document, person and field? → { ok, st }. Never throws on "not paid". */
async function paidAccordingToStripe(P, tx, { tenantId, row, docId, partyId, fieldId }) {
  const st = await P.payments.checkoutStatus(tx, { tenantId, sessionId: row.checkout_session_id });
  const r = st.reference ?? {};
  const ok = st.paid && st.amountMinor === row.amount_minor && st.currency === row.currency
    && (r.instanceId ?? docId) === docId && (r.partyId ?? partyId) === partyId && (r.fieldId ?? fieldId) === fieldId;
  return { ok, st };
}

/** Stripe's own processing fee, as Stripe's balance transaction says it, kept on the row for the Payments page (read, never worked out; absent until Stripe has settled it). */
async function stripeFee(tx, id, st) { if (Number.isInteger(st?.stripeFeeMinor)) await tx.query(`UPDATE keystone.document_payment SET stripe_fee_minor = $2, stripe_fee_checked_at = now() WHERE id = $1 AND stripe_fee_minor IS DISTINCT FROM $2`, [id, st.stripeFeeMinor]); }

/** R13-D354: the owner's bell, email and webhooks hear about a payment (ids and amounts only). Inside a savepoint, so an event that cannot be written never undoes the payment it describes. */
async function paymentEvent(tx, row, { topic, ...extra }) {
  await tx.query("SAVEPOINT payment_event");
  try {
    await emit(tx, { tenantId: row.tenant_id, topic, emittedBy: "documents", subjectType: "document", subjectId: row.instance_id, actor: "system",
      payload: { document_id: row.instance_id, payment_id: row.id, amount_minor: row.amount_minor, currency: row.currency, ...extra } });
    await tx.query("RELEASE SAVEPOINT payment_event");
  } catch (e) { await tx.query("ROLLBACK TO SAVEPOINT payment_event"); console.error(`payment ${row.id}: ${topic} event not written: ${e?.message ?? e}`); }
}

/** Record "paid" once. The ONLY write that moves a row to paid; idempotent by its WHERE. → true when THIS call made the change. */
async function markPaid(tx, row, st) {
  const { rowCount } = await tx.query(
    `UPDATE keystone.document_payment SET status = 'paid', paid_at = now(), payment_intent_id = COALESCE($2, payment_intent_id), receipt_url = COALESCE($3, receipt_url),
            fee_minor = COALESCE($4, fee_minor), subscription_id = COALESCE($5, subscription_id), payments_made = CASE WHEN $5::text IS NOT NULL THEN GREATEST(payments_made, 1) ELSE payments_made END,
            sub_status = CASE WHEN $5::text IS NOT NULL THEN 'active' ELSE sub_status END, updated_at = now() WHERE id = $1 AND status IN ('pending','expired')`,
    [row.id, st.intentId ?? null, st.receiptUrl ?? null, Number.isInteger(st.applicationFeeMinor) ? st.applicationFeeMinor : null, st.subscriptionId ?? null]);
  if (rowCount > 0 && row.amount_kind === "installments" && st.subscriptionId) {   // the plan ends by itself after the last payment: Stripe is told once, here
    try { const P = await installed(); await P.payments.limitSubscription(tx, { tenantId: row.tenant_id, subscriptionId: st.subscriptionId, every: row.plan_every, count: row.plan_count }); }
    catch (e) { await tx.query(`UPDATE keystone.document_payment SET sub_status = 'needs_cap' WHERE id = $1`, [row.id]); console.error(`payment ${row.id}: could not cap the installment plan: ${e?.message ?? e}`); }
  }
  // Run 9 Part 3.7: the payment is part of the document's trail (amount and Stripe's reference — no card, no name)
  if (rowCount > 0) await recordAuditEvent(tx, { tenantId: row.tenant_id, instanceId: row.instance_id, kind: "paid", actorRole: (await tx.query(`SELECT role FROM keystone.document_party WHERE id = $1`, [row.party_id])).rows[0]?.role ?? null,
    detail: { amount_minor: row.amount_minor, currency: row.currency, payment_intent: st.intentId ?? null } });
  if (rowCount > 0) await paymentEvent(tx, row, { topic: "documents.payment.received", payment_intent: st.intentId ?? null });
  // Run 9 Part 3.7: the receipt is no longer sent here — it goes out with the sealed copy (`sendReceiptsForSend`), or on its own if the document never completes (PAYMENT_RECEIPT_DUE_FACT)
  return rowCount > 0;
}

/** Run 9 Part 3.7 (R9-l) — Stripe has confirmed a payment: if this person's signature was HELD for it, sign now from the hold. In a savepoint: a signature that cannot complete never undoes the
 *  record that the money arrived (Stripe has it either way). More still to pay → the hold stays. → { signed, completed } | null when nothing was held */
async function completeHold(tx, { tenantId, partyId }) {
  const { rows: [p] } = await tx.query(`SELECT status FROM keystone.document_party WHERE id = $1`, [partyId]);
  if (p?.status !== "awaiting_payment") return null;
  const { completeHeldSignature } = await import("./pdfSigning.mjs");   // pdfSigning imports this file: a late import keeps the two from loading each other
  await tx.query("SAVEPOINT complete_hold");
  try {
    const out = await completeHeldSignature(tx, { tenantId, partyId });
    await tx.query("RELEASE SAVEPOINT complete_hold");
    return { signed: out.completed === true && out.held !== true, completed: out.completed === true && out.held !== true && out.state === "executed", state: out.state ?? null };
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT complete_hold");
    console.error(`party ${partyId}: paid, but the held signature could not be completed: ${e?.message ?? e}`);
    return { signed: false, completed: false, problem: e?.message ?? String(e) };
  }
}

/** The receipts for every payment on a send that has none yet — called the moment the sealed copy is emailed, so the receipt travels with it. Each payment is claimed first (`receipt_sent_at`),
 *  so a retried job never sends a second one; a send that fails is un-claimed for the next try. → how many were sent */
/** Stripe attaches a charge's balance transaction (and so its fee) a few seconds after the payment succeeds, so the fee is often not there yet when the payer's confirm runs. Re-read the
 *  Session from Stripe for a paid payment whose fee is still unknown and record the fee Stripe gives — never worked out. Best effort: a Stripe hiccup leaves it "still settling", and the
 *  next prompt (the sealed copy, Stripe's charge.updated) tries again. → how many fees were recorded */
export async function refreshStripeFees(tx, { tenantId, instanceIds = null, intentId = null, paymentIds = null }) {
  if (!instanceIds && !intentId && !paymentIds) return 0;
  const { rows } = await tx.query(`SELECT id, checkout_session_id FROM keystone.document_payment WHERE tenant_id = $1 AND status IN ('paid','partially_refunded','refunded') AND stripe_fee_minor IS NULL AND checkout_session_id IS NOT NULL
    AND (($2::uuid[] IS NOT NULL AND instance_id = ANY($2::uuid[])) OR ($3::text IS NOT NULL AND payment_intent_id = $3) OR ($4::uuid[] IS NOT NULL AND id = ANY($4::uuid[])))`, [tenantId, instanceIds, intentId, paymentIds]);
  if (!rows.length) return 0;
  const P = await ports(); if (!P.payments?.configured?.()) return 0;
  let n = 0;
  for (const r of rows) {
    let st = null; try { st = await P.payments.checkoutStatus(tx, { tenantId, sessionId: r.checkout_session_id }); } catch { /* Stripe did not answer: the next prompt reads it again */ }
    if (Number.isInteger(st?.stripeFeeMinor)) { await stripeFee(tx, r.id, st); n += 1; }
    else await tx.query(`UPDATE keystone.document_payment SET stripe_fee_checked_at = now() WHERE id = $1 AND stripe_fee_minor IS NULL`, [r.id]);   // asked; still settling
  }
  return n;
}

export async function sendReceiptsForSend(tx, { tenantId, leadId }) {
  const members = await documentsOfSend(tx, { instanceId: leadId });
  await refreshStripeFees(tx, { tenantId, instanceIds: members.map((m) => m.id) });   // the sealed copy comes seconds after the payment: Stripe's fee is usually there by now
  const { rows } = await tx.query(`UPDATE keystone.document_payment SET receipt_sent_at = now() WHERE instance_id = ANY($1::uuid[]) AND status IN ('paid','partially_refunded','refunded') AND receipt_sent_at IS NULL RETURNING id`, [members.map((m) => m.id)]);
  // "Also send a receipt from Docustay" (Billing > Payments, 21 Oct 2026): switched off, Stripe's own receipt is the only one. NULL = never chosen: the receipt this workspace has always got.
  const { rows: [rc] } = await tx.query(`SELECT send_own_receipt FROM keystone.connect_account WHERE tenant_id = $1 ORDER BY (state = 'not_connected'), updated_at DESC LIMIT 1`, [tenantId]);
  if (rc?.send_own_receipt === false) return 0;
  let sent = 0;
  for (const r of rows) {
    const status = await sendReceipt(tx, { tenantId, paymentId: r.id });
    if (status === "sent") sent += 1;
    // only a real failure is tried again; "skipped" is a deliberate stop (an opted-out address, the environment's own backstop) and "none" means there is nobody to send it to
    if (status === "failed") await tx.query(`UPDATE keystone.document_payment SET receipt_sent_at = NULL WHERE id = $1`, [r.id]);
  }
  return sent;
}

/** The due sweep's backstop for Stripe's fee: a paid payment whose fee is still unknown (Stripe had not settled it when the payer confirmed, nor by the sealed copy, and its charge.updated never
 *  came) is asked about again — at most every 15 minutes, for 30 days. What is recorded is what Stripe says; nothing is worked out. */
export const PAYMENT_FEE_DUE_FACT = Object.freeze({
  key: "document_payment_stripe_fee",
  why: "Stripe's fee on a paid payment was not known yet, so Stripe is asked again",
  find: (tx, { tenantId }) => tx.query(
    `SELECT id FROM keystone.document_payment WHERE tenant_id = $1 AND status IN ('paid','partially_refunded','refunded') AND stripe_fee_minor IS NULL AND checkout_session_id IS NOT NULL
        AND paid_at > now() - interval '30 days' AND (stripe_fee_checked_at IS NULL OR stripe_fee_checked_at <= now() - interval '15 minutes')
      ORDER BY paid_at LIMIT 20`, [tenantId]),
  async act(tx, { tenantId, row }) {
    return (await refreshStripeFees(tx, { tenantId, paymentIds: [row.id] })) ? `Stripe's fee recorded for payment ${row.id}` : null;
  },
});

/** The due sweep's fallback: a paid payment whose document did not complete — it ended (cancelled, declined, expired), or it has waited 3 days for someone else — gets its receipt on its own. */
export const PAYMENT_RECEIPT_DUE_FACT = Object.freeze({
  key: "document_payment_receipt",
  why: "a payment was made on a document that has not completed, so its receipt goes on its own",
  find: (tx, { tenantId }) => tx.query(
    `SELECT p.id FROM keystone.document_payment p JOIN keystone.document_instance i ON i.id = p.instance_id
      WHERE p.tenant_id = $1 AND p.status IN ('paid','partially_refunded','refunded') AND p.receipt_sent_at IS NULL AND p.paid_at IS NOT NULL
        AND (i.state IN ('void','declined','expired') OR (i.state <> 'executed' AND p.paid_at <= now() - interval '3 days') OR p.paid_at <= now() - interval '7 days')
      ORDER BY p.paid_at LIMIT 50`, [tenantId]),
  async act(tx, { tenantId, row }) {
    const { rowCount } = await tx.query(`UPDATE keystone.document_payment SET receipt_sent_at = now() WHERE id = $1 AND receipt_sent_at IS NULL`, [row.id]);
    if (!rowCount) return null;
    if ((await sendReceipt(tx, { tenantId, paymentId: row.id })) === "failed") { await tx.query(`UPDATE keystone.document_payment SET receipt_sent_at = NULL WHERE id = $1`, [row.id]); return null; }
    return `receipt for payment ${row.id} sent on its own`;
  },
});

/** Where Stripe sends the signer back: the signing page the request came from (same origin as the request, a /sign/ path only — never a link the browser invents). */
function returnUrls({ origin, returnPath, fieldId }) {
  let o; try { o = new URL(origin); } catch { throw invalid("Cannot tell where to send you back after paying.", { code: "bad_return" }); }
  if (!/^https?:$/.test(o.protocol)) throw invalid("Cannot tell where to send you back after paying.", { code: "bad_return" });
  const path = String(returnPath ?? "");
  if (!/^\/sign\/[A-Za-z0-9_\-/]*(\?[A-Za-z0-9_\-=&%.]*)?$/.test(path)) throw invalid("Cannot tell where to send you back after paying.", { code: "bad_return" });
  const base = new URL(path, o.origin); base.searchParams.delete("paid"); base.searchParams.delete("cancelled");
  const ok = new URL(base); ok.searchParams.set("paid", fieldId); ok.searchParams.set("session", "{CHECKOUT_SESSION_ID}");
  const no = new URL(base); no.searchParams.set("cancelled", fieldId);
  return { successUrl: ok.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"), cancelUrl: no.toString() };
}

/** The signer clicks Pay with Stripe: works the amount out, creates (or re-uses) the hosted Checkout Session, and answers where to go — or `paid: true` when it is already paid. */
export async function startPayment(tx, { tenantId, leadId, partyId, fieldId, values = {}, origin, returnPath, chosen = null, embedded = false }) {
  const P = await installed();
  if ((await P.payments.ready?.(tx, { tenantId }))?.status === "paused") throw conflict("Payments are paused for this workspace right now. Your signature is kept; ask the sender to turn payments back on, then come back to this link.", { code: "payments_paused" });
  const { lead, party, docId, title, field, locked } = await loadFor(tx, { leadId, partyId, fieldId });
  // Run 9 Part 3.7: once the signature is held, the amount comes from the answers they signed with — never from what the page sends now
  if (party.status === "awaiting_payment" && party.held_signature?.values) values = party.held_signature.values;
  values = { ...values, ...locked };
  const urls = returnUrls({ origin, returnPath, fieldId });
  const existing = await rowOf(tx, docId, party.id, fieldId);
  if (existing && existing.status !== "pending" && existing.status !== "expired") return view(existing, { hold: await completeHold(tx, { tenantId, partyId: party.id }) });   // already paid (or refunded): never a second charge
  // a fixed amount or a custom value was frozen when the first session was made and never changes; a formula, a price or a link is worked out (or read from Stripe) afresh each time
  const chosenMinor = chosen === null || chosen === undefined || chosen === "" ? null : parseMajorAmount(chosen);
  if (chosen !== null && chosen !== undefined && chosen !== "" && chosenMinor === null) throw invalid("Type the amount as a number, for example 25 or 25.50.", { code: "amount_needed" });
  const keep = existing?.checkout_session_id && (["fixed", "custom", "deposit", "installments", "subscription"].includes(existing.amount_kind) || (existing.amount_kind === "chosen" && chosenMinor === null));
  const amt = keep
    ? { amountMinor: existing.amount_minor, totalMinor: existing.total_minor ?? undefined, currency: existing.currency, kind: existing.amount_kind, plan: existing.plan_every ? { every: existing.plan_every, count: existing.plan_count ?? undefined } : undefined, lineItems: null, name: null }
    : await amountOf(P, tx, { tenantId, field, lead, values, chosenMinor });
  if (existing?.checkout_session_id) {
    const { ok, st } = await paidAccordingToStripe(P, tx, { tenantId, row: existing, docId, partyId: party.id, fieldId });
    if (ok) { await markPaid(tx, existing, st); return view({ ...existing, status: "paid" }, { hold: await completeHold(tx, { tenantId, partyId: party.id }) }); }
    // the Session is still open for the SAME amount, in the same kind of page → send the person back to it; anything else (a different amount now, expired, cancelled) → close it and make a new one
    const same = st.sessionStatus === "open" && existing.status === "pending" && existing.amount_minor === amt.amountMinor && existing.currency === amt.currency;
    if (same && !embedded && !EMBEDDED_UI.test(st.uiMode ?? "") && st.url) return view(existing, { checkoutUrl: st.url });
    if (same && embedded && EMBEDDED_UI.test(st.uiMode ?? "") && st.clientSecret) return view(existing, { clientSecret: st.clientSecret, stripe: await P.payments.clientConfig?.(tx, { tenantId }) ?? null });
    if (st.sessionStatus === "open") await P.payments.expire(tx, { tenantId, sessionId: existing.checkout_session_id });
  }
  const fee = await P.payments.feeFor(tx, { tenantId, amountMinor: amt.amountMinor });
  const generation = existing?.checkout_session_id ? `:after:${existing.checkout_session_id}` : "";
  let co;
  try { co = await P.payments.checkout(tx, {
    tenantId, amountMinor: amt.amountMinor, currency: amt.currency, lineItems: amt.lineItems, name: amt.name ?? `${title} — ${field.label || "payment"}`,
    instanceId: docId, partyId: party.id, signer: { email: party.email ?? null, ref: party.external_ref ?? null }, fieldId, successUrl: urls.successUrl, cancelUrl: urls.cancelUrl, feeMinor: fee.feeMinor, feeBps: fee.bps, recurring: amt.plan ? { every: amt.plan.every } : null,
    embedded, returnUrl: embedded ? urls.successUrl : null,
    idempotencyKey: `docpay:${tenantId}:${docId}:${party.id}:${fieldId}:${amt.amountMinor}${generation}`,
  }); } catch (e) {
    // the signer reads this: the name of the switch and the policy behind it are for the log, not for them (the error's own name keeps the island free of the money module)
    if (e?.name === "ChargePathDisabled") throw conflict("Paying on this document is not switched on yet. Ask the person who sent it to you.");
    throw e;
  }
  const isTest = Boolean(lead.is_test);
  const { rows: [row] } = await tx.query(
    `INSERT INTO keystone.document_payment (tenant_id, instance_id, party_id, field_id, amount_minor, currency, checkout_session_id, amount_kind, fee_bps, fee_minor, plan_key, is_test, total_minor, plan_every, plan_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (instance_id, party_id, field_id) DO UPDATE SET amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency, checkout_session_id = EXCLUDED.checkout_session_id, amount_kind = EXCLUDED.amount_kind,
          fee_bps = EXCLUDED.fee_bps, fee_minor = EXCLUDED.fee_minor, plan_key = EXCLUDED.plan_key, is_test = EXCLUDED.is_test, total_minor = EXCLUDED.total_minor, plan_every = EXCLUDED.plan_every, plan_count = EXCLUDED.plan_count, status = 'pending', payment_intent_id = NULL, updated_at = now()
       WHERE keystone.document_payment.status IN ('pending','expired') RETURNING *`,
    [tenantId, docId, party.id, fieldId, amt.amountMinor, amt.currency, co.sessionId, amt.kind, fee.bps, fee.feeMinor, fee.planKey, isTest, amt.totalMinor ?? null, amt.plan?.every ?? null, amt.plan?.count ?? null]);
  if (!row) return view(await rowOf(tx, docId, party.id, fieldId));   // it was paid between the read and the write
  if (embedded) return view(row, { clientSecret: co.clientSecret, stripe: await P.payments.clientConfig?.(tx, { tenantId }) ?? null });
  return view(row, { checkoutUrl: co.url });
}

/** The signer is back (or the browser polls): re-read Stripe and record it. Answers whether it is really paid (never trusts the browser). */
export async function confirmPayment(tx, { tenantId, leadId, partyId, fieldId }) {
  // ★ D537/D549 — Stripe's webhook can finish the held signature (and so the document) before the payer's page asks. The page then asked "is it paid?" and got "this document is not open for signing" until it gave up with "the payment did not go through" on a paid, executed document. A payment that is paid on a person who has signed is answered as what it is: paid, and signed.
  const { rows: [done] } = await tx.query(
    `SELECT i.state AS lead_state, p.amount_minor, p.currency FROM keystone.document_party pa JOIN keystone.document_instance i ON i.id = pa.instance_id
       JOIN keystone.document_payment p ON p.party_id = pa.id AND p.field_id = $3 AND p.status NOT IN ('pending','expired')
      WHERE pa.id = $1 AND pa.instance_id = $2 AND pa.status = 'signed'`, [partyId, leadId, fieldId]);
  if (done) return { paid: true, label: money(done.amount_minor, done.currency), hold: { signed: true, completed: done.lead_state === "executed", state: done.lead_state ?? null, alreadyCompleted: true } };
  const P = await installed();
  const { party, docId } = await loadFor(tx, { leadId, partyId, fieldId });
  const row = await rowOf(tx, docId, party.id, fieldId);
  if (!row) throw notFound("no payment was started for that field");
  if (row.status !== "pending" && row.status !== "expired") return { paid: true, label: money(row.amount_minor, row.currency), hold: await completeHold(tx, { tenantId, partyId: party.id }) };
  const { ok, st } = await paidAccordingToStripe(P, tx, { tenantId, row, docId, partyId: party.id, fieldId });
  if (ok) { await markPaid(tx, row, st); await stripeFee(tx, row.id, st); }
  if (!ok && st.sessionStatus === "expired") await tx.query(`UPDATE keystone.document_payment SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'pending'`, [row.id]);
  return { paid: ok, label: money(row.amount_minor, row.currency), ...(ok ? { hold: await completeHold(tx, { tenantId, partyId: party.id }) } : { status: st.sessionStatus === "expired" ? "expired" : st.paymentStatus ?? st.sessionStatus }) };
}

/** The Connect webhook said a Checkout Session completed. The event is only a prompt: re-read the Session from Stripe, then record. Idempotent — a replay finds the row already paid and changes nothing. */
export async function recordCheckoutCompleted(tx, { tenantId, sessionId }) {
  const { rows: [row] } = await tx.query(`SELECT * FROM keystone.document_payment WHERE tenant_id = $1 AND checkout_session_id = $2`, [tenantId, sessionId]);
  if (!row) return { applied: false, reason: "not_a_document_payment" };
  if (row.status !== "pending" && row.status !== "expired") return { applied: false, reason: "already_recorded", status: row.status };
  const P = await installed();
  const { ok, st } = await paidAccordingToStripe(P, tx, { tenantId, row, docId: row.instance_id, partyId: row.party_id, fieldId: row.field_id });
  if (!ok) return { applied: false, reason: "stripe_does_not_say_paid" };
  const applied = await markPaid(tx, row, st); await stripeFee(tx, row.id, st);
  return { applied, reason: "paid", hold: await completeHold(tx, { tenantId, partyId: row.party_id }) };
}

/** What this person has already paid on this send, for the signing page to show ("Paid ✓") after a reload. */
export async function paymentsForParty(tx, { leadId, partyId }) {
  const members = await documentsOfSend(tx, { instanceId: leadId });
  const { rows } = await tx.query(`SELECT field_id, status, amount_minor, currency, amount_kind, total_minor, plan_every, plan_count FROM keystone.document_payment WHERE party_id = $1 AND instance_id = ANY($2::uuid[])`, [partyId, members.map((m) => m.id)]);
  return rows.map((r) => ({ fieldId: r.field_id, paid: r.status !== "pending" && r.status !== "expired", amountMinor: r.amount_minor, currency: r.currency, label: money(r.amount_minor, r.currency), kind: r.amount_kind ?? "fixed", describe: describePayment(r) }));
}

/** Called by signAsParty BEFORE it writes anything. → { value } (the text burned onto the page) or { problem }. `values` are what the signer is submitting now: a formula's inputs must still give the amount that was paid. */
export async function verifyPaidForSigning(tx, { tenantId, docId, partyId, field, values = {} }) {
  const row = await rowOf(tx, docId, partyId, field.id);
  if (!row || row.status === "expired") return { problem: "needs to be paid first", unpaid: true };
  if (row.status === "pending") {
    const P = await installed();
    const { ok, st } = await paidAccordingToStripe(P, tx, { tenantId, row, docId, partyId, fieldId: field.id });
    if (!ok) return { problem: "has not been paid — the payment did not go through", unpaid: true };
    await markPaid(tx, row, st);
  }
  if (field.amount_formula) {
    let now = null; try { now = formulaMinor(field.amount_formula, values); } catch { now = null; }
    if (now !== row.amount_minor) return { problem: "was paid for different numbers than the ones you are signing with — the amount changed after you paid" };
  }
  return { value: row.amount_kind === "deposit" ? `Paid deposit ${money(row.amount_minor, row.currency)} of ${money(row.total_minor, row.currency)}` : row.amount_kind === "installments" || row.amount_kind === "subscription" ? `Paid first ${money(row.amount_minor, row.currency)} of ${row.amount_kind === "installments" ? `${row.plan_count} payments` : `a ${row.plan_every}ly plan`}` : `Paid ${money(row.amount_minor, row.currency)}` };
}

/** The payments on a send (every document in it), for the Track page. Staff see the fee; the signer's own view (paymentsForParty) never does. */
export async function paymentsOfSend(tx, { memberIds }) {
  const { rows } = await tx.query(
    `SELECT p.id, p.field_id, p.status, p.amount_minor, p.currency, p.paid_at, p.refunded_minor, p.refund_reason, p.instance_id, p.receipt_url, p.fee_bps, p.fee_minor, p.fee_refunded_minor, p.plan_key, p.is_test, p.last_failure, p.last_failed_at, p.amount_kind, p.total_minor, p.plan_every, p.plan_count, p.payments_made, p.sub_status, p.payment_intent_id, p.stripe_fee_minor, p.dispute_id, p.dispute_status, p.receipt_sent_at, a.name AS person
       FROM keystone.document_payment p JOIN keystone.document_party a ON a.id = p.party_id WHERE p.instance_id = ANY($1::uuid[]) ORDER BY p.created_at`, [memberIds]);
  return rows.map((r) => ({ id: r.id, person: r.person, status: r.status, amountMinor: r.amount_minor, currency: r.currency, label: money(r.amount_minor, r.currency), paidAt: r.paid_at, refundedMinor: r.refunded_minor,
    refundedLabel: r.refunded_minor ? money(r.refunded_minor, r.currency) : null, refundReason: r.refund_reason, receiptUrl: r.receipt_url, feeBps: r.fee_bps, feeMinor: r.fee_minor, feeLabel: r.fee_minor ? money(r.fee_minor, r.currency) : null,
    feeRefundedMinor: r.fee_refunded_minor, plan: r.plan_key, test: r.is_test, documentId: r.instance_id, fieldId: r.field_id,
    kind: r.amount_kind ?? "fixed", describe: describePayment(r), paymentsMade: r.payments_made, paymentsOf: r.amount_kind === "installments" ? r.plan_count : null, subStatus: r.sub_status,
    stripeFeeMinor: r.stripe_fee_minor, stripeFeeLabel: Number.isInteger(r.stripe_fee_minor) ? money(r.stripe_fee_minor, r.currency) : null, disputeId: r.dispute_id, disputeStatus: r.dispute_status, receiptSentAt: r.receipt_sent_at,
    canRefund: Boolean(r.payment_intent_id) && ["paid", "partially_refunded"].includes(r.status) && r.refunded_minor < r.amount_minor }));
}

/** Run 9 Part 3.7 (Pay 3) — THE PAYMENTS PAGE: every payment taken through a payment box in this workspace, newest first, and this month's figures. Staff only (the route guards it); the JOIN
 *  to the document reads it under the document's own visibility, so a member never sees a payment on a document their team cannot open. A held signature with nothing paid yet is
 *  "waiting to pay"; a dispute is shown as Stripe says it (answered in Stripe). Test documents (practice runs) are left out of the figures, not the list. Amounts are Stripe's, never worked out. */
export async function listWorkspacePayments(tx, { tenantId, before = null, limit = 50 }) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await tx.query(
    `SELECT p.id, p.status, p.amount_minor, p.currency, p.paid_at, p.created_at, p.refunded_minor, p.refunded_at, p.refund_reason, p.fee_minor, p.fee_refunded_minor, p.stripe_fee_minor, p.dispute_id, p.dispute_status,
            p.amount_kind, p.total_minor, p.plan_every, p.plan_count, p.is_test, p.payment_intent_id, p.instance_id, p.party_id, a.name AS person, a.status AS party_status, a.hold_expires_at,
            COALESCE(lead.id, i.id) AS lead_id, COALESCE(lead.title, i.title) AS title, COALESCE(lead.source_channel, i.source_channel) AS channel
       FROM keystone.document_payment p JOIN keystone.document_instance i ON i.id = p.instance_id LEFT JOIN keystone.document_instance lead ON lead.id = i.package_lead_id
       JOIN keystone.document_party a ON a.id = p.party_id
      WHERE p.tenant_id = $1 AND (p.status <> 'expired' OR a.status = 'awaiting_payment') AND ($2::timestamptz IS NULL OR p.created_at < $2)
      ORDER BY p.created_at DESC LIMIT $3`, [tenantId, before, lim + 1]);
  const more = rows.length > lim; const page = rows.slice(0, lim);
  const status = (r) => r.dispute_status && !["won", "warning_closed"].includes(r.dispute_status) ? "disputed" : r.status === "refunded" ? "refunded" : r.status === "partially_refunded" ? "partially_refunded"
    : ["paid", "completed"].includes(r.status) ? "paid" : r.party_status === "awaiting_payment" ? "waiting" : "started";
  const items = page.map((r) => ({ id: r.id, person: r.person, documentId: r.lead_id, title: r.title, form: r.channel === "form", amountMinor: r.amount_minor, currency: r.currency, label: money(r.amount_minor, r.currency), describe: describePayment(r),
    status: status(r), paidAt: r.paid_at, createdAt: r.created_at, refundedMinor: r.refunded_minor, refundedLabel: r.refunded_minor ? money(r.refunded_minor, r.currency) : null, refundReason: r.refund_reason, refundedAt: r.refunded_at,
    disputeId: r.dispute_id, disputeStatus: r.dispute_status, test: r.is_test, partyId: r.party_id, failure: r.last_failure ?? null, failedAt: r.last_failed_at ?? null, holdExpiresAt: r.party_status === "awaiting_payment" ? r.hold_expires_at : null,
    canRefund: Boolean(r.payment_intent_id) && ["paid", "partially_refunded"].includes(r.status) && r.refunded_minor < r.amount_minor, canRemind: r.party_status === "awaiting_payment" }));
  // this month (UTC), real documents only; each figure in the workspace's main currency (the most used one); the others are counted, not added across currencies
  const { rows: [m] } = await tx.query(
    `WITH mine AS (SELECT p.* FROM keystone.document_payment p JOIN keystone.document_instance i ON i.id = p.instance_id WHERE p.tenant_id = $1 AND NOT p.is_test),
          cur AS (SELECT currency FROM mine WHERE paid_at IS NOT NULL GROUP BY currency ORDER BY count(*) DESC, currency LIMIT 1)
     SELECT (SELECT currency FROM cur) AS currency,
            COALESCE(sum(amount_minor) FILTER (WHERE paid_at >= date_trunc('month', now()) AND currency = (SELECT currency FROM cur)), 0)::bigint AS collected,
            COALESCE(sum(fee_minor - fee_refunded_minor) FILTER (WHERE paid_at >= date_trunc('month', now()) AND currency = (SELECT currency FROM cur)), 0)::bigint AS fee,
            COALESCE(sum(stripe_fee_minor) FILTER (WHERE paid_at >= date_trunc('month', now()) AND currency = (SELECT currency FROM cur)), 0)::bigint AS stripe_fee,
            count(*) FILTER (WHERE paid_at >= date_trunc('month', now()) AND stripe_fee_minor IS NULL AND status <> 'expired')::int AS stripe_fee_unknown,
            COALESCE(sum(refunded_minor) FILTER (WHERE refunded_at >= date_trunc('month', now()) AND currency = (SELECT currency FROM cur)), 0)::bigint AS refunded,
            count(*) FILTER (WHERE refunded_at >= date_trunc('month', now()))::int AS refunds,
            count(*) FILTER (WHERE paid_at >= date_trunc('month', now()) AND currency IS DISTINCT FROM (SELECT currency FROM cur))::int AS other_currency
       FROM mine`, [tenantId]);
  const c = m.currency ?? "usd";
  const month = { currency: c, collected: money(Number(m.collected), c), fee: money(Number(m.fee), c), stripeFee: money(Number(m.stripe_fee), c), stripeFeePending: m.stripe_fee_unknown, refunded: money(Number(m.refunded), c), refunds: m.refunds, otherCurrency: m.other_currency };
  return { items, month, next: more ? page[page.length - 1].created_at : null };
}

/** Run 9 Part 3.7 (B4): what was paid this month (UTC) through payment boxes while the workspace was on Pro (no fee taken), net of refunds, real documents only, in the most used currency —
 *  for "Saved in fees this month". The host applies the Free plan's rate; the island does not know it. → { currency, amounts: [minor, …] } */
export async function paidOnProThisMonth(tx) {
  const { rows } = await tx.query(
    `SELECT currency, amount_minor - refunded_minor AS net FROM keystone.document_payment
      WHERE paid_at >= date_trunc('month', now()) AND fee_bps = 0 AND plan_key = 'docustay_pro' AND NOT is_test AND status IN ('paid','partially_refunded','completed')`);
  const by = new Map(); for (const r of rows) by.set(r.currency, [...(by.get(r.currency) ?? []), Number(r.net)]);
  const [currency, amounts] = [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ["usd", []];
  return { currency, amounts };
}

/** Refund all (default) or part of a payment. Staff only — the route enforces the delete verb. The provider is asked first (and returns the platform fee with it); our row follows what it says. */
export async function refundPayment(tx, { tenantId, paymentId, amountMinor = null, reason = null, actorUserId = null }) {
  const { rows: [row] } = await tx.query(`SELECT * FROM keystone.document_payment WHERE id = $1`, [paymentId]);
  if (!row) throw notFound("no such payment");
  if (!["paid", "partially_refunded"].includes(row.status)) throw conflict(row.status === "refunded" ? "that payment has already been refunded" : "that payment was never completed, so there is nothing to refund");
  const left = row.amount_minor - row.refunded_minor;
  const amount = amountMinor == null ? left : amountMinor;
  if (!Number.isInteger(amount) || amount < 1) throw invalid("the refund amount must be a whole number of cents", { field: "amountMinor" });
  if (amount > left) throw invalid(`only ${money(left, row.currency)} is left to refund`, { field: "amountMinor" });
  const why = String(reason ?? "").trim().slice(0, 500);
  if (!why) throw invalid("say why it is being refunded", { field: "reason" });
  const P = await installed();
  const out = await P.payments.refund(tx, { tenantId, intentId: row.payment_intent_id, amountMinor: amount, reason: why, idempotencyKey: `docrefund:${row.id}:${row.refunded_minor}:${amount}`, actorUserId });
  const total = Math.min(row.amount_minor, out.refundedMinor ?? row.refunded_minor + amount);
  const status = total >= row.amount_minor ? "refunded" : "partially_refunded";
  await tx.query(`UPDATE keystone.document_payment SET refunded_minor = $2, status = $3, refunded_at = now(), refund_reason = $4, fee_refunded_minor = LEAST(fee_minor, GREATEST(fee_refunded_minor, $5)), updated_at = now() WHERE id = $1`, [row.id, total, status, why, out.feeRefundedMinor ?? 0]);
  // Run 9 Part 3.7 (Pay3): full or part, and why, in the document's trail — the reason is the sender's own words
  await recordAuditEvent(tx, { tenantId, instanceId: row.instance_id, kind: "refunded", actorRole: "sender", detail: { amount_minor: amount, refunded_minor: total, currency: row.currency, full: status === "refunded", reason: why } });
  return { id: row.id, status, refundedMinor: total, refundedLabel: money(total, row.currency), feeRefundedMinor: out.feeRefundedMinor ?? 0 };
}

/** Run 9 Part 3.7 (Pay3) — a dispute on a payment. DISPUTES STAY IN STRIPE: the event is only a prompt, the dispute is re-read from Stripe, and its status is shown on the Payments page with a
 *  link to answer it in Stripe. The first time a payment is disputed, the document's trail says so. Idempotent. */
export async function recordDisputeEvent(tx, { tenantId, disputeId, intentHint = null }) {
  // the event's own payment id only decides whether to look at all (a practice's dispute is none of ours and costs no Stripe call); what is recorded comes from Stripe's re-read
  if (!intentHint || !(await tx.query(`SELECT 1 FROM keystone.document_payment WHERE tenant_id = $1 AND payment_intent_id = $2`, [tenantId, intentHint])).rowCount) return { applied: false, reason: "not_a_document_payment" };
  const P = await ports();
  if (!P.payments?.configured?.() || !P.payments.disputeState) return { applied: false, reason: "not_a_document_payment" };
  const d = await P.payments.disputeState(tx, { tenantId, disputeId });
  if (!d.paymentIntentId) return { applied: false, reason: "not_a_document_payment" };
  const { rows: [row] } = await tx.query(`SELECT id, instance_id, dispute_id, dispute_status, currency FROM keystone.document_payment WHERE tenant_id = $1 AND payment_intent_id = $2`, [tenantId, d.paymentIntentId]);
  if (!row) return { applied: false, reason: "not_a_document_payment" };
  const status = String(d.status ?? "").slice(0, 40) || null;
  if (row.dispute_id === d.disputeId && row.dispute_status === status) return { applied: false, reason: "already_recorded", status };
  await tx.query(`UPDATE keystone.document_payment SET dispute_id = $2, dispute_status = $3, updated_at = now() WHERE id = $1`, [row.id, d.disputeId, status]);
  if (!row.dispute_id) await recordAuditEvent(tx, { tenantId, instanceId: row.instance_id, kind: "disputed", actorRole: null, detail: { dispute: d.disputeId, amount_minor: d.amountMinor, currency: d.currency ?? row.currency } });
  return { applied: true, reason: "dispute_recorded", status };
}

/** R13-D539: Stripe said a payment attempt failed (a declined card). The event's intent metadata names the party; its pending payment row keeps the last failure so Billing > Payments can show it. Only a pending row changes. */
export async function recordPaymentFailed(tx, { tenantId, partyId, instanceId = null, message = null }) {
  if (!partyId) return { applied: false, reason: "not_a_document_payment" };
  const { rows } = await tx.query(
    `UPDATE keystone.document_payment SET last_failure = $3, last_failed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND party_id = $2 AND status = 'pending' AND ($4::uuid IS NULL OR instance_id = $4) RETURNING id`,
    [tenantId, partyId, String(message ?? "The card was declined.").slice(0, 300), instanceId]);
  return rows.length ? { applied: true, reason: "payment_failure_recorded" } : { applied: false, reason: "not_a_document_payment" };
}

/** Stripe said a subscription's invoice was paid or failed, or the subscription changed: the event is only a prompt. Re-read the subscription from Stripe and copy its status and paid count onto our row. Idempotent. */
export async function recordSubscriptionEvent(tx, { tenantId, subscriptionId }) {
  const { rows: [row] } = await tx.query(`SELECT * FROM keystone.document_payment WHERE tenant_id = $1 AND subscription_id = $2`, [tenantId, subscriptionId]);
  if (!row) return { applied: false, reason: "not_a_document_payment" };
  const P = await installed(); const st = await P.payments.subscriptionState(tx, { tenantId, subscriptionId });
  const done = row.amount_kind === "installments" && st.paidInvoices >= (row.plan_count ?? Infinity);
  const status = done ? "completed" : st.status;
  await tx.query(`UPDATE keystone.document_payment SET payments_made = $2, sub_status = $3, updated_at = now() WHERE id = $1`, [row.id, Math.max(row.payments_made, st.paidInvoices), status]);
  if (["past_due", "unpaid"].includes(status) && row.sub_status !== status) await paymentEvent(tx, row, { topic: "documents.payment.failed", subscription_status: status });   // R13-D354: told once per change into failure
  if (row.sub_status === "needs_cap" && row.amount_kind === "installments") { try { await P.payments.limitSubscription(tx, { tenantId, subscriptionId, every: row.plan_every, count: row.plan_count }); } catch (e) { console.error(`payment ${row.id}: cap retry failed: ${e?.message ?? e}`); } }
  return { applied: true, reason: "subscription_updated", paymentsMade: st.paidInvoices, status };
}
