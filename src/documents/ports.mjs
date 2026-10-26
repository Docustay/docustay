// src/documents/ports.mjs — THE ISLAND'S PORTS (Docustay, QUEUE §4, the maintainer 2 Oct 2026). Documents never imports another domain: where it needs something from outside
// (send an email, know the practice's brand, look up a person, read booking/invoice/subscription facts for a merge field, freeze a price, meter e-sign usage, repoint
// an item's agreement requirement) it asks a PORT, defined here as plain function shapes. The host (the platform) plugs its implementations in at startup
// (src/ports/documents.mjs, installed by server.mjs and worker.mjs). Docustay, lifted out, plugs in its own.
//
// ★ Documents KEEPS the ability to send documents by email — through the `mailer` port. That is how Docustay sends.
// ★ If nothing has been installed (a script, a test), the first use asks the host's composition root ONCE (the one declared edge `../ports/documents.mjs`).
//
// THE PORTS (each takes the caller's tenant transaction `tx`):
//   mailer.sendSigningEmail({to, practiceName, logoUrl, recipientName, documentTitle, message, link, senderName, fallbackTemplateKey?, isReminder?}) → {status}
//   brand.get(tx, {tenantId})            → {practiceName, logoUrl, tenantName, slug, timezone, publicBase}   (publicBase = https://<slug>.<app domain>)
//   people.byIds(tx, ids)                → [{id, display_name, email, role}]
//   people.guardianOf(tx, childId)       → {id, email, display_name} | null     (first guardian with an email, deterministic)
//   people.childrenOf(tx, guardianId)    → [{id, display_name, email, role, is_minor}]   (OPTIONAL: the people this person is parent/guardian of)
//   people.ownerOf(tx, personId)         → app_user id of that person's assigned coach | null
//   people.practiceOwner(tx)             → app_user id of the practice's owner | null (who a public self-serve link's documents are made as)
//   facts.gather(tx, {tenantId, personId, subjectId, bookingId, invoiceId, audience}) → {tenant, settings, person, nextBooking, invoice, subscription}
//   facts.gatherBatch(tx, tenantId, personIds) → {tenant, settings, people: Map}
//   price.current(tx, {tenantId, subjectType, subjectId}) → {id, amount_minor, currency, effective_from} | null
//   usage.recordEsign(tx, {tenantId, instanceId})
//   notices.sentToEmails(db, {instanceId}) → [email]   (the recipients the host actually notified when this document was sent)
//   items.repointAgreementRequirements(tx, {tenantId, templateId, name, builder})   — "service requires agreement X" follows the template to its new version
//   people.search(tx, {q, limit})        → [{id, display_name, email, role}]   (pick a recipient)
//   access.assertMay(tx, principal, check, args)   the host's permission check
//   secrets.seal({tenantId, purpose, plaintext}) → {envelope, fingerprint, kekVersion} · secrets.open({envelope, tenantId, purpose, kekVersion}) → plaintext   (envelope encryption; the island stores the envelope)
//   mailer.renderSigningEmail(opts) → {subject, html, text} · mailer.send({to, subject, html, text, attachments?, identity, orgName}) → {status, providerMessageId, error}
//   mailer.routeRecipient({to, subject}) → {to, subject} (throws when the environment may not mail this address) · mailer.platformSender() → {name, address}
//   mailer.domains.create(domain) / verify(ref) / get(ref) → {ref, status:'pending'|'verified'|'failed', records:[{record,name,type,value,priority,ttl,status}]}
//   files.configured() → bool · files.bucket() → name · files.put({tenantId, id, bytes, kind?}) → {key}  (the host seals the bytes with the workspace's own key before they are stored; `kind` is document_file (default) or executed_document) · files.get({key}) → Buffer · files.delete({key})   (where uploaded files and their sealed copies are kept; bytes never go in the database)
//   payments (OPTIONAL — a host with no payments says so and a payment field cannot be sent; Stripe's HOSTED CHECKOUT, a direct charge on the workspace's own account — no card data ever reaches the island or the host):
//     payments.configured() → bool · payments.ready(tx, {tenantId}) → {status: connected|needs_attention|not_connected} · payments.feeFor(tx, {tenantId, amountMinor}) → {bps, feeMinor, planKey} (the host's platform fee, decided now) · payments.priceInfo(tx, {tenantId, priceId}) → {priceId, amountMinor, currency, name}
//     · payments.linkInfo(tx, {tenantId, url}) → {lineItems, amountMinor, currency, name} · payments.checkout(tx, {tenantId, amountMinor, currency, lineItems?, name, instanceId, partyId, fieldId, successUrl, cancelUrl, idempotencyKey, feeMinor}) → {sessionId, url, expiresAt}
//     · payments.checkoutStatus(tx, {tenantId, sessionId}) → {sessionStatus, paymentStatus, paid, intentId, amountMinor, currency, receiptUrl, refundedMinor, applicationFeeMinor, reference} (read from the provider) · payments.expire(tx, {tenantId, sessionId}) → void
//     · payments.refund(tx, {tenantId, intentId, amountMinor, reason, idempotencyKey, actorUserId}) → {refundId, refundedMinor, feeRefundedMinor} (the platform fee goes back with the refund). The island never imports Stripe.
//   entitlements.assertMaySend(tx, {tenantId}) → void (throws a refusal when the host's plan does not allow another send) — OPTIONAL: a host with no plans omits it
//   entitlements.sendAllowance(tx, {tenantId}) → {used, limit, plan, paid, resetsAt} | null (OPTIONAL, read-only, Run 8: shown on the Check step before a send would be refused)
//   entitlements.aiPolicy(tx, {tenantId, now}) → {plan, planKey, creditsPerMonth, usdCapMicro, perMinute, perHour, perDay, maxQueued, inputTokens, outputTokens, toolTurns, summariseAfter, fileMb, filePages, weights, platformMonthlyUsd, window:{start,end}} | null (OPTIONAL: the plan's AI allowance, caps and request limits; null/absent = no hosted limits, only the workspace's own AI settings and the abuse limits)
//   entitlements.assertMayCreateTemplate(tx, {tenantId}) → void (OPTIONAL, Run 8: throws 403 plan_template_limit when the plan has used its new templates this month; absent = no cap)
//   entitlements.noteTemplateCreated(tx, {tenantId}) → void (OPTIONAL: the host's 4-of-5 / 5-of-5 notices after a new template)
//   entitlements.aiDraftsPerMonth(tx, {tenantId}) → number | null (OPTIONAL: the plan's monthly allowance of AI-made drafts; null/absent = only the workspace's own AI limits apply) · entitlements.isEntitled(tx, {tenantId, item}) → bool
//   entitlements.noteDocumentSent(tx, {tenantId, instanceId}) · entitlements.assertAiBudget(tx, {tenantId}) · entitlements.noteAiBilled(tx, {tenantId, identifier}) (OPTIONAL: usage billing on the hosted service; absent = nothing is metered)
//   entitlements.bulkCap(tx, {tenantId}) → number | null (OPTIONAL: the most rows one list send may carry on the host's plan; Free 15; null/absent = no plan cap)
//   entitlements.noteEmailPaused(tx, {tenantId, cause, reason}) (OPTIONAL: the email guard just paused this workspace; the host tells its Owners and lists it for review; absent = nothing more happens)
//   entitlements.maxUploadMb(tx, {tenantId}) → number | null (OPTIONAL: the biggest upload the host's plan allows; null/absent = only the island's own `upload.max_mb` setting limits)
//   demo.isDemo(tx) → bool · demo.aiMode(tx, {hasKey}) → 'real'|'scripted'|null · demo.refundAiPrompt(tx) · demo.checkUpload(tx, {bytes}) (OPTIONAL, Launch step 8: the public demo's limits; absent = never a demo)
//   events.firstDocumentSent(tx, {tenantId}) (OPTIONAL, Launch step 6: the host's usage event; absent = nothing is sent)
//   converter.available() → bool · converter.htmlToPdf({html, paper, margins, footerHtml}) → Buffer   (a document written as HTML → PDF; uploads are PDF only and never converted)
// ★ QUEUE §23.3.3 — the host's merge-field namespaces (person.*, booking.*, money.*, subscription.*, workbench.*, practice.*) are REGISTERED into the island's live catalogue here, the one place the island
//   touches the host's list: a pure-data file with no imports. Docustay, lifted out, points this one line at its own (or at nothing). Browser side: `plugDocumentsHost({ variables })`.
import { registerVariables } from "./variableCatalogue.mjs";
import { HOST_VARIABLES, HOST_NEVER_RESOLVES } from "../ports/documentsVariables.mjs";
registerVariables(HOST_VARIABLES, { neverResolves: HOST_NEVER_RESOLVES });

const REQUIRED = Object.freeze(["mailer", "brand", "people", "facts", "price", "usage", "items", "notices", "access", "secrets", "files", "converter"]);
let installed = null;

export function installDocumentsPorts(impl) {
  for (const k of REQUIRED) if (!impl?.[k]) throw new Error(`installDocumentsPorts: the "${k}" port is missing`);
  installed = Object.freeze({ ...impl });
}
export const documentsPortsInstalled = () => installed !== null;

/** The installed ports (async: a host that has not installed them yet is asked once, through its composition root). */
export async function ports() {
  if (installed) return installed;
  const host = await import("../ports/documents.mjs");
  host.installHostDocumentsPorts();
  if (!installed) throw new Error("Documents has no ports installed and the host did not install them");
  return installed;
}
