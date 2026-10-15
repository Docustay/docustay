// src/documents/certificateFacts.mjs — everything the Certificate of Completion states, read from the island's own records (QUEUE §23.2.7, research §5):
// per signer — sent, viewed (first open, with IP and device), agreed-to-sign-electronically (consent version, time, IP, device), signed (time, IP, device) — plus the timeline, the sender, and the hashes.
// People's names and emails come from the `people` port, never from the host's tables directly.
import { ports } from "./ports.mjs";
import { auditTrailFor } from "./auditTrail.mjs";
import { partiesOf, documentsOfSend } from "./parties.mjs";
import { money } from "./pdfPayments.mjs";
import { signatureIdOf } from "./signingPolicy.mjs";

/**
 * @param {object} tx a tenant transaction whose viewer may read the document
 * @param {{tenantId:string, instance:object, signatures:Array}} a
 */
export async function gatherCertificateFacts(tx, { tenantId, instanceId, instance, signatures }) {
  const P = await ports();
  const uids = [...new Set([...signatures.map((s) => s.signer_uid), instance.created_by].filter(Boolean))];
  const people = new Map((await P.people.byIds(tx, uids)).map((p) => [p.id, p]));

  const { rows: opens } = await tx.query(
    `SELECT opened_by, ip, user_agent, opened_at FROM keystone.document_open WHERE instance_id = $1 ORDER BY opened_at ASC`, [instanceId]);
  const { rows: consents } = signatures.some((s) => s.signer_uid)
    ? await tx.query(
        `SELECT app_user_id, version, accepted_at, accepted_ip, user_agent FROM keystone.esign_disclosure_acceptance
          WHERE app_user_id = ANY($1::uuid[]) AND accepted_at <= $2 ORDER BY accepted_at DESC`,
        [signatures.map((s) => s.signer_uid).filter(Boolean), instance.executed_at])
    : { rows: [] };
  const timeline = await auditTrailFor(tx, { tenantId, instanceId });

  // ★ QUEUE §23.3.2 — the island's own party snapshot answers first (it outlives the person); the host's directory is only the fallback for a send that predates it
  const snapshots = await partiesOf(tx, { instanceId });
  // Part 30 item 11 — what each signer paid on this send (every document in the package), by Stripe's own reference; only money that actually arrived
  const members = await documentsOfSend(tx, { instanceId });
  const { rows: paid } = await tx.query(
    `SELECT party_id, amount_minor, currency, status, paid_at, COALESCE(payment_intent_id, checkout_session_id) AS stripe_ref FROM keystone.document_payment WHERE instance_id = ANY($1::uuid[]) AND status IN ('paid','partially_refunded','refunded') ORDER BY paid_at`,
    [members.map((m) => m.id)]);
  // Run 9: who witnessed each signature (on the same device, straight after), from the island's own evidence rows
  const { rows: witnesses } = await tx.query(`SELECT party_id, name, email, signed_at, mark_sha256 FROM keystone.document_witness WHERE instance_id = $1`, [instanceId]);
  const parties = signatures.map((s) => {
    // a signing group has several people in one seat: the one who signed is the one this signature belongs to
    const inSeat = snapshots.filter((p) => p.role === s.role);
    const snap = inSeat.find((p) => p.status === "signed") ?? inSeat[0] ?? null;
    const w = snap ? witnesses.find((x) => x.party_id === snap.id) : null;
    const person = snap ? { email: snap.email } : (people.get(s.signer_uid) ?? null);
    const open = opens.find((o) => o.opened_by && o.opened_by === s.signer_uid) ?? opens[0] ?? null;
    const consent = consents.find((c) => c.app_user_id === s.signer_uid) ?? null;
    return {
      name: s.signer_name, email: person?.email ?? null, role: s.role,
      sentAt: instance.sent_at ?? null,
      // a person with no account (an uploaded document) has their first look recorded on their own party row
      viewedAt: snap?.viewed_at ?? open?.opened_at ?? null, viewedIp: snap?.viewed_ip ?? open?.ip ?? null, viewedUserAgent: snap?.viewed_user_agent ?? open?.user_agent ?? null,
      consentedAt: snap?.consented_at ?? consent?.accepted_at ?? null, consentVersion: snap?.consent_version ?? consent?.version ?? null,
      signedAt: s.signed_at, signedIp: s.signer_ip ?? null, signedUserAgent: s.user_agent ?? null,
      // Part 30 item 5 — why they signed (when asked), who the seat was passed on from, and the ID printed beside their signature
      reason: snap?.sign_reason ?? null, delegatedFrom: snap?.delegated_from_name ? { name: snap.delegated_from_name, email: snap.delegated_from_email ?? null, at: snap.delegated_at ?? null } : null,
      signatureId: signatureIdOf(s.row_hash),
      group: snap?.group_label ?? null,
      witness: w ? { name: w.name, email: w.email ?? null, at: w.signed_at instanceof Date ? w.signed_at.toISOString() : w.signed_at, markSha256: w.mark_sha256 ?? null } : null,
      payments: snap ? paid.filter((x) => x.party_id === snap.id).map((x) => ({ label: money(x.amount_minor, x.currency), amountMinor: x.amount_minor, currency: x.currency, reference: x.stripe_ref, at: x.paid_at instanceof Date ? x.paid_at.toISOString() : x.paid_at ?? null, status: x.status })) : [],
    };
  });
  const sender = instance.created_by ? people.get(instance.created_by) : null;
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
  const norm = (p) => ({ ...p, sentAt: iso(p.sentAt), viewedAt: iso(p.viewedAt), consentedAt: iso(p.consentedAt), signedAt: iso(p.signedAt) });
  return {
    completedAt: iso(instance.executed_at),
    sender: sender ? { name: sender.display_name, email: sender.email } : null,
    parties: parties.map(norm),
    timeline: timeline.map((e) => ({ kind: e.kind === "uploaded" && e.detail?.origin === "created" ? "created" : e.kind, at: iso(e.occurred_at), role: e.actor_role,
      ...(e.kind === "hidden_by_rule" ? { leftOut: { labels: (e.detail?.labels ?? e.detail?.sections ?? []).map(String), pages: (e.detail?.pages ?? []).map(Number).filter(Number.isInteger) } } : {}) })),   // Run 9: what a rule left out (labels the sender wrote, page numbers)   // D-007: a document written in the editor was never uploaded
    originalSha256: instance.original_sha256 ?? null,
  };
}
