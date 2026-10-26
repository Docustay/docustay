// src/documents/pdfVerify.mjs — "CHECK WHO IS SIGNING" (QUEUE §23.5.2, migration 0611). Before a document opens, a send may ask each person for an EMAIL CODE (six digits mailed to the address on the send) or an ACCESS CODE (chosen by the sender,
// told to the person some other way). ★ Only hashes are kept. Five wrong tries lock the person for 15 minutes; a correct code opens it and is recorded as evidence ("Identity checked").
import { languageFor } from "./signerLanguage.mjs";
import { signingWords } from "./signingWords.mjs";
import { randomInt, randomBytes, scryptSync, createHash, timingSafeEqual } from "node:crypto";
import { forbidden, invalid, conflict } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { sendMail } from "./emailIdentity.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { wordingFor, render as renderWording } from "./emailMessages.mjs";

const MAX_TRIES = 5, LOCK_MINUTES = 15, CODE_MINUTES = 10, RESEND_SECONDS = 30;
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** `salt:hash` for an access code (scrypt). */
export function hashAccessCode(code) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(String(code), salt, 32).toString("hex")}`;
}
function accessCodeMatches(code, stored) {
  const [salt, hash] = String(stored ?? "").split(":");
  if (!salt || !hash) return false;
  return safeEq(scryptSync(String(code), salt, 32).toString("hex"), hash);
}

/** Does this person still have to prove themselves before seeing the document? → null or { kind: 'email_code'|'access_code' }. */
export function gateFor(party, lead) {
  const mode = lead.send_options?.verification ?? "none";
  if (mode === "none" || party.verified_at) return null;
  if (mode === "access_code" && !lead.send_options?.access_code_hash) return null;     // the checklist refuses this at send; an old row never locks someone out of a document
  if (mode === "email_code" && !party.email) return null;                                // in-person seats have no address: the person at the device is the check
  return { kind: mode };
}

export const maskEmail = (e) => { const [u, d] = String(e ?? "").split("@"); return u && d ? `${u[0]}${"•".repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}` : null; };

/** Refuse unless the person has passed the check (used by every route past `view`). */
export function requireVerified(party, lead) {
  if (gateFor(party, lead)) throw forbidden("Enter the code first — this document asks you to confirm who you are.");
}

/** Email the person a fresh six-digit code (valid 10 minutes; at most one every 30 seconds). */
export async function sendVerificationCode(tx, { tenantId, party, lead, title }) {
  if (lead.send_options?.verification !== "email_code") throw conflict("this document does not ask for an email code");
  if (!party.email) throw invalid("there is no email address to send a code to");
  if (party.verify_locked_until && new Date(party.verify_locked_until) > new Date()) throw conflict(`Too many wrong tries — try again in a few minutes.`, { code: "locked" });
  if (party.verify_code_sent_at && Date.now() - new Date(party.verify_code_sent_at).getTime() < RESEND_SECONDS * 1000) throw conflict("A code was just sent — give it a moment, then ask again.", { code: "too_soon" });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await tx.query(`UPDATE keystone.document_party SET verify_code_hash = $2, verify_code_expires_at = now() + ($3 || ' minutes')::interval, verify_code_sent_at = now(), updated_at = now() WHERE id = $1`, [party.id, sha(`${party.id}:${code}`), String(CODE_MINUTES)]);
  const { practiceName } = await (await ports()).brand.get(tx, { tenantId });
  // ★ Batch A — the wording is the `documents.email_code` template (editable in Run → Templates). A host with no template renderer (a standalone shell) gets the same default words from here.
  const P = await ports();
  let subject = `${code} is your code for “${title}”`;
  let text = `Your code is ${code}.\n\nIt opens “${title}” from ${practiceName} and works for ${CODE_MINUTES} minutes. If you were not expecting this, ignore this email — nothing can be opened without the code.`;
  if (P.mailer.renderTemplate) {
    const r0 = await P.mailer.renderTemplate(tx, { tenantId, key: "documents.email_code", vars: { code, documentTitle: title, practiceName, minutes: String(CODE_MINUTES) } });
    subject = r0.subject; text = r0.text;
  }
  const W = signingWords((await languageFor(tx, { sendOptions: lead.send_options, party })).language);   // es / fr / de: fixed words from the shared table; English keeps the editable template
  if (W) { subject = W.code.subject(code, title); text = W.code.text(code, title, practiceName, CODE_MINUTES); }
  // FP-K2 — the workspace's own wording for the code email, in this person's language, when it has saved one
  const own = await wordingFor(tx, { kind: "code", locale: (await languageFor(tx, { sendOptions: lead.send_options, party })).language ?? "en" });
  if (own?.custom) { const r1 = renderWording(own, { "signer.name": party.name ?? "", "signer.email": party.email ?? "", "document.title": title, "org.name": practiceName, code, minutes: String(CODE_MINUTES) }); if (r1.subject) subject = r1.subject; if (r1.body) text = r1.body; }
  const esc = (v) => String(v).replace(/[<>&]/g, "");
  const html = `<p style="font:16px/1.5 system-ui,sans-serif">Your code is</p><p style="font:700 30px/1.2 ui-monospace,monospace;letter-spacing:4px">${code}</p><p style="font:14px/1.5 system-ui,sans-serif;color:#555">${esc(text.split("\n\n").slice(1).join(" "))}</p>`;
  const r = await sendMail(tx, { tenantId, to: party.email, subject, html, text, log: { instanceId: lead.id, partyId: party.id, seat: party.role, kind: "code", secret: code } });
  if (r.status === "failed") throw conflict("The code could not be emailed. Try again, or ask the sender to check the address.", { code: "email_failed" });
  return { sent: true, to: maskEmail(party.email), validMinutes: CODE_MINUTES };
}

/** Check the code the person typed. Opens the document (verified_at) or counts a wrong try. */
export async function verifyParty(tx, { tenantId, party, lead, code }) {
  const gate = gateFor(party, lead);
  if (!gate) return { verified: true };
  const typed = String(code ?? "").replace(/\s+/g, "");
  if (!typed) throw invalid("Enter the code.", { field: "code" });
  // ★ A wrong answer is RETURNED, never thrown: the count of tries lives in this transaction, and a throw would roll it back — the lock would never trigger.
  const LOCKED = { verified: false, code: "locked", message: "Too many wrong tries — try again in a few minutes.", triesLeft: 0 };
  if (party.verify_locked_until && new Date(party.verify_locked_until) > new Date()) return LOCKED;
  let ok = false;
  if (gate.kind === "access_code") ok = accessCodeMatches(typed, lead.send_options.access_code_hash);
  else ok = Boolean(party.verify_code_hash) && new Date(party.verify_code_expires_at) > new Date() && safeEq(sha(`${party.id}:${typed}`), party.verify_code_hash);
  if (!ok) {
    const tries = (party.verify_attempts ?? 0) + 1;
    await tx.query(`UPDATE keystone.document_party SET verify_attempts = $2::int, verify_locked_until = CASE WHEN $2::int >= $3::int THEN now() + ($4 || ' minutes')::interval ELSE verify_locked_until END, updated_at = now() WHERE id = $1`, [party.id, tries, MAX_TRIES, String(LOCK_MINUTES)]);
    if (tries >= MAX_TRIES) return LOCKED;
    const expired = gate.kind === "email_code" && party.verify_code_expires_at && new Date(party.verify_code_expires_at) <= new Date();
    return { verified: false, code: expired ? "expired" : "wrong_code", message: expired ? "That code has expired — ask for a new one." : `That code is not right. ${MAX_TRIES - tries} ${MAX_TRIES - tries === 1 ? "try" : "tries"} left.`, triesLeft: MAX_TRIES - tries };
  }
  await tx.query(`UPDATE keystone.document_party SET verified_at = now(), verify_code_hash = NULL, verify_attempts = 0, verify_locked_until = NULL, updated_at = now() WHERE id = $1`, [party.id]);
  await recordAuditEvent(tx, { tenantId, instanceId: lead.id, kind: "verified", actorRole: party.role, detail: { method: gate.kind } });
  return { verified: true };
}
