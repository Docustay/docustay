// P19.9 — THE AUDIT LOG IS THE `event` TABLE, READ BACK.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NO NEW TABLE, AND THAT IS THE POINT. Every write in this system already emits an outbox event
//     in the SAME transaction as the row it describes (U26, 56 call sites). A separate `audit_event`
//     table would be a SECOND record of the same facts, written by the same code — and two records of
//     one fact disagree the first time somebody forgets one. **The audit log is a READ, not a write.**
//   ★ F13 already measured the cost of pretending otherwise: a feed pointed at `audit_event`, a table
//     that does not exist.
//
// ★★★ §A9 — IMPERSONATION IS VISIBLE **TO THE TENANT**, AND THAT IS THE CONDITION OF IT EXISTING.
//     *"Impersonation is written to the audit log and is visible to the tenant. This is the feature
//     that gets abused if it is not recorded."* So `platform.impersonation.started` is NOT filtered out
//     of a tenant's own audit view. A platform operator cannot look at a tenant's data without the
//     tenant being able to see that they did.
//   ★★ This is enforced by there being **no exclusion list in this module at all** — and asserted by a
//      gate that emits an impersonation event and then reads it back as the tenant.
//
// ★ U30: every row describes itself in words. A log that shows `documents.document.executed` and a
//   raw UUID is a log a coach cannot read, and an audit trail nobody reads is not a control.

import { safeFacts } from "../events/outbox.mjs";

/** ★ The audit view is the whole closed topic vocabulary — there is nothing a tenant may not see. */
const AUDIT_EXCLUDES_NOTHING = true;

/**
 * Human wording for a topic. ★ Data, not a switch buried in a component, so the UI and any export
 * describe an event the same way — and a topic with no entry falls back to a readable form of itself
 * rather than rendering a dotted token on screen (the i18n-echo defect, one domain over).
 */
