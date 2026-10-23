// src/queue/genericNotifications.mjs — PART 2 ADDITION (worker-failures brief, 1 Oct 2026).
//
// ★★★ THE TABLE BEHIND THE GENERIC LISTENER. ~75 real, emitted topics that had a written draft
//     template and nothing reading it (specs/EMAILS.md has the full recon). Each row names:
//   - `recipient`: "owner" (practice staff) | "direct" (subjectId IS the person) |
//     a SUBJECT_RECIPIENT_LOOKUP key (src/queue/recipientResolvers.mjs)
//   - `fallbackOwner`: if the lookup resolves to nobody, notify the practice's owner/admin instead
//     of silently dropping the fact (used for message_thread's "client replied" case, where "which
//     staff member" has no single right answer).
//   - `summary(ev, extra)`: the one line that becomes both the in-app notification's title and the
//     generic email template's `{{ summary }}` — computed here, in JS, with full access to the
//     event's payload, rather than forcing ~75 individual Liquid templates to each reach for data
//     a shared `{{ practiceName }}: {{ summary }}` shape already covers correctly. This table is
//     deliberately for the long tail: it DOES include documents.document.opened/signed/executed
//     (below, LOOKUP section) with the shared generic shape, because the engineering cost of a
//     bespoke listener for them is not yet justified. ★ booking.entitlement.exhausted/expiring,
//     money.invoice.voided, and the payment-plan/subscription-lifecycle topics are the ones that DO
//     get their own richer registry entries and bespoke listeners instead (the maintainer named these as
//     client/payer-facing and high-value) — they are genuinely NOT in this table; check here, not
//     the comment, before assuming either way.
//   - `link`: the deep link the email/notification points at.

import { documentNoticeFacts } from "../documents/frontDoor.mjs";
// Run 8 (R8-35): the document notices name the document and the person who acted, and link to it, from the island's own facts (through the door)
const documentFacts = (tx, tenantId, ev) => documentNoticeFacts(tx, { tenantId, instanceId: ev.subject_id, role: ev.payload?.role ?? null });
const documentLink = (ev) => (ev.payload?.builder === "pdf" ? `/documents/pdf/${ev.subject_id}` : `/record/document/${ev.subject_id}`);

