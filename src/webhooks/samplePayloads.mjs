// R13-D230: the sample body of a webhook TEST send, one per public topic. Before, every test carried the same "Sample agreement" body whatever topic was chosen, so a developer's handler was built against a shape the
// real event never has. Each sample here carries the same payload keys and subject_type as the real emitter (test/r13_webhook_test_payloads.test.mjs reads the emitters' source and fails when one gains a key this lacks).
// Values are harmless: random ids, round numbers, example.com addresses, no real names. A topic not listed gets the generic sample it always had.
import { randomUUID } from "node:crypto";

const NOTE = "This is a test event from Docustay. No real document was involved.";
const now = () => new Date().toISOString();
const later = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const role = "signer";
const email = () => ({ email_id: randomUUID(), kind: "invitation", seat: "signer-1" });
const usage = (extra) => ({ kind: "documents", percent: 80, used: 12, limit: 15, plan: "free", period_start: now(), period_end: later(30), ...extra });
const money = (extra) => ({ document_id: randomUUID(), payment_id: randomUUID(), amount_minor: 5000, currency: "usd", ...extra });

// topic -> [subject_type, payload builder]. A null subject_type means the real event names no subject (subject_id is null too).
const SAMPLES = {
  "documents.document.created": ["document", () => ({ builder: "pdf", state: "draft", assigned_to: null })],
  "documents.document.sent": ["document", () => ({ builder: "pdf", state: "sent", sent_by: randomUUID(), sent_at: now(), template_body_frozen: false, send_mode: "email", body_overridden: false })],
  "documents.document.opened": ["document", () => ({ role, builder: "pdf" })],
  "documents.document.signed": ["document", () => ({ role, builder: "pdf", signature_record_stored: true, signature_record_id: randomUUID(), signer_order: 1, of: 2, remaining_parties: 1, chained: false })],
  "documents.document.declined": ["document", () => ({ role, builder: "pdf", approver: false })],
  "documents.document.changes_requested": ["document", () => ({ role, builder: "pdf" })],
  "documents.document.delegated": ["document", () => ({ role })],
  "documents.document.executed": ["document", () => ({ builder: "pdf", test: true, executed_at: now(), executed_by: randomUUID(), archive_actor_id: randomUUID(), price_frozen: false, disclosure_captured: true, disclosure_version: "sample-1", law3_complete: true, planId: null, appUserId: null, contractId: null, createdByDocumentId: null })],
  "documents.document.voided": ["document", () => ({ builder: "pdf", signatures_before_void: 0 })],
  "documents.document.expired": ["document", () => ({ sent_at: later(-14), expires_at: now() })],
  "documents.document.reminder_due": ["document", () => ({ builder: "pdf", reminders_sent: 1, next_reminder_at: later(3) })],
  "documents.document.bounced": ["document", () => ({ role, builder: "pdf", reason: "not_sent", status: "failed" })],
  "documents.document.downloaded": ["document", () => ({ what: "signed_copy" })],
  "documents.approval.requested": ["document", () => ({ approvalId: randomUUID() })],
  "documents.approval.decided": ["document", () => ({ approvalId: randomUUID(), decision: "approved" })],
  "documents.payment.hold_lapsed": ["document", () => ({ role, builder: "pdf" })],
  "documents.payment.received": ["document", () => money({ payment_intent: "pi_sample_123" })],
  "documents.payment.failed": ["document", () => money({ subscription_status: "past_due" })],
  "documents.template.created": ["document_template", () => ({ builder: "pdf", version: 1, kind: "document", how: "upload", size: 1 })],
  "documents.email.delivered": ["document", email],
  "documents.email.bounced": ["document", email],
  "documents.email.complained": ["document", email],
  "documents.email.paused": [null, () => ({ cause: "bounced", sent: 100, bounced: 6, complained: 0 })],
  "documents.template.fields_detected": ["document_template", () => ({ template_id: randomUUID(), fields_found: 6, signers: 2, low_confidence: 0, placed: 6 })],
  "documents.ai.allowance_low": [null, () => ({ plan: "free", used: 8, allowance: 10, percent: 80, resets_at: later(10) })],
  "documents.usage.threshold": ["usage_period", () => usage({ used_minor: 800, limit_minor: 1000, documents: 12, drafts: 3, amount_minor: 1200 })],
  "documents.team.created": [null, () => ({ team_id: randomUUID() })],
  "documents.team.updated": [null, () => ({ team_id: randomUUID(), what: "renamed", count: 3 })],
  "documents.team.deleted": [null, () => ({ team_id: randomUUID() })],
};

/** @returns {{ subject_type: string|null, payload: object }} the body of a test send for `topic`: the real event's keys with sample values, plus `test: true` and the note. */
export function samplePayloadFor(topic) {
  const hit = Object.hasOwn(SAMPLES, String(topic)) ? SAMPLES[topic] : null;
  if (!hit) return { subject_type: "document", payload: { test: true, title: "Sample agreement", state: String(topic ?? "").endsWith(".executed") ? "executed" : "sent", externalId: "sample-contract-1", metadata: { example: "value" }, note: NOTE } };
  return { subject_type: hit[0], payload: { test: true, ...hit[1](), note: NOTE } };
}