export const TOPIC_WORDING = Object.freeze({
  "documents.document.sent": "sent a document",
  "documents.document.signed": "signed a document",
  "documents.document.executed": "completed a document",
  "documents.document.declined": "declined a document",
  "documents.document.created": "created a document",
  "documents.type.created": "added a document type",
  "documents.category.created": "added a document category",
  "documents.disclosure.accepted": "accepted the electronic-records disclosure",
  "documents.disclosure.withdrawn": "withdrew the electronic-records disclosure",
  "documents.template.created": "created a template",
  "documents.template.versioned": "published a new template version",
  "documents.template.updated": "edited a template",
  "documents.setting.changed": "changed a document setting",
  "documents.document.voided": "voided a document",
  "documents.document.discarded": "discarded a draft",
  "documents.ai.allowance_low": "was told the AI allowance is running low",
  "documents.template.fields_detected": "had its fields found automatically",
  "documents.team.created": "created a team",
  "documents.team.updated": "changed a team",
  "documents.team.deleted": "deleted a team",
  "documents.document.delegated": "passed a document to someone else to sign",
  "documents.document.downloaded": "downloaded a signed copy",
  "booking.booking.created": "booked a session",
  "booking.booking.confirmed": "confirmed a session",
  "booking.booking.cancelled": "cancelled a session",
  "booking.booking.rescheduled": "rescheduled a session",
  "booking.entitlement.exhausted": "used the last session in a package",
  "booking.entitlement.expiring": "has a package expiring",
  "booking.entitlement.running_low": "has a package running low",
  "booking.availability.changed": "changed availability",
  "booking.policy.changed": "changed the booking policy",
  "booking.participant.added": "added someone to a session",
  "money.invoice.opened": "opened an invoice",
  "money.invoice.paid": "recorded an invoice as paid",
  "money.invoice.marked_paid": "recorded an invoice as paid by offline method",
  "money.invoice.marked_uncollectible": "marked an invoice as uncollectible (bad debt — money is written off)",
  "money.invoice.duplicated": "duplicated an invoice",
  "money.dispute.closed": "closed a dispute (conceded — money lost)",
  "money.credit.adjusted": "adjusted customer credit balance",
  "money.credit_note.issued": "issued a credit note against an invoice",
  "money.credit_note.voided": "voided a credit note",
  "money.payment.failed": "had a payment fail",
  "money.payment.refunded": "refunded a payment",
  "money.subscription.started": "started a subscription",
  "money.subscription.cancelled": "cancelled a subscription",
  "money.line_item.created": "added a charge",
  "money.payment_method.added": "added a payment method",
  "money.entitlement.granted": "granted session credits",
  "money.entitlement.voided": "voided unused session credits (package refunded)",
  "money.charge.attempted": "attempted a card charge",
  "people.person.created": "added a person",
  "people.person.archived": "archived a person",
  "people.person.updated": "updated a person",
  // ★ FIX ROUND 1 (from task-4-review.md Minor #2 / task-4-report.md Open Question #3). This was
  //   also capitalised, the same defect class as `items.price.changed` and
  //   `platform.impersonation.started` (below) before Stage 4 Task 4's F508 fix — but F508's own
  //   text names only those two, so this one was correctly left unfixed under F508's number and
  //   flagged instead. Fixed here to match the map's sentence-case convention; not filed as its
  //   own finding number since the fix-round brief is the record of it.
  "people.person.role_changed": "changed someone's role",
  "people.person.invited": "invited a team member",
  "people.preference.changed": "changed a notification preference",
  "accounts.account.created": "created an account",
  "accounts.account.updated": "updated an account",
  "accounts.pipeline.created": "started a pipeline",
  "accounts.pipeline.advanced": "advanced a pipeline",
  "network.party.created": "added a network party",
  "network.party.updated": "updated a network party",
  "items.service.created": "added a service",
  "items.package.created": "added a package",
  "items.plan.created": "added a plan",
  // ★ Stage 4 Task 4 — F508. Was "CHANGED A PRICE" (capitals, unlike every other row here). Fixed
  //   to sentence case, matching the wording convention every other topic in this map already uses.
  "items.price.changed": "changed a price",
  "growth.campaign.sent": "sent a campaign",
  // ★ NEW (task 20.48). Growth sequence and engagement events.
  "growth.template.activated": "activated a template version",
  "growth.campaign_group.created": "created a campaign",
  // ★ RUN-2 T19 — wording for the 27 topics catalogued the same day (topics.mjs).
  "money.dispute.stripe_error": "Stripe refused a dispute update",
  "money.estimate.accepted_with_subscription": "an estimate was accepted and started a subscription",
  "money.invoice.payment_attached": "attached a payment to an invoice",
  "money.invoice.reminders_disabled": "turned off reminders for an invoice",
  "money.invoice.reminders_enabled": "turned on reminders for an invoice",
  "money.invoice.rendering_updated": "changed how an invoice looks",
  "money.invoice.stripe_created": "an invoice was created in Stripe",
  "money.invoice.stripe_error": "Stripe refused an invoice",
  "money.invoice.stripe_void_error": "Stripe refused to void an invoice",
  "money.payment.intent_created": "a payment was started",
  "money.payment_plan.cancelled": "cancelled a payment plan",
  "money.payment_plan.released": "released a payment plan",
  "money.subscription_schedule.skipped": "skipped a scheduled subscription payment",
  "money.tax_id.created": "added a tax ID",
  "money.tax_id.deleted": "removed a tax ID",
  "money.tax_id.updated": "changed a tax ID",
  "items.promotion_code.created": "added a coupon code",
  "items.promotion_code.deactivated": "turned off a coupon code",
  "growth.campaign_group.updated": "changed a campaign",
  "growth.campaign_group.deleted": "deleted a campaign",
  "growth.campaign_group.attached": "added something to a campaign",
  "growth.campaign_group.detached": "removed something from a campaign",
  "growth.campaign_group.paused": "paused a campaign",
  "growth.landing_page.created": "added a landing page",
  "growth.landing_page.updated": "changed a landing page",
  "growth.landing_page.deleted": "deleted a landing page",
  "growth.landing_page.published": "published a landing page",
  "growth.landing_page.drafted": "drafted landing page copy with AI",
  "growth.campaign.opened": "an email was opened",
  "growth.campaign.clicked": "an email link was clicked",
  "growth.subscribe.joined": "someone subscribed to marketing",
  "growth.sequence.step_sent": "sent a sequence step",
  "growth.lead_score.crossed": "a lead score crossed a threshold",
  "tasks.task.assigned": "assigned a task",
  "tasks.task.completed": "completed a task",
  "tasks.job.gave_up": "opened a task because a background job could not finish",
  "platform.tenant.provisioned": "provisioned this practice",
  // ★★★ THE ONE THAT MUST NEVER BE HIDDEN. §A9. ★ Stage 4 Task 4 — F508: the wording was in
  //   capitals; fixed to sentence case, matching this map's convention. §A9's guarantee is that
  //   this row is never EXCLUDED from a tenant's own audit view (AUDIT_EXCLUDES_NOTHING, above) —
  //   that guarantee does not depend on the sentence being shouted.
  "platform.impersonation.started": "a platform operator signed in as someone in this practice",
  // ★★★ Stage 4 Task 10 — the other two things a platform operator can do TO a practice's work, and
  //     they are worded from the practice's side for the same §A9 reason: the practice reads this log.
  "platform.job.retried": "a platform operator put a piece of this practice's background work back on the queue",
  "platform.job.given_up": "a platform operator closed a piece of this practice's background work that had failed for good",
  // ★ Stage 18 task 18.4 — the three operator-access topics, worded from the practice's side (§A9):
  //   the practice reads this log and sees what the operator asked for.
  "platform.support_access.requested": "Workbench asked to look at your account",
  "platform.support_access.answered": "an Owner answered Workbench's request to look at the account",
  "platform.support_access.ended": "Workbench's access to the account ended",
  // ★ R2 report item (26 Sep 2026) — the n8n workflow-error callback's own event, replacing the
  //   never-recordable `platform.n8n_error` (src/routes/automationsCallback.mjs). No practice reads
  //   this: it lands under the platform tenant, worded plainly for an operator, same convention as
  //   its neighbours above.
  "platform.automation.workflow_failed": "an n8n automation workflow failed",
  "provisioning.run.completed": "finished a provisioning run",
  "provisioning.step.failed": "had a provisioning step fail",
  // ★ Stage 4 Task 4 — F505. The only `settings` topic emitted today (src/routes/settings.mjs,
  //   src/settings/writes.mjs); the other eight are RESERVED (db/gates/s3_topic_emitters.mjs) and
  //   have no wording entry until something emits them.
  "settings.setting.changed": "changed a setting",
  // ★ Stage 18 task 18.31b — the morning day summary. Emitted by staff_day_summary when a coach
  //   has sessions today.
  "booking.day.summary": "a coach was told about their day",
  // ★ Stage 18 task 18.29 — device registration for push notifications.
  "settings.push_device.registered": "a phone was set up for push notifications",
  "settings.push_device.removed": "a phone stopped getting push notifications",
  // ★ Stage 18 task 18.51 — client-coach message thread (CT-F48).
  "messages.message.sent": "a message was sent",
  // ★ Task 20.21 — the platform lifecycle and announcements.
  "workbench.subscription.updated": "Workbench's billing changed",
  "workbench.usage.warning": "Workbench usage approached the limit",
  "workbench.run.finding": "a scheduled item run had findings",
  "workbench.onboarding.stalled": "Workbench setup appeared stalled",
  "workbench.announcement.published": "Workbench published an announcement",
  "workbench.promotion.offered": "Workbench offered a promotion",
  "workbench.lifecycle.trial_ending": "Workbench's trial is ending soon",
  // ★ [TY, 2 Oct 2026] "workbench.lifecycle.win_back" REMOVED ENTIRELY — see
  //   automations/sweeps.mjs's own header note on why.
  // ★ NEW (T0.1, CONTRACTS §5). The 20 topics added to topics.mjs by the same task, in the same order.
  "booking.booking.held": "held a session until the agreement is signed",
  "booking.booking.hold_released": "released a held session (agreement not signed in time)",
  "money.credit.granted": "granted session credits",
  "money.invoice.deleted": "deleted a draft invoice",
  "money.payment_method.removed": "removed a saved card",
  "money.estimate.cancelled": "cancelled an estimate",
  "money.refund.cancelled": "cancelled a pending refund",
  "money.review.approved": "approved a held payment",
  "money.device.renamed": "renamed a card reader",
  "money.subscription.card_updated": "updated a subscription's card",
  "money.subscription.discount_removed": "removed a subscription discount",
  "money.subscription.start_failed": "could not start a subscription in Stripe",
  "money.coupon.removed": "removed a coupon",
  "money.invoice.diverged": "corrected an invoice to match Stripe",
  "money.subscription.diverged": "corrected a subscription to match Stripe",
  "people.tax_id.added": "added a tax ID",
  "people.tax_id.removed": "removed a tax ID",
  "settings.invoice_layout.archived": "hid an invoice layout",
  "settings.invoice_layout.unarchived": "showed an invoice layout",
  "settings.payment_methods.changed": "changed the ways clients can pay",
  "developer.api_key.allowlist_changed": "changed which addresses an API key may be used from",
  "developer.api_key.created": "created an API key",
  "developer.api_key.policy_changed": "changed what an API key may do",
  "developer.api_key.revoked": "revoked an API key",
  "developer.api_key.scopes_changed": "changed an API key's permissions",
  "developer.webhook_endpoint.created": "added a webhook address",
  "developer.webhook_endpoint.secret_rotated": "made a new signing secret for a webhook address",
  "documents.ai.job_requested": "asked the AI for a draft",
  "documents.detect.job_requested": "asked the AI to look for fields",
  "documents.approval.decided": "decided a request to send a document",
  "documents.approval.requested": "asked to send a document",
  "documents.clause.created": "added a clause",
  "documents.clause.updated": "changed a clause",
  "documents.document.archived": "archived a document",
  "documents.document.bounced": "had an email about a document bounce",
  "documents.document.changes_requested": "asked for changes to a document",
  "documents.document.expired": "had a document expire unsigned",
  "documents.document.opened": "opened a document",
  "documents.document.reminder_due": "was due a reminder about a document",
  "documents.playbook.ran": "was the subject of an automation's notice",
  "documents.payment.hold_lapsed": "had a signature that was not kept because its payment did not arrive",
  "documents.playbook.step_due": "had an automation's wait end",
  "documents.email.paused": "had sending paused because of bounced emails",
  "documents.pdf.imported": "imported a document",
  "documents.template.published": "published a template",
  // ★ Wording the generic "<verb> a <thing>" rule gets wrong ("export ready a data", "answered a questions").
  "settings.data.export_requested": "requested a data export",
  "settings.data.export_ready": "had a data export ready",
  "settings.data.person_export_requested": "requested a person's data export",
  "provisioning.questions.answered": "answered the setup questions",
  "provisioning.samples.created": "added the sample content",
  "provisioning.samples.removed": "removed the sample content",
  "settings.import.completed": "finished an import",
  "settings.import.undone": "undid an import",
  "people.person.consent_status_changed": "changed a person's consent",
  "people.person.role_changed": "changed a person's role",
  "people.person.stage_changed": "moved a person to a new stage",
  "people.person.merge_dismissed": "marked two people as not the same person",
  "people.role.permission_changed": "changed what a role may do",
  "items.discount.active_changed": "turned a discount on or off",
  "items.modifier.active_changed": "turned a modifier on or off",
});