import { planNoticeTitle } from "../email/docustayBilling.mjs";
/** "Oct 19 to Nov 19" from a usage notice's period (UTC); empty when the notice carries none. */
const usageRange = (p) => { const d = (x) => (x ? new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null), a = d(p?.period_start), b = d(p?.period_end); return a && b ? `${a} to ${b}` : "this month"; };
export const GENERIC_NOTIFICATIONS = Object.freeze({
  // ── people.* — DIRECT (subjectId is the recipient) ─────────────────────────────────────────
  "people.person.created": {
    recipient: "direct", templateKey: "people.welcome",
    summary: () => "You've been added to the team.",
    link: () => "/app",
  },
  // ★★★ FOUND LIVE, the maintainer's own report, 2 Oct 2026 — this used to be `recipient: "direct"`, which
  //   resolves to `subjectId` — the CLIENT being assigned, per src/people/writes.mjs's own emit
  //   call (`subjectType: "person", subjectId: personId`). "You've been assigned a new client" is
  //   staff-directed copy; it was being sent TO THE CLIENT. See recipientResolvers.mjs's own note
  //   on `assigned_owner_payload` (reads `payload.to`, the staff member who became the owner).
  "people.person.assigned": {
    recipient: "lookup", lookupKey: "assigned_owner_payload", fallbackOwner: false, templateKey: "people.reassigned",
    summary: () => "You've been assigned a new client.",
    link: () => "/app",
  },
  "people.person.role_changed": {
    recipient: "direct", templateKey: "people.role_changed",
    summary: (ev) => `Your role changed to ${ev.payload?.newRole ?? ev.payload?.to ?? "a new role"}.`,
    link: () => "/app",
  },
  "people.person.stage_changed": {
    recipient: "direct", templateKey: "people.stage_changed",
    summary: (ev) => `Your status is now "${ev.payload?.stage ?? "updated"}".`,
    link: () => "/app",
  },
  "people.person.lead_next_step_set": {
    recipient: "direct", templateKey: "people.next_step_set",
    summary: () => "There's a next step on your file.",
    link: () => "/app",
  },
  "people.person.consent_status_changed": {
    recipient: "direct", templateKey: "people.consent_changed",
    summary: () => "Your consent preferences were updated.",
    link: () => "/app",
  },
  "people.person.archived": {
    recipient: "direct", templateKey: "people.archived",
    summary: () => "Your record has been archived.",
    link: () => "/app",
  },
  "people.person.merged": {
    recipient: "direct", templateKey: "people.merged",
    summary: () => "Your records have been combined into one.",
    link: () => "/app",
  },
  "people.person.merge_undone": {
    recipient: "direct", templateKey: "people.merge_undone",
    summary: () => "A record merge was undone.",
    link: () => "/app",
  },
  "people.guardian.linked": {
    recipient: "direct", templateKey: "people.guardian_linked",
    summary: () => "A guardian was linked to this record.",
    link: () => "/app",
  },
  "people.guardian.unlinked": {
    recipient: "direct", templateKey: "people.guardian_unlinked",
    summary: () => "A guardian was unlinked from this record.",
    link: () => "/app",
  },
  "people.referral.received": {
    recipient: "direct", templateKey: "people.referral_received",
    summary: () => "You've been referred.",
    link: () => "/app",
  },
  "people.referral.sent": {
    recipient: "direct", templateKey: "people.referral_sent",
    summary: () => "Your referral was sent.",
    link: () => "/app",
  },
  "people.referral.outcome_set": {
    recipient: "direct", templateKey: "people.referral_outcome",
    summary: (ev) => `Your referral's outcome: ${ev.payload?.outcome ?? "updated"}.`,
    link: () => "/app",
  },
  "people.referral.blocked_no_release": {
    recipient: "direct", templateKey: "people.referral_blocked",
    summary: () => "A referral could not be released yet.",
    link: () => "/app",
  },
  "people.role.granted": {
    recipient: "direct", templateKey: "people.role_granted",
    summary: () => "You were granted a new role.",
    link: () => "/app",
  },
  "people.role.revoked": {
    recipient: "direct", templateKey: "people.role_revoked",
    summary: () => "A role was removed from your account.",
    link: () => "/app",
  },
  "people.role.permission_changed": {
    recipient: "direct", templateKey: "people.role_permission_changed",
    summary: () => "Your permissions were updated.",
    link: () => "/app",
  },
  "people.team.member_added": {
    recipient: "direct", templateKey: "people.team_added",
    summary: () => "You've joined the team.",
    link: () => "/app",
  },
  "people.team.member_removed": {
    recipient: "direct", templateKey: "people.team_removed",
    summary: () => "You've been removed from a team.",
    link: () => "/app",
  },
  "people.person.removed_from_team": {
    recipient: "direct", templateKey: "people.offboarded",
    summary: () => "Your access to the team has ended.",
    link: () => "/app",
  },
  "growth.consent.unsubscribed": {
    recipient: "direct", templateKey: "growth.unsubscribed",
    summary: () => "You've been unsubscribed from marketing emails.",
    link: () => "/app",
  },
  "growth.consent.resubscribed": {
    recipient: "direct", templateKey: "growth.resubscribed",
    summary: () => "You've been resubscribed to marketing emails.",
    link: () => "/app",
  },

  // ── OWNER (practice staff — owner/admin) ───────────────────────────────────────────────────
  // ★ Free workspace used 80% / 100% of its monthly document limit, its daily emails, or 4 / 5 of its 5 new templates a month (src/product/docustay.mjs usageAlerts, templateUsageAlerts) — told once each, to the workspace owner, in plain words that name no other product.
  "documents.usage.threshold": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: (ev) => (ev.payload?.kind === "summary"
      ? `Your billing period ${usageRange(ev.payload)} on Docustay: ${ev.payload?.documents ?? 0} documents and ${ev.payload?.drafts ?? 0} AI drafts past your plan's included amount, $${((ev.payload?.amount_minor ?? 0) / 100).toFixed(2)} in all. It is on your next invoice. See the detail in Billing.`
      : ev.payload?.kind === "budget"
      ? (ev.payload?.percent >= 100
        ? `Your usage this billing period (${usageRange(ev.payload)}) has reached your $${((ev.payload?.limit_minor ?? 0) / 100).toFixed(2)} budget, so sending and AI drafting are paused. Raise the budget in Billing to go on. Nothing is deleted.`
        : `Your usage this billing period (${usageRange(ev.payload)}) is at ${ev.payload?.percent}% of your $${((ev.payload?.limit_minor ?? 0) / 100).toFixed(2)} budget ($${((ev.payload?.used_minor ?? 0) / 100).toFixed(2)} so far).`)
      : ev.payload?.kind === "signers"
      ? (ev.payload?.percent >= 100
        ? `You have sent to ${ev.payload?.limit} different signers, all your Free plan includes this month. Sending again to someone you already sent to is always allowed. New signers open again on ${ev.payload?.period_end ? new Date(ev.payload.period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "the 1st"}, or choose Pay as you go or Pro.`
        : `You have sent to ${ev.payload?.used} of the ${ev.payload?.limit} different signers your Free plan includes this month.`)
      : ev.payload?.kind === "templates"
      ? (ev.payload?.percent >= 100
        ? `You have made all ${ev.payload?.limit} new templates your ${ev.payload?.plan === "docustay_payg" ? "Pay as you go" : "Free"} plan includes this month. You can still use and edit every template you have; new ones open again on ${ev.payload?.period_end ? new Date(ev.payload.period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "the 1st"}, or upgrade to Pro for unlimited templates.`
        : `You have made ${ev.payload?.used} of the ${ev.payload?.limit} new templates your ${ev.payload?.plan === "docustay_payg" ? "Pay as you go" : "Free"} plan includes this month.`)
      : ev.payload?.kind === "emails"
      ? (ev.payload?.percent >= 100
        ? `You have sent ${ev.payload?.limit} emails today, the daily limit for your plan. Signing emails go out again at midnight UTC.`
        : `You have sent ${ev.payload?.used} of the ${ev.payload?.limit} emails your plan allows today.`)
      : (ev.payload?.percent >= 100
        ? `You have used all ${ev.payload?.limit} documents your Free plan includes this month. Sending resumes next month, or you can upgrade to Pro. Nothing is ever billed for going over.`
        : `You have used ${ev.payload?.used} of the ${ev.payload?.limit} documents your Free plan includes this month.`)),
    link: (ev) => (ev.payload?.kind === "templates" ? "/templates" : "/billing"),
  },
  "booking.availability.changed": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "Availability settings changed.", link: () => "/people/scheduling",
  },
  "booking.policy.changed": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A booking policy was changed.", link: () => "/settings/booking",
  },
  "calendar.connection.connected": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A calendar connection was connected.", link: () => "/settings/calendar",
  },
  "calendar.connection.disconnected": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A calendar connection was disconnected.", link: () => "/settings/calendar",
  },
  "calendar.connection.renewal_failed": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A calendar connection failed to renew — reconnect it to keep syncing.",
    link: () => "/settings/calendar",
  },
  "money.dispute.evidence_submitted": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "Evidence was submitted for a payment dispute.", link: () => "/app/money",
  },
  "money.payout.recorded": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: (ev) => `A payout was recorded${ev.payload?.amount ? `: ${ev.payload.amount}` : ""}.`,
    link: () => "/app/money",
  },
  "platform.job.given_up": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A background job needs attention.", link: () => "/app/money",
  },
  "settings.policy.announced": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A new policy was announced.", link: () => "/settings",
  },
  "settings.data.export_requested": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A data export was requested.", link: () => "/settings",
  },
  "settings.data.export_ready": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "Your data export is ready.", link: () => "/settings",
  },
  "settings.import.completed": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A data import completed.", link: () => "/settings",
  },
  "settings.import.undone": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A data import was undone.", link: () => "/settings",
  },
  "settings.subscription.updated": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    // a Docustay workspace is never told about "the platform" (found on the localhost stack, 9 Oct 2026: a Docustay purchase sent "Your the platform subscription was updated.")
    summary: (ev) => (String(ev.payload?.planKey ?? "").startsWith("docustay_") ? planNoticeTitle(ev.payload?.change, ev.payload?.planKey) : "Your Workbench subscription was updated."),
    link: (ev) => (String(ev?.payload?.planKey ?? "").startsWith("docustay_") ? "/billing" : "/settings/billing"),
  },
  "accounts.account.created": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A new account was created.", link: () => "/accounts",
  },
  "accounts.pipeline.advanced": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "An account's pipeline stage advanced.", link: () => "/accounts",
  },
  "network.party.created": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A new network party was created.", link: () => "/app",
  },
  "network.referral.created": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A new network referral was created.", link: () => "/app",
  },
  "run.item.blocked": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "An item is blocked and needs attention.", link: () => "/catalogue",
  },
  "run.access.granted": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "Access was granted.", link: () => "/settings",
  },
  "growth.campaign.scheduled": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A campaign was scheduled to send.", link: () => "/growth/campaigns",
  },
  "run.competitor.watch_recorded": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A competitor watch was recorded.", link: () => "/run",
  },
  "documents.template.published": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A document template was published.", link: () => "/documents/templates",
  },
  "documents.template.versioned": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A new version of a document template was saved.", link: () => "/documents/templates",
  },
  "documents.pdf.imported": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "A PDF was imported as a document.", link: () => "/documents",
  },
  "provisioning.questions.answered": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "Onboarding questions were answered.", link: () => "/app",
  },
  "provisioning.samples.created": {
    recipient: "owner", templateKey: "workbench.owner_notice",
    summary: () => "Sample data was created for this practice.", link: () => "/app",
  },

  // ── LOOKUP (a real column resolves the recipient) ──────────────────────────────────────────
  // ★ §23.15.1 — an uploaded (pdf-builder) document opens on its own screen, not the generic record; its events say `builder: "pdf"`.
  "documents.document.opened": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.opened", facts: documentFacts,
    summary: (ev, f) => (f?.title ? `${f.who || "Someone"} opened “${f.title}”.` : "Someone opened a document you sent."), link: (ev) => documentLink(ev),
  },
  "documents.document.signed": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.signed", facts: documentFacts,
    summary: (ev, f) => (f?.title ? `${f.who || "Someone"} signed “${f.title}”.` : "A document was signed."), link: (ev) => documentLink(ev),
  },
  "documents.document.executed": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.executed", facts: documentFacts,
    summary: (ev, f) => (f?.title ? `Everyone has signed “${f.title}”. It is complete.` : "A document is now complete: everyone has signed."), link: (ev) => documentLink(ev),
  },
  "documents.document.changes_requested": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.changes_requested", facts: documentFacts,   // R13-D316: say who and which document, as a decline does
    summary: (ev, f) => (f?.title ? `${f.who || "Someone"} asked for changes to “${f.title}”. Their words are on the document's timeline.` : "Someone asked for changes to a document you sent — their words are on the document's timeline."), link: (ev) => documentLink(ev),
  },
  "documents.document.delegated": {   // R13-D265: the event fires after the seat moves, so the facts name the new person
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.delegated", facts: documentFacts,
    summary: (ev, f) => (f?.title ? `“${f.title}” was passed on: ${f.who || "someone else"} signs it now.` : "Someone passed a document you sent on to another person."), link: (ev) => documentLink(ev),
  },
  "documents.document.bounced": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.bounced",
    summary: () => "An email for a document you sent did not arrive — fix the address and resend.", link: (ev) => documentLink(ev),
  },
  "documents.document.reminder_due": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.reminder_due",
    summary: () => "A document is still waiting to be signed.", link: (ev) => `/record/document/${ev.subject_id}`,
  },
  // ★ Run 9 Part 3.7 (R9-l) — a signature kept for its payment lapsed unpaid (the signer is emailed by the island itself)
  "documents.payment.hold_lapsed": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.payment_hold_lapsed", facts: documentFacts,
    summary: (ev, f) => f?.title ? `A signature on “${f.title}” was not kept: its payment did not arrive within 7 days.` : "A signature was not kept: its payment did not arrive within 7 days.",
    link: (ev) => documentLink(ev),
  },
  "documents.disclosure.accepted": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.disclosure_accepted",
    summary: () => "A disclosure was accepted.", link: (ev) => `/record/document/${ev.subject_id}`,
  },
  "documents.disclosure.withdrawn": {
    recipient: "lookup", lookupKey: "document", fallbackOwner: true, templateKey: "documents.disclosure_withdrawn",
    summary: () => "A disclosure was withdrawn.", link: (ev) => `/record/document/${ev.subject_id}`,
  },
  "booking.hold.expired": {
    recipient: "lookup", lookupKey: "booking", fallbackOwner: true, templateKey: "booking.hold_expired",
    summary: () => "A held session slot expired.", link: (ev) => `/record/booking/${ev.subject_id}`,
  },
  "booking.participant.added": {
    recipient: "lookup", lookupKey: "booking_participant_payload", fallbackOwner: false, templateKey: "booking.participant_added",
    summary: () => "You've been added to a session.", link: (ev) => `/record/booking/${ev.subject_id}`,
  },
  "money.subscription.cancel_scheduled": {
    recipient: "lookup", lookupKey: "subscription", fallbackOwner: true, templateKey: "money.plan_cancel_scheduled",
    summary: () => "Your plan is scheduled to cancel at the end of this period.", link: () => "/app/money",
  },
  "items.loyalty.points_earned": {
    recipient: "direct", templateKey: "items.loyalty_points_earned",
    summary: (ev) => `You earned ${ev.payload?.points ?? "new"} loyalty points.`, link: () => "/app",
  },
  "tasks.task.assigned": {
    recipient: "lookup", lookupKey: "task", fallbackOwner: false, templateKey: "tasks.assigned",
    summary: (ev) => `You were assigned a task${ev.payload?.title ? `: ${ev.payload.title}` : ""}.`,
    link: () => "/tasks",
  },
  "tasks.task.completed": {
    recipient: "lookup", lookupKey: "task", fallbackOwner: false, templateKey: "tasks.completed",
    summary: () => "A task assigned to you was completed.", link: () => "/tasks",
  },
  "tasks.task.reassigned": {
    recipient: "lookup", lookupKey: "task", fallbackOwner: false, templateKey: "tasks.reassigned",
    summary: () => "A task was reassigned to you.", link: () => "/tasks",
  },
  "messages.message.sent": {
    recipient: "lookup", lookupKey: "message_thread", fallbackOwner: true, templateKey: "messages.new_message",
    summary: () => "You have a new message.", link: () => "/app/messages",
  },
  "people.goal.created": {
    recipient: "lookup", lookupKey: "person_goal", fallbackOwner: false, templateKey: "people.goal_created",
    summary: (ev) => `A new goal was set${ev.payload?.title ? `: ${ev.payload.title}` : ""}.`, link: () => "/app",
  },
  "people.goal.updated": {
    recipient: "lookup", lookupKey: "person_goal", fallbackOwner: false, templateKey: "people.goal_updated",
    summary: () => "One of your goals was updated.", link: () => "/app",
  },
  "people.shift.created": {
    recipient: "lookup", lookupKey: "staff_shift", fallbackOwner: false, templateKey: "people.shift_created",
    summary: () => "A shift was added to your schedule.", link: () => "/people/scheduling",
  },
  "people.shift.changed": {
    recipient: "lookup", lookupKey: "staff_shift", fallbackOwner: false, templateKey: "people.shift_changed",
    summary: () => "A shift on your schedule changed.", link: () => "/people/scheduling",
  },
  "people.time_off.added": {
    recipient: "lookup", lookupKey: "time_off", fallbackOwner: false, templateKey: "people.time_off_added",
    summary: () => "Time off was added to your schedule.", link: () => "/people/scheduling",
  },
  "people.time_off.removed": {
    recipient: "lookup", lookupKey: "time_off", fallbackOwner: false, templateKey: "people.time_off_removed",
    summary: () => "Time off was removed from your schedule.", link: () => "/people/scheduling",
  },

  // ── PART 4a ADDITION (money-map pass, 1 Oct 2026) ──────────────────────────────────────────
  // ★★★ MEASURED, not guessed: cross-referenced every `money.*` topic in src/events/topics.mjs
  //   against HANDLER_LISTENER/this table/TOPIC_TEMPLATE — 69 of ~90 had NONE. Most of the 69 are
  //   internal bookkeeping facts (line_item.created, invoice.archived, tax_id.*, …) that nobody
  //   should be emailed about, or are genuinely orphan (money.payment.retry_scheduled/
  //   retries_exhausted — zero real emitter anywhere, confirmed by grep, NOT wired here for that
  //   reason — see db/gates/s3_topic_emitters.mjs's own RESERVED list). These 10 are the ones that
  //   ARE really emitted (confirmed by reading the actual emit() call site, not assumed) AND are a
  //   fact a real person should be told about. `money.invoice.voided` was the maintainer's own explicit,
  //   named example of a gap — it is this table's own proof the class of defect is real, not
  //   theoretical: Stripe-side void correctly updates OUR status column and NEVER tells the payer.
  "money.invoice.voided": {
    recipient: "lookup", lookupKey: "invoice", fallbackOwner: true, templateKey: "money.invoice_voided",
    summary: (ev) => `Invoice ${ev.payload?.invoice_number ?? ""} was voided.`.replace("  ", " "),
    link: (ev) => `/record/invoice/${ev.subject_id}`,
  },
  // ★ 9 Oct 2026: this is the INTERNAL notice (to the practice's owners) that an invoice has passed its due date. The payer's own reminder is the per-invoice schedule (money.invoice_reminder) or, for an invoice with none, the Automations "Invoice chase" (automation.invoice_chase). It used to go to the payer too, so the payer got two different emails about one invoice at the same moment, one of them reading "0 days overdue".
  "money.invoice.overdue": {
    recipient: "owner", templateKey: "money.invoice_overdue",
    summary: () => "An invoice is overdue.",
    link: (ev) => `/record/invoice/${ev.subject_id}`,
  },
  // ★ credits defect 15 (level-triggered, src/time/due.mjs entitlement_running_low): the payer AND, when the credits are FOR one person, that person.
  "booking.entitlement.running_low": {
    recipient: "lookup", lookupKey: "entitlement", fallbackOwner: true, alsoBeneficiary: true, templateKey: "money.credits_running_low",
    summary: (ev) => `You're down to ${ev.payload?.credits_remaining ?? "a few"} session${ev.payload?.credits_remaining === 1 ? "" : "s"} in your package.`,
    link: () => "/app/money",
  },
  "money.credit_note.voided": {
    recipient: "lookup", lookupKey: "invoice", fallbackOwner: true, templateKey: "money.credit_note_voided",
    summary: () => "A credit note on your invoice was voided.",
    link: (ev) => `/record/invoice/${ev.subject_id}`,
  },
  // ★ "payment_plan" names a subscription_schedule row (no payment_plan table exists — see
  //   recipientResolvers.mjs's own note on `invoice_id_payload`), every emit carries `invoice_id`.
  "money.payment_plan.offered": {
    recipient: "lookup", lookupKey: "invoice_id_payload", fallbackOwner: true, templateKey: "money.payment_plan_offered",
    summary: (ev) => `A payment plan was offered${ev.payload?.installments ? ` — ${ev.payload.installments} installments` : ""}.`,
    link: () => "/app/money",
  },
  "money.payment_plan.agreed": {
    recipient: "lookup", lookupKey: "invoice_id_payload", fallbackOwner: true, templateKey: "money.payment_plan_agreed",
    summary: () => "Your payment plan is confirmed.",
    link: () => "/app/money",
  },
  "money.payment_plan.cancelled": {
    recipient: "lookup", lookupKey: "invoice_id_payload", fallbackOwner: true, templateKey: "money.payment_plan_cancelled",
    summary: () => "Your payment plan was cancelled.",
    link: () => "/app/money",
  },
  "money.payment_plan.released": {
    recipient: "lookup", lookupKey: "invoice_id_payload", fallbackOwner: true, templateKey: "money.payment_plan_completed",
    summary: () => "Your payment plan is complete.",
    link: () => "/app/money",
  },
  // ★ estimate.declined/expired/accepted are OUTCOME facts for the STAFF who sent the estimate,
  //   not the client (who already knows — they just declined/accepted it themselves, or the
  //   window simply closed on them) — OWNER, not the `estimate` lookup (which resolves to the
  //   CLIENT recipient, the wrong audience for these three).
  "money.estimate.declined": {
    recipient: "owner", templateKey: "money.estimate_declined",
    summary: () => "An estimate was declined.", link: () => "/app/money",
  },
  "money.estimate.expired": {
    recipient: "owner", templateKey: "money.estimate_lapsed",
    summary: () => "An estimate expired with no response.", link: () => "/app/money",
  },
  "money.estimate.accepted": {
    recipient: "owner", templateKey: "money.estimate_won",
    summary: () => "An estimate was accepted.", link: () => "/app/money",
  },
});

/**
 * Run 10 (R10-41): this table is the platform's CRM notice list, shared with Docustay. A Docustay workspace is a document product: "Usage was reconciled for this billing period." (an
 * internal the platform billing event) reached a Docustay owner by email and in the bell, linking to a the platform page. For a Docustay workspace only the topics below send a notice; every other
 * entry in this table is the platform's and is skipped (logged, not an error). the platform is unchanged.
 */
const DOCUSTAY_NOTICE_TOPICS = [/^documents\./, /^settings\.subscription\.updated$/, /^settings\.data\./, /^settings\.import\./, /^people\.(person\.created|role\.|team\.|person\.removed_from_team)/];
export const docustayWantsNotice = (topic) => DOCUSTAY_NOTICE_TOPICS.some((re) => re.test(String(topic)));
