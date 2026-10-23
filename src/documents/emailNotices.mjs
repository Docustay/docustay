// src/documents/emailNotices.mjs — THE TWO EMAILS DOCUSTAY SENDS THAT HAD NO EMAIL BEFORE (FP-K1, 7 Oct 2026): "cancelled" to the people who were asked to sign, and a payment receipt to the person who paid.
// Both go ONLY to people named on the document (FP-K5), with the workspace's own wording when it has saved some, in the person's language when that language has a saved wording and in English otherwise.
// A failure to send never fails the action that caused it (voiding, paying): it is logged and the action stands.
import { ports } from "./ports.mjs";
import { sendMail } from "./emailIdentity.mjs";
import { alreadyEmailed } from "./emailLog.mjs";
import { wordingFor, render, messageKind } from "./emailMessages.mjs";
import { plainFrame } from "./emailFrame.mjs";
import { languageFor } from "./signerLanguage.mjs";

const money = (minor, currency) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "usd").toUpperCase() }).format((minor ?? 0) / 100); } catch { return `${((minor ?? 0) / 100).toFixed(2)} ${String(currency || "").toUpperCase()}`; } };


async function mailOne(tx, { tenantId, kind, to, vars, language, log = {} }) {
  const k = messageKind(kind);
  const w = await wordingFor(tx, { kind, locale: language ?? "en" });
  const r = render(w, vars, { standard: true, kind });
  const html = plainFrame({ org: vars["org.name"], subject: r.subject, body: r.body, footer: r.footer });
  return sendMail(tx, { tenantId, to, subject: r.subject, html, text: `${r.body}\n${r.footer ? `\n${r.footer}\n` : ""}`, log: { kind, ...log } });
}

/** Tell every person who was invited that the document was cancelled. Returns how many were emailed. */
export async function sendVoidedNotices(tx, { tenantId, leadId, reason = null, actorUserId = null }) {
  try {
    const P = await ports();
    const brand = await P.brand.get(tx, { tenantId });
    const org = brand.practiceName || brand.tenantName || "";
    const [sender] = actorUserId ? await P.people.byIds(tx, [actorUserId]) : [];
    const { rows: [doc] } = await tx.query(`SELECT title, send_options, is_test, created_by FROM keystone.document_instance WHERE id = $1`, [leadId]);
    // a practice run never emails the people on it; like its invitations (pdfSend), the one notice goes to the person who sent it, marked [TEST] (R13-D222)
    const testTo = doc?.is_test ? (doc.created_by ? (await P.people.byIds(tx, [doc.created_by]))[0]?.email ?? null : null) : null;
    if (doc?.is_test && !testTo) return 0;
    const { rows: people } = await tx.query(`SELECT id, name, email, signer_language FROM keystone.document_party WHERE instance_id = $1 AND invited_at IS NOT NULL AND email IS NOT NULL AND action_role IN ('signer','approver','viewer','assistant')`, [leadId]);
    let sent = 0;
    for (const p of (testTo ? people.slice(0, 1) : people)) {
      const language = (await languageFor(tx, { sendOptions: doc?.send_options, party: p })).language ?? "en";
      const out = await mailOne(tx, { tenantId, kind: "voided", to: testTo ?? p.email, language, log: { instanceId: leadId, partyId: p.id },
        vars: { "signer.name": p.name ?? "", "signer.email": p.email, "document.title": testTo ? `[TEST] ${doc?.title ?? ""}` : (doc?.title ?? ""), "sender.name": sender?.display_name || org, "org.name": org, reason: reason || "none given" } });
      if (out.status === "sent") sent += 1;
    }
    return sent;
  } catch (e) { console.error(`cancelled notices for ${leadId} failed: ${e?.message ?? e}`); return 0; }
}

/** The receipt for a paid payment, to the person who paid (Run 9 Part 3.7: sent with the sealed copy, or on its own when the document never completes). → "sent" | "skipped" | "none" | "failed" */
export async function sendReceipt(tx, { tenantId, paymentId }) {
  try {
    const { rows: [p] } = await tx.query(
      `SELECT pay.amount_minor, pay.currency, pay.amount_kind, pay.plan_every, pay.plan_count, pay.is_test, pay.instance_id, party.name, party.email, party.id AS party_id, i.title, i.send_options
         FROM keystone.document_payment pay JOIN keystone.document_party party ON party.id = pay.party_id JOIN keystone.document_instance i ON i.id = pay.instance_id WHERE pay.id = $1`, [paymentId]);
    if (!p?.email) return "none";
    const P = await ports();
    const brand = await P.brand.get(tx, { tenantId });
    const org = brand.practiceName || brand.tenantName || "";
    const language = (await languageFor(tx, { sendOptions: p.send_options, party: { id: p.party_id, email: p.email } })).language ?? "en";
    const what = { chosen: "amount you chose", deposit: "deposit", installments: "first payment of your plan", subscription: "first payment" }[p.amount_kind] ?? "payment";
    const out = await mailOne(tx, { tenantId, kind: "receipt", to: p.email, language, log: { instanceId: p.instance_id, partyId: p.party_id },
      vars: { "signer.name": p.name ?? "", "signer.email": p.email, "document.title": p.title ?? "", "sender.name": org, "org.name": org, amount: money(p.amount_minor, p.currency), description: what } });
    return out.status === "sent" || out.status === "skipped" ? out.status : "failed";
  } catch (e) { console.error(`receipt for payment ${paymentId} failed: ${e?.message ?? e}`); return "failed"; }
}

/** Run 9 Part 3.7: tell a signer their held signature lapsed unpaid. Only a person named on the document; once per hold (the caller runs once per lapse). */
export async function sendHoldLapsedNotice(tx, { tenantId, partyId }) {
  try {
    const { rows: [p] } = await tx.query(`SELECT party.id, party.name, party.email, i.id AS instance_id, i.title, i.send_options, i.is_test FROM keystone.document_party party JOIN keystone.document_instance i ON i.id = party.instance_id WHERE party.id = $1`, [partyId]);
    if (!p?.email || p.is_test) return false;   // a practice run never emails the people on it
    const P = await ports();
    const brand = await P.brand.get(tx, { tenantId });
    const org = brand.practiceName || brand.tenantName || "";
    const language = (await languageFor(tx, { sendOptions: p.send_options, party: { id: p.id, email: p.email } })).language ?? "en";
    const out = await mailOne(tx, { tenantId, kind: "hold_lapsed", to: p.email, language, log: { instanceId: p.instance_id, partyId: p.id },
      vars: { "signer.name": p.name ?? "", "signer.email": p.email, "document.title": p.title ?? "", "sender.name": org, "org.name": org } });
    return out.status === "sent";
  } catch (e) { console.error(`hold-lapsed notice for ${partyId} failed: ${e?.message ?? e}`); return false; }
}