/** ★ Never render a dotted token. An unknown topic becomes readable words, not `a.b.c`. D-026/D-092: the article agrees with the next word ("an API key", "an AI request"), acronyms are capitals, and the thing is everything between the area and the verb. */
const ACRONYM = new Set(["ai", "api", "pdf", "sso", "ip", "url"]);
const words = (x) => x.split("_").join(" ").split(" ").map((w) => (ACRONYM.has(w) ? w.toUpperCase() : w)).join(" ");
export function describeTopic(topic) {
  if (TOPIC_WORDING[topic]) return TOPIC_WORDING[topic];
  const parts = String(topic ?? "").split(".");
  if (parts.length < 3) return "did something this log does not have wording for";
  const verb = parts[parts.length - 1].replace(/_/g, " "), thing = words(parts.slice(1, -1).join(" "));
  const a = /^(a|e|i|o|u)/i.test(thing) || ["AI", "API", "IP", "SSO"].includes(thing.split(" ")[0]) ? "an" : "a";
  return `${verb} ${a} ${thing}`;
}

/**
 * ★★ Read the tenant's audit log. Tenant scoping is RLS — there is deliberately no `tenant_id = $1`
 *    in this query, because adding one would imply the predicate is the application's job and invite
 *    a future reader to trust it instead of the policy.
 *
 * @param {{query: Function}} tx a tenant transaction
 */
export async function listAuditEvents(tx, { limit = 100, since = null, until = null, topics = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await tx.query(
    `SELECT e.id, e.topic, e.emitted_by, e.subject_type, e.subject_id, e.payload, e.created_at,
            rr.reason, pd.display_name AS actor_name, pd.email AS actor_email, au.staff_role AS actor_role, sd.display_name AS subject_name, di.title AS document_title
       FROM keystone.event e
       LEFT JOIN keystone.record_reason rr ON rr.event_id = e.id
       LEFT JOIN keystone.person_directory pd ON e.actor = 'user:' || pd.id::text
       LEFT JOIN keystone.app_user au ON au.id = pd.id                                 -- R13-D451: owner · admin · member
       LEFT JOIN keystone.person_directory sd ON e.subject_type = 'person' AND e.subject_id = sd.id
       LEFT JOIN keystone.document_instance di ON e.subject_type = 'document' AND e.subject_id = di.id   -- R13-D084: say which document (a discarded draft has none left)
      WHERE ($1::timestamptz IS NULL OR e.created_at >= $1)
        AND ($4::timestamptz IS NULL OR e.created_at < $4)
        AND ($2::text[]      IS NULL OR e.topic = ANY($2))
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $3`,
    [since, topics, lim, until]);
  return rows.map((r) => Object.freeze({
    id: r.id,
    topic: r.topic,
    section: r.emitted_by,
    // an owner resetting a teammate's two-step sign-in is a settings event with a named key and a person as its subject: say so, by name (20 Oct 2026)
    description: r.topic === "documents.setting.changed" && r.payload?.key === "security.two_step_reset" ? `reset two-step sign-in for ${r.subject_name ?? "a teammate"}` : describeTopic(r.topic),
    // R13-D451: a sign-up is named "<email name>'s workspace" until the person picks a name, which made the log say the WORKSPACE did it; say who (their email) and their role
    actorName: (r.actor_name && !/workspace\s*$/i.test(r.actor_name) ? r.actor_name : r.actor_email) ?? r.actor_name ?? null,
    actorRole: r.actor_role ?? null,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    documentTitle: r.document_title ?? null,
    at: r.created_at,
    // ★ The payload's FACTS are carried through, because an auditor asking "what changed" needs the
    //   detail — but the DESCRIPTION is what a screen shows, so no surface has to invent wording.
    // ★★★ FIX ROUND 1, REVIEW M4 — ONLY THE FACTS `emit()` WOULD ACCEPT TODAY. Events emitted before
    //     Task 3 are never rewritten (§11) and still carry names, titles and free-text reasons; this
    //     used to forward all of it to the browser. `safeFacts` is the validator's own rule as a filter.
    detail: safeFacts(r.payload ?? {}) ?? {},
    // ★★ R46 — the typed reason a staff member gave (archive · decline · stage change), from
    //    `keystone.record_reason`. This read is the ADMIN audit log (`/api/developer/audit-log`), staff only.
    reason: r.reason ?? null,
  }));
}

/** ★ A count by topic, for the "what has been happening" summary. Same RLS scoping. */
export async function auditSummary(tx, { since = null } = {}) {
  const { rows } = await tx.query(
    `SELECT e.topic, count(*)::int AS n, max(e.created_at) AS latest
       FROM keystone.event e
      WHERE ($1::timestamptz IS NULL OR e.created_at >= $1)
      GROUP BY e.topic ORDER BY n DESC, e.topic`, [since]);
  return rows.map((r) => Object.freeze({
    topic: r.topic, description: describeTopic(r.topic), count: r.n, latest: r.latest,
  }));
}
