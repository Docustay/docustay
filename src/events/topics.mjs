// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE TOPIC VOCABULARY. **THE CLOSED SET, AND THE ONLY DECLARATION OF IT.**
//
// ★★★ THIS FILE WAS SPLIT OUT OF `outbox.mjs` AT A12.1, AND THE REASON IS A BROWSER BUNDLE.
//     `outbox.mjs` imports `assertTenantTx` from `../db/index.mjs`, which pulls in `pg` — so the
//     whole module is unimportable from client code. The "Add endpoint" surface has to offer the
//     83 topics an endpoint may subscribe to, and the ONLY two ways to give a browser that list
//     are to import it or to hand-copy it.
//   ★★★ HAND-COPYING IT WOULD BE **DUPLICATE-TRUTH**, this project's most-repeated defect, on the
//       exact object that has already produced it once: `SECTIONS` used to be its own frozen array
//       beside the `TOPICS` map whose keys are the same fact, and adding the `network` section left
//       it stale within minutes. A second copy in the client would go stale the same way, and the
//       symptom would be a picker offering a topic the server refuses — or, far worse, SILENTLY
//       MISSING a topic, so an endpoint looks configured and receives nothing.
//   ★★ SO THE VOCABULARY MOVES AND `outbox.mjs` RE-EXPORTS IT. Every existing importer —
//      `routes/developer.mjs`, `notifications/writes.mjs` and ten gates — resolves unchanged,
//      because `outbox.mjs` still exports all three names. **This is a move, not a fork.**
//
// ★ NOTHING IS IMPORTED HERE, ON PURPOSE. The moment this file imports anything with a node
//   dependency it stops being importable by the client and the copy comes back.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★★★ EXTENDED AT PHASE 15B — D-15B.3. THE SET STAYS CLOSED; IT GAINED MEMBERS ON PURPOSE.
//
// ★★ WHY IT HAD TO GROW, AND WHY THAT IS NOT A WEAKENING. P15B.2 requires EVERY write to emit in
// its own transaction, because `keystone.event` is not only the outbox: it is the record page's
// ACTIVITY FEED (D-15.4, `ACTIVITY_TABLE = 'event'`) and it is the AUDIT LOG (P19.9). A write with
// no row here is invisible on the record's own activity tab and in the audit log — which is
// precisely the "silent state change" P15B.2 names.
// [MEAS 2026-09-13] the previous 28 topics covered `createPerson`, `createAccount` and
// `createPrice` and NOTHING ELSE that 15B builds: no update of any kind, no service, no package,
// no plan, no document type, no availability, no line item, no payment method, no entitlement —
// and no `network` section at all. Relaxing P15B.2 to fit that list would be weakening a rule to
// fit an omission; hard limit 5 forbids it. So the list grew, in one place, deliberately.
//
// ★★★ AND WHAT IS AND IS NOT A MIGRATION, MEASURED:
//     event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')      ← a SHAPE
//     event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[...eleven names...])) ← a LIST
//   A NEW TOPIC is therefore NOT a database change — the database checks the shape and THIS OBJECT
//   is the closed set, enforced by `emit()` below. P15B.3's "a new topic is a schema change, not a
//   string" is true of THIS FILE. A NEW SECTION *is* a database change: `network` was added by
//   migration `0023_network_section`, and adding a key here without that migration would pass
//   `emit()` and then be refused by Postgres — two layers, and they must be changed together.
export const TOPICS = Object.freeze({
  documents: ['documents.document.archived', 'documents.document.sent', 'documents.document.signed',
              // FINAL PUSH Stage 6 (FP-K4/K6): what the mail provider told us about an email about a document, and a workspace paused for bouncing too much. Payloads carry ids and a seat, never an address.
              'documents.email.delivered', 'documents.email.bounced', 'documents.email.complained', 'documents.email.paused',
              'documents.approval.requested', 'documents.approval.decided',
              'documents.document.executed', 'documents.document.declined',
              // ★ NEW (15B): the instance's own creation, and the seven-axes vocabulary rows.
              //   `document.created` is NOT `document.sent` — a draft that exists and a draft that
              //   has gone to a client are different facts, and P15C.8 turns on the difference.
              'documents.document.created',
              'documents.type.created', 'documents.category.created',
              // ★ NEW (15C, P15C.10): the ESIGN electronic-records disclosure. Accepting it and
              //   withdrawing it are both facts an audit reader needs — an executed instrument
              //   quotes the acceptance, and 15 U.S.C. 7001(c)(1)'s element (b) makes the
              //   withdrawal a right, which means it has to be recorded rather than inferred.
              //  ★★ THESE TWO ARE `documents`, NOT `people`, even though the row is keyed on a
              //     person. The fact being recorded is consent TO SIGN ELECTRONICALLY, it is quoted
              //     onto instruments, and Documents is the section that owns it. A preference about
              //     email is a fact about a person; a statutory signing consent is not.
              'documents.disclosure.accepted', 'documents.disclosure.withdrawn',
              // ★ NEW (15C, P15C.4/.5/.8): the TEMPLATES themselves. `created` and `versioned` are
              //   different facts and both matter to an auditor — a new VERSION is a new row and the
              //   old one is never edited (§Z4's law, one domain over), so "versioned" carries
              //   from_version → to_version and the id it superseded.
              //  ★★ `updated` exists for the ONLY legitimate in-place edit: a template with no
              //     instrument yet SENT against it. Once one has gone out an edit is refused, because
              //     a sent instrument never re-picks up its template and the edit would fix nothing.
              'documents.template.created', 'documents.template.versioned',
              'documents.template.updated',
              // ★ QUEUE §23.2.2 (3 Oct 2026): a Documents setting changed (payload carries the KEY only, never the value).
              'documents.setting.changed',
              // ★ QUEUE §23.4.7 (3 Oct 2026): a sent uploaded document was voided by its sender.
              'documents.document.voided',
              // ★ AI cost and usage (8 Oct 2026): a workspace's AI credits reached 80% of the period's allowance (payload: plan, used, allowance, resets_at; once per period).
              'documents.ai.allowance_low',
              // ★ PDF field detection (8 Oct 2026): a template was made from an uploaded file and the detector looked for its fields (payload: how many found, how many signers, how many it was unsure of, how many were placed).
              'documents.template.fields_detected',
              // ★★★ NEW (P20.3a), AND IT IS THE MOST IMPORTANT OF THE SIX. ADD3-1: the
              //     `document.sent → executed OR expired` chain was HALF a chain, and the missing half
              //     is **the branch that requires nobody to act**. A document that simply lapses emits
              //     nothing, so "chase the Alvarez signature" has no closer and stays on the screen
              //     forever — which is precisely ADD3-1's own closing warning, *"a task that outlives
              //     its subject is the defect to hunt"*, describing what its own table would produce.
              //   ★ `expired` is DISTINCT from `declined`: declining is an ACT by a party and is
              //     already a topic; expiring is the absence of one. Collapsing them would record a
              //     refusal that nobody made.
              'documents.document.expired',
              // ★★★ NEW (Stage 14 task 14.15, STAGE-14-PLAN.md:888-889). Ten topics, no new SECTION
              //     (`documents` already exists) — required by the Stage 14 documents modules
              //     (`src/documents/sendDocument.mjs`, `signLinks.mjs`, `clauses.mjs`, `publish.mjs`,
              //     `ai.mjs`, `pdfImport.mjs`, `noteShare.mjs`, `starterTemplates.mjs`,
              //     `src/routes/documentsPublic.mjs`) — none of which exist on disk yet as of this
              //     task (MEASURED). Registered ahead of their emitters per §12's own rule ("new
              //     events are added to the catalogue first"); `db/gates/s3_topic_emitters.mjs`
              //     enumerates which task owns each one.
              'documents.document.opened', 'documents.document.reminder_due', 'documents.document.bounced', 'documents.document.changes_requested',
              // ★ Run 9 Part 3.4 (R9-i): a signed contract's notice date is 30 or 7 days away (Pro renewal reminders; src/documents/keyDates.mjs KEY_DATE_DUE_FACT)
              'documents.key_date.due', 'documents.playbook.ran', 'documents.playbook.step_due',
              // ★ Run 9 Part 3.7 (R9-l): a signature held for its payment lapsed unpaid after 7 days (src/documents/pdfSigning.mjs PAYMENT_HOLD_LAPSED_FACT); the sender's notice
              'documents.payment.hold_lapsed',
              'documents.clause.created', 'documents.clause.updated',
              'documents.template.published',
              'documents.ai.draft_generated', 'documents.ai.check_run',
              // ★ Shared document engine (design §6): a draft or edit was asked for; the worker runs it. Emitted by src/documents/engine/ai/jobs.mjs, consumed by TOPIC_HANDLERS in src/queue/tasks.mjs.
              'documents.ai.job_requested',
              // ★ Run 4: the AI look for fields on a PDF draft was asked for; the worker works its pages in parallel. Emitted by src/documents/detect/aiFind.mjs, consumed by TOPIC_HANDLERS in src/queue/tasks.mjs.
              'documents.detect.job_requested',
              // ★ Shared engine item 8 (pricing predictability, 6 Oct 2026): a Free workspace reached 80% / 100% of its monthly document limit; emitted by src/product/docustay.mjs usageAlerts, shown to the owner by GENERIC_NOTIFICATIONS.
              'documents.usage.threshold',
              'documents.pdf.imported',
              'documents.note.shared', 'documents.note.unshared',
              // ★ Part 30 items 5 and 8 (the admin audit log): a team was made, changed or removed; a signer passed a document to someone else; the signed copy was fetched through a download link.
              'documents.team.created', 'documents.team.updated', 'documents.team.deleted',
              'documents.document.delegated', 'documents.document.downloaded'],
  booking:   ['booking.booking.created', 'booking.booking.confirmed',
              // ★★★ NEW (P20.3a). [MEASURED] there was **no terminal "it happened" event for a booking
              //     at all** — `created`, `confirmed`, `cancelled` and `rescheduled` all describe the
              //     BOOKING, and none of them says the session took place. So ADD3-1's "write the
              //     session note" chain had no emitter, and nothing downstream could tell a session
              //     that happened from one still in the future.
              //   ★ It is NOT derivable from `starts_at < now()`: a booking can pass its time and not
              //     have happened. `booking_participant.attended` is the fact, and this is its event.
              'booking.booking.completed',
              'booking.booking.cancelled', 'booking.booking.rescheduled',
              'booking.entitlement.exhausted', 'booking.entitlement.expiring', 'booking.entitlement.running_low',
              // ★ NEW (15B, P15B.10): availability is not a booking. §A6 puts these rules in
              //   Engagements because they CHANGE WEEKLY — so a change to them is exactly the kind
              //   of thing an audit log must carry.
              'booking.availability.changed', 'booking.policy.changed',
              'booking.participant.added',
              // ★★★ NEW (P2.5). The `booking.reminder` EMAIL TEMPLATE has existed since P18 with
              //     zero senders — [MEASURED] its only reference outside templates.mjs was the gate
              //     that renders it to check the wording. This topic is what the scheduled job emits
              //     when a reminder actually fires, and it is the event a reminder NOTIFICATION
              //     names as its cause.
              //   ★★ It is emitted by a WORKER, not by a request, which is the reason it needs to be
              //      an event at all: "why did I get this?" has no answer otherwise, and
              //      createNotification refuses a notification with no event id for exactly that.
              'booking.booking.reminder', 'booking.booking.archived',
              // ★ NEW (task 3b.4, CT-116). `booking_hold_expiry`'s job emits this when a `pending_consent`
              //   hold passes its 24-hour window and the booking is released. Distinct from `.cancelled`:
              //   that is an ACT a party takes; this is a hold lapsing with nobody acting at all.
              'booking.hold.expired',
              // ★ NEW (C2.2, overnight B+C run, 24 Sep 2026). Emitted by `offerToWaitlist()` in
              //   src/booking/reschedule.mjs when a client cancels/reschedules inside the policy
              //   notice window and the freed slot is offered to the next `booking_waitlist_entry`.
              'booking.waitlist.offered',
              // ★ NEW (Stage 18 task 18.31b) — the morning "day summary" push. Emitted by the
              //   `staff_day_summary` periodic job when a coach has sessions today, to send them a
              //   one-line summary at 8:00 practice time.
              'booking.day.summary',
              // ★ NEW (T0.1, CONTRACTS §5). Held pending an agreement signature, and the hold lapsing.
              'booking.booking.held', 'booking.booking.hold_released',
              // ★ NEW, 30 Sep 2026 ("credit-used/returned email" brief) — dedicated topics for the
              //   two credit-state facts, decoupled from whatever OTHER event co-occurs
              //   (`booking.booking.completed` also fires for a card/invoice/no-payment outcome;
              //   `booking.booking.cancelled` already has its own "session cancelled" notification —
              //   overloading either would either mis-map a non-credit completion to a credit email,
              //   or silently replace the existing cancellation email instead of adding to it).
              'booking.booking.credit_consumed', 'booking.booking.credit_returned'],
  money:     ['money.invoice.archived', 'money.subscription.archived', 'money.invoice.opened', 'money.invoice.paid', 'money.payment.failed',
              'money.payment.refunded', 'money.subscription.started',
              'money.subscription.cancelled',
              // ★ NEW (15B, P15B.11).
              'money.line_item.created', 'money.payment_method.added',
              // ★ NEW, receipts brief (1 Oct 2026, Part 2) — "card updated" (automatically_updated
              //   only — see cardUpdate.mjs's own note).
              'money.payment_method.updated',
              // ★ NEW, saved-card brief (1 Oct 2026, Part 3) — the card-expiry sweep.
              'money.payment_method.expiring_soon',
              'money.entitlement.granted',
              'money.entitlement.voided',      // ★ credits defect 16: a refunded package voided its unused credits
              // ★★★ NEW (18, P18.7): THE CHARGE ATTEMPT. This is NOT `invoice.paid` and NOT
              //     `payment.failed` — both of those are facts the STRIPE WEBHOOK establishes after
              //     the fact. This one records that **Keystone asked for money**, which is the act a
              //     human performed and the only part the webhook can never tell anyone about.
              //  ★★ It exists because P18.7's charge path is "record, do not surface": the attempt
              //     has to land in the audit trail even when the flag is OFF and nothing is charged,
              //     otherwise "we tried to bill them" is unrecoverable from the data.
              //   ★ NO MIGRATION IS NEEDED and that is measured, not assumed: the database
              //     constrains the SECTION (`event_emitted_by_check` — THIRTEEN at 0054, `money`
              //     among them) and the topic SHAPE (`event_topic_check ~ ^[a-z]+\.[a-z_]+\.[a-z_]+$`).
              //     There is no per-topic enumeration in Postgres, so the closed catalogue lives
              //     here alone and `topic-catalogue.mjs` compares the SECTION sets, both directions.
              'money.charge.attempted',
              // ★ NEW (B3.1): payout and dispute notifications. `payout.failed` follows the same
              //   pattern as `payment.failed`; `dispute.opened` records when Stripe notifies us of a
              //   new chargeback. Both feed the notification mechanism in `src/notifications/topics.mjs`
              //   and are emitted from `src/money/writes.mjs` when the webhook sets state to failed/under_review.
              'money.payout.failed', 'money.dispute.opened',
              // ★ NEW (Stage 20 task 20.66): customer credit adjustments and balance deltas
              'money.credit.adjusted',
              // ★ Stage 12 (F03, CT-F27) — payer groups. These were EMITTED since C3.4 and never
              //   catalogued, so every write threw (F723).
              'money.payer_group.created', 'money.payer_group.updated', 'money.payer_group.archived',
              'money.payer_group_member.added', 'money.payer_group_member.removed',
              'money.payer_group_member.moved',
              // ★★★ NEW (Stage 15 task 15.1, STAGE-15-PLAN.md §15.1). 34 topics for the Stage 15
              //     money build: the refund/payout/dispute mirror rows' own "recorded" facts
              //     (the replay-guard repair this task also makes, so a redelivered Stripe webhook
              //     stops re-emitting), and the invoice/estimate/payment/subscription/payment-link/
              //     tip/payment-plan/device/tap-to-pay families later Stage 15 tasks emit. Device and
              //     tap-to-pay sit under `money`, not a new section, because `event_emitted_by_check`
              //     constrains SECTIONS (`topics.mjs:127-130` — this comment) and a new section is a
              //     migration this task does not make.
              'money.refund.recorded', 'money.payout.recorded', 'money.dispute.recorded',
              'money.invoice.sent', 'money.invoice.viewed', 'money.invoice.reminder_due',
              'money.invoice.overdue', 'money.invoice.voided', 'money.estimate.created',
              'money.estimate.sent', 'money.estimate.opened', 'money.estimate.accepted',
              'money.estimate.declined', 'money.estimate.expiring', 'money.estimate.expired',
              'money.estimate.converted', 'money.payment.succeeded',
              'money.payment.recorded_offline', 'money.payment.retry_scheduled',
              'money.payment.retries_exhausted', 'money.subscription.paused',
              'money.subscription.resumed', 'money.subscription.cancel_scheduled',
              'money.subscription.past_due', 'money.payment_link.created',
              'money.payment_link.paid', 'money.tip.recorded',
              'money.dispute.evidence_submitted', 'money.refund.approval_needed',
              'money.payment_plan.offered', 'money.payment_plan.agreed',
              'money.device.registered', 'money.tap_to_pay.activated',
              'money.payment_method.update_requested',
              // ★ NEW (Stage 20 task 20.61): the More-actions menu for invoices and disputes.
              'money.invoice.marked_paid', 'money.invoice.marked_uncollectible',
              'money.invoice.duplicated', 'money.dispute.closed',
              // ★ NEW (Stage 20 task 20.62): credit notes issued and voided against invoices.
              'money.credit_note.issued', 'money.credit_note.voided',
              // ★ NEW (Stage 20 task 20.73): reconciliation facts and errors on payment reconciliation.
              'money.invoice.payment_reconciled', 'money.invoice.finalized', 'money.invoice.reconciliation_error',
              // ★ NEW (Stage 20 task 20.64): coupons applied to/removed from a person.
              'money.coupon.applied_to_person', 'money.coupon.removed_from_person',
               // ★★ RUN-2 T19 (26 Sep 2026) — EMITTED by built code and never catalogued, so emit() threw TopicViolation and the write failed (gate s3).
               'money.dispute.stripe_error', 'money.estimate.accepted_with_subscription', 'money.invoice.payment_attached', 'money.invoice.reminders_disabled', 'money.invoice.reminders_enabled', 'money.invoice.rendering_updated', 'money.invoice.stripe_created', 'money.invoice.stripe_error', 'money.invoice.stripe_void_error', 'money.payment.intent_created', 'money.payment_plan.cancelled', 'money.payment_plan.released', 'money.subscription_schedule.skipped', 'money.tax_id.created', 'money.tax_id.deleted', 'money.tax_id.updated', 'money.tax_id.verified', 'money.tax_id.verification_failed',
               // ★ NEW (T0.1, CONTRACTS §5). Thirteen topics, no new section — the diverged pair are
               //   L5.4's, added here so L5.4 never opens this file.
               'money.credit.granted', 'money.invoice.deleted', 'money.payment_method.removed',
               'money.estimate.cancelled', 'money.refund.cancelled', 'money.review.approved',
               'money.device.renamed', 'money.subscription.card_updated',
               'money.subscription.discount_removed', 'money.subscription.start_failed',
               'money.coupon.removed', 'money.invoice.diverged', 'money.subscription.diverged'],
  people:    ['people.person.created', 'people.person.archived',
              // ★ NEW (15B, P15B.4). ★★ `role_changed` IS ITS OWN TOPIC AND NOT A FLAVOUR OF
              //   `updated`: a change to `staff_role` is a change to what someone MAY DO, and an
              //   audit log that cannot distinguish "they corrected a phone number" from "they
              //   made themselves an admin" is not an audit log.
              'people.person.updated', 'people.person.role_changed', 'people.person.invited',
              // ★★ NEW (P1.2). The same argument as `role_changed` one level up: `staff_role` says
              //    which nav sections open, and these three say which ROWS come back. "Who gave the
              //    new coach access to everybody's invoices, and when" is unanswerable from a table
              //    that only holds the current answer, which is why a permission change is an
              //    OCCURRENCE and not a state — and why src/permissions/writes.mjs is a DOMAIN
              //    writer while src/settings/writes.mjs is not.
              //  ★ Under `people.`, not a new `permissions.` section: 0064 established that a new
              //    `emitted_by` value costs a migration, and these events are about a PERSON's
              //    access. They belong to the section that already owns people.
              'people.role.granted', 'people.role.revoked', 'people.role.permission_changed',
              // ★★ NEW (P1.3). Moving somebody between teams changes what they can SEE, because the
              //    `team` scope reads `team_member` — so it is an occurrence, not a state.
              //  ★ `reparented` IS ITS OWN TOPIC, deliberately: it is the single most consequential
              //    edit in the team table (one UPDATE can hand a team sight of half the practice),
              //    and folding it into a generic "updated" would make the audit log unable to tell
              //    it from a rename.
              'people.team.created', 'people.team.reparented',
              'people.team.member_added', 'people.team.member_removed',
              // ★★★ NEW (P1.6). Linking a guardian changes who can read a CHILD'S PAPERWORK. There
              //     is no more consequential row in this schema per byte, and until 0074 the link
              //     did not exist at all — so R4's parent rule held vacuously and nothing about it
              //     was auditable, because nothing about it was possible.
              'people.guardian.linked', 'people.guardian.unlinked',
              // ★ NEW (P2.2). Defining a custom field changes what the practice RECORDS about a
              //   person — a schema decision made by an operator, which is exactly the kind of
              //   change an audit log is read for.
              'people.field.defined',
              // ★ NEW (15B, P15B.12). A notification PREFERENCE is a fact about a PERSON — see
              //   D-15B.3 for why this is not a `notifications` section.
              'people.preference.changed',
              // ★★★ NEW (P20.3a). ADD3-1's first chain CLOSES on this: "respond to lead" dies when the
              //     person's stage moves. [MEASURED] it did not exist, so the chain had no closer and a
              //     lead task would have sat on the screen forever.
              //   ★★ `stage_changed` IS NOT `updated`. A stage is the sales/care PIPELINE position —
              //      the thing the task is about. Folding it into `updated` would mean a phone-number
              //      correction closes a "respond to lead" task, which is the same class of defect as
              //      `role_changed` two lines up and is why that one is separate too.
              'people.person.stage_changed',
              // ★★★ NEW (TASK 12.4, `12-signup-first-run-people.md` §5). Three topics, all emitted
              //     inside `src/people/writes.mjs`'s new `assignPerson`/`setConsentStatus`/
              //     `setLeadNextStep`. Not declared on this task's own file list (`src/events/
              //     topics.mjs`) but required — `emit()` throws `TopicViolation` for anything not in
              //     `ALL_TOPICS` (`outbox.mjs:372`), and §12's own rule is "new events are added to
              //     the catalogue first". `assigned` is its own topic, not folded into `updated`
              //     (which no function here emits for these fields) — same argument `role_changed`/
              //     `stage_changed` already make two lines up: who owns a caseload and what a
              //     guardian consented to are both facts an auditor asks about by name, not by
              //     reading every person edit ever made.
              'people.person.assigned', 'people.person.consent_status_changed',
              'people.person.lead_next_step_set',
              // ★★★ NEW (R2 — Round Two, merge duplicates). Two topics: the merge itself, and its
              //     30-day-undo counterpart. `merged` is irreversible at the HTTP level (the actor is
              //     offered a preview and an undo route, not a "take it back" button), so the event is
              //     emitted when merge is applied. `merge_undone` is emitted when undo succeeds.
              //   ★ Both carry survivorId and loserId in the payload so the listener knows who was
              //     involved and can update any cached state accordingly. The topic names emphasize
              //     that this is a person event, not a meta-operation: the person(s) are the subject.
              'people.person.merged', 'people.person.merge_undone',
              // ★ Stage 11 task 11.2 — D9's only stored prompt fact; emitted by src/prompts/engine.mjs dismissPrompt (11.4).
              'people.prompt.dismissed',
              // ★ Stage 12 (F02/F04, 02 §0.2 + §people)
              'people.person.merge_dismissed', 'people.person.removed_from_team',
              'people.shift.created', 'people.shift.changed', 'people.time_off.added',
              'people.time_off.removed', 'people.referral.sent', 'people.referral.received',
              'people.referral.outcome_set', 'people.referral.blocked_no_release',
              'people.goal.created', 'people.goal.updated',
              // ★ NEW (T0.1, CONTRACTS §5).
              'people.tax_id.added', 'people.tax_id.removed'],
  accounts:  ['accounts.account.archived', 'accounts.account.created', 'accounts.pipeline.advanced',
              // ★ NEW (15B, P15B.5). ★ `pipeline.created` is separate from `pipeline.advanced`
              //   because §A3 rules BUILD / PROVISION / RUN to be three pipelines that must not
              //   collapse into one — creating one is a different fact from moving one along.
              'accounts.account.updated', 'accounts.pipeline.created',
              // ★ NEW (P2.3). Who in THIS practice belongs to an account — a relation that did not
              //   exist at all before 0080, so nothing about it was auditable because nothing about
              //   it was possible.
              'accounts.contact.attached', 'accounts.contact.detached'],
  // ★★★ NEW SECTION AT 0023 (P15B.6). §A1 makes Network first-class: nav row 15, the
  //     `network_party` table (0006), and its own `RECORD_TYPES` descriptor. Emitting these under
  //     `accounts` would be the cross-section reach `emit()` refuses three lines below.
  // ★ Stage 12 (F03, CT-F50) — `network.referral.created` is emitted by the built
  //   `createNetworkReferral` (src/network/writes.mjs:142) and has never been catalogued (F723).
  network:   ['network.party.archived', 'network.party.created', 'network.party.updated',
              'network.referral.created'],
  items:     ['items.price.changed',
              // ★ NEW (15B, P15B.7). ★★ THE DEFINITION AND THE PRICE ARE SEPARATE EVENTS because
              //   §Z4 makes them separate rows: a service exists without being sellable, and
              //   `price.changed` is the supersede, which is the event anyone downstream cares
              //   about. Collapsing them would lose the distinction §Z4 exists to keep.
              'items.service.archived', 'items.plan.archived', 'items.service.created', 'items.package.created', 'items.plan.created',
              // ★★★ NEW (Task 2.4, 02-items.md §5). Four new topics, no new SECTION (`items` already
              //     exists) — JS-only per this file's own header, no migration. The two discount
              //     topics carry `subjectType: "discount"` (new SUBJECT_TYPES member, below); the two
              //     agreement-requirement topics reuse the EXISTING service/package/plan subject
              //     types, carried on the item the requirement attaches to (`item_agreement_requirement`
              //     has no record page of its own, §5's own reasoning).
              'items.discount.created', 'items.discount.active_changed',
              'items.agreement_requirement.attached', 'items.agreement_requirement.detached',
              // ★★★ NEW (Task 2.5, 02-items.md §5). Six topics — two per catalogue subject
              //     (service/package/plan) — for `setItemActive`'s `POST /api/items/active`. Not
              //     collapsed into one `.active_changed` per type: §5's own table names each
              //     direction its own topic (`stopped_selling` / `sellable_again`), matching how
              //     `items.service.archived` already has its own name rather than a shared
              //     `items.*.archived` reading `archived: true/false`.
              'items.service.stopped_selling', 'items.service.sellable_again',
              'items.package.stopped_selling', 'items.package.sellable_again',
              'items.plan.stopped_selling', 'items.plan.sellable_again',
              // ★★★ NEW (Stage 14 task 14.15, STAGE-14-PLAN.md:883-887). Fifteen topics for the
              //     Stage 14 items modules — catalogue (14.16), modifiers (14.17), options (14.18),
              //     images (14.19), loyalty (14.24), gift cards (14.25), the editors'/catalogue-sync
              //     updates, and discount's own `.updated` (distinct from `.active_changed`, Task
              //     2.4). Registered ahead of, or alongside, their emitters per §12's own rule.
              'items.category.created', 'items.modifier.created', 'items.option.created',
              // ★★★ THESE TWO WERE EMITTED BEFORE THEY WERE REGISTERED. 14.15's own closed list
              //     (its field 4) omitted them, while `src/items/modifiers.mjs:233,258` (task
              //     14.17) emits both — so `emit()` would have thrown `TopicViolation` on every
              //     modifier edit and every activate/deactivate. 14.15's builder MEASURED the gap
              //     and reported it rather than quietly adding topics its own task did not name;
              //     added here on the main thread, 25 Sep 2026.
              //   ★★ ADDED RATHER THAN DELETING THE EMITS, because the catalogue already carries
              //      `items.service.updated`, `.package.updated`, `.plan.updated`,
              //      `.discount.updated` and `.discount.active_changed`. Dropping modifiers'
              //      two would make a modifier the ONE item type whose edits tell nobody —
              //      an inconsistency nothing in the plan asks for.
              //    ★ And a `TopicViolation` is not a readable failure: `toAppError`
              //      (`src/http/errors.mjs:162-209`) has no branch for it, so it falls through to
              //      INTERNAL and surfaces as a bare 500.
              'items.modifier.updated', 'items.modifier.active_changed',
              'items.image.uploaded',
              'items.loyalty.points_earned', 'items.loyalty.reward_claimed', 'items.loyalty.told',
              'items.gift_card.sold', 'items.gift_card.voided', 'items.gift_card.nudged',
              'items.service.updated', 'items.package.updated', 'items.plan.updated',
              'items.discount.updated', 'items.catalogue.synced',
               // ★★ RUN-2 T19 (26 Sep 2026) — emitted by src/items/writes.mjs:849/875, never catalogued — creating a promotion code threw.
               'items.promotion_code.created', 'items.promotion_code.deactivated',
               // ★★★ NEW, Programs follow-up brief (30 Sep 2026, Part 1) — mirrors items.category's
               //   own three-topic shape (created here; category never got .updated/.deleted since
               //   it had no update/delete path until 25 Sep — program gets all three from day one).
               'items.program.created', 'items.program.updated', 'items.program.deleted', 'items.program.assigned',
              // ★★★ NEW, Programs follow-up brief (30 Sep 2026, Part 9) — package joins
              //   ARCHIVABLE (src/records/archive.mjs) once migration 0544 gives it archived_at.
              'items.package.archived'],
  // ★★★ NEW SECTION AT 0054 (P20.3a). A form SUBMISSION is a fact about a FORM, not about the
  //     Documents pipeline — a form template and a contract template are separate tools with separate
  //     template sets (P15C.5), and a submission is not an instrument. ADD3-1's first chain starts
  //     here and could not be built at all while the section did not exist.
  //   ★ THREE SEGMENTS, NOT TWO. ADD3-1 writes the topic as `form.submitted`, which the database
  //     REFUSES: `event_topic_check` is `^[a-z]+\.[a-z_]+\.[a-z_]+$`. Every one of ADDENDUM 3's nine
  //     chain topics is written in the two-segment form, so all six new ones are spelled out to three
  //     here rather than copied.
  forms:     ['forms.form.submitted'],
  // ★★★ NEW SECTION AT 0054 (P20.3a). Work done FOR AN ACCOUNT (ADD3-2).
  //   ★★ `run.access.granted` LIVES HERE AND IS NOT ITS OWN SECTION: ADD3-2 lists **Access as one of
  //      the Run services**, and a grant being lost is exactly what makes a schedule item
  //      `not_deliverable_no_grant`. See migration 0054's note — this is a recorded decision, not an
  //      omission of a third section.
  run:       ['run.item.blocked', 'run.access.granted', 'run.review.ask_sent',
              'run.competitor.watch_recorded'],
  growth:    ['growth.campaign.sent', 'growth.campaign.queued', 'growth.campaign.scheduled',
              'growth.consent.unsubscribed', 'growth.consent.resubscribed', 'growth.landing_page.lead',
              // ★ NEW (task 20.48). Sequence events: template activation, campaign group creation,
              // engagement metrics (sampled), subscription, step sends, lead scoring.
              'growth.template.activated', 'growth.campaign_group.created',
              'growth.campaign.opened', 'growth.campaign.clicked',
              'growth.subscribe.joined', 'growth.sequence.step_sent', 'growth.lead_score.crossed',
               // ★★ RUN-2 T19 (26 Sep 2026) — emitted by campaignGroups.mjs / landingPages.mjs, never catalogued — every landing-page and campaign-group write threw.
               'growth.campaign_group.updated', 'growth.campaign_group.deleted', 'growth.campaign_group.attached', 'growth.campaign_group.detached', 'growth.campaign_group.paused', 'growth.landing_page.created', 'growth.landing_page.updated', 'growth.landing_page.deleted', 'growth.landing_page.published',
               'growth.landing_page.drafted'],
  tasks:     ['tasks.task.assigned', 'tasks.task.completed', 'tasks.task.snoozed',
              'tasks.task.reassigned', 'tasks.automation.ran',
              // Run 7 (11 Oct 2026): a background job gave up on something the practice can fix, and its task was opened. The job path has no event of its own, and a chain task
              // needs one to be de-duplicated (0353), so this fact anchors it; before this, every job give-up failed to open its task and only logged.
              'tasks.job.gave_up'],
  // ★★★ NEW SECTION AT 0064 (P0.6, F96). THE TENANT'S OWN CREDENTIAL AND INTEGRATION SURFACE.
  //   ★★ Minting an API key grants standing programmatic access to a tenant's entire dataset and
  //      wrote NOTHING to the audit log built to record exactly that class of action. These two
  //      topics are what make `/settings/developer/audit-log` able to answer "who granted access,
  //      and when".
  //   ★★★ NOT `platform`. Platform is the CROSS-TENANT namespace (§A9); a key belongs to exactly
  //       one tenant, and putting it there would put a tenant's fact outside its own boundary.
  //   ★ ONLY THE TWO THAT ARE EMITTED ARE DECLARED. Embed publishable keys, webhook endpoint
  //     secrets and `kek_version` rotation belong to this section too — that decision is settled
  //     (0064's comment) — but their topics land in the phase that EMITS them. [MEAS, F68] this
  //     catalogue already carries 17 declared-and-never-emitted topics; adding four more would
  //     grow the exact defect P8.4 exists to remove.
  // ★★★ STAGE 3 TASK 4 — THE WEBHOOK-ENDPOINT TOPIC FIX (02-event-catalogue.md §4). [MEASURED]
  //     `POST /api/developer/webhook-endpoints` (`src/routes/developer.mjs`) emitted
  //     `developer.api_key.created` for a WEBHOOK ENDPOINT — the same topic the API-key route emits
  //     for a completely different subject (`subjectType: "webhook_endpoint"` vs `"api_token"`), so
  //     one topic named two unrelated facts and a listener subscribed to "a key was created" would
  //     also fire for "an endpoint was registered". `developer.webhook_endpoint.created` is the
  //     correct, separate topic; the route below is updated to emit it.
  //   ★★ NO MIGRATION NEEDED, MEASURED: the `developer` section is already in `event_emitted_by_check`
  //      (migration 0064). A new TOPIC inside an existing section is an edit to this file only —
  //      the same rule 0064's own comment states (a SECTION is a database change, a TOPIC is not).
  //   ★ `.removed` is declared alongside `.created` because §12's own rule is "new events are added
  //     here first" — but it is RESERVED (`db/gates/s3_topic_emitters.mjs`), not emitted: there is
  //     no DELETE/disable route for a webhook endpoint and no `removeWebhookEndpoint` function to
  //     call from one (`src/webhooks/outbound.mjs` has none). Declaring it now gives that future
  //     route a name to emit rather than inventing one when it is built.
  // ★★★ 7.25 — `api_key.scopes_changed`. An existing key's capability toggles can change WITHOUT its
  //     secret changing (`src/routes/developer.mjs`'s new scopes handler, migration 0201's
  //     `keystone.set_api_token_scopes`). Emitted only when a row actually changed — never on a
  //     replay, a revoked key or another tenant's key.
  developer: ['developer.api_key.created', 'developer.api_key.revoked',
              'developer.webhook_endpoint.created', 'developer.webhook_endpoint.removed',
              'developer.api_key.scopes_changed',
              // FINAL PUSH Stage 6 (7 Oct 2026): a webhook secret was rotated (FP-F5); the addresses a key may be used from were changed (FP-F4). Neither payload carries a secret.
              'developer.webhook_endpoint.secret_rotated', 'developer.api_key.allowlist_changed', 'developer.api_key.policy_changed'],
  // ★★★ STAGE 4 TASK 10 — `platform.job.retried` AND `platform.job.given_up`, FOR THE SAME REASON
  //     `platform.impersonation.started` EXISTS (§A9): a platform operator reached into a practice's
  //     work, and the practice can see that they did. Retrying a practice's job or closing its
  //     unacknowledged give-up are both acts ON that practice, performed by somebody who does not
  //     work there — so both land in THAT PRACTICE'S OWN audit log, not only in the platform's.
  //   ★★ NO MIGRATION. [MEASURED] `platform` is already in `event_emitted_by_check` (0064's rule: a
  //      SECTION is a database change, a TOPIC is not), so this is an edit to this file and to
  //      TOPIC_WORDING. ★ Neither is RESERVED: both are emitted by src/platform/jobActions.mjs.
  //   ★ The give-up reason the person types is NOT in the payload — free text is refused by the
  //     payload lint (§2.4), and it belongs on the ledger row, which is where it is kept.
  platform:  ['platform.tenant.provisioned', 'platform.impersonation.started',
              'platform.job.retried', 'platform.job.given_up',
              // ★ Stage 18 task 18.4 — operator's ask: request, answer, end. Emitted by
              //   src/platform/accessRequests.mjs (18.3) when an operator asks for temporary
              //   access to a tenant, when an owner answers, and when the access ends.
              'platform.support_access.requested', 'platform.support_access.answered',
              'platform.support_access.ended',
              // ★ R2 report item (26 Sep 2026) — the n8n workflow-error callback (RESERVED key
              //   `platform.n8n_error` in src/routes/automationsCallback.mjs) could never record its
              //   event: its old topic, `platform.n8n_error`, is only 2 segments AND contains a digit
              //   ("n8n"), which `event_topic_check` (0016:26, `^[a-z]+\.[a-z_]+\.[a-z_]+$`) refuses
              //   either way — no segment may contain a digit. `platform.automation.workflow_failed`
              //   is 3 segments, no digits, and passes that CHECK (verified with the live regex
              //   before use). NO MIGRATION for the topic itself — same 0064 rule as the pair above:
              //   `platform` is already in `event_emitted_by_check`.
              'platform.automation.workflow_failed'],
  // ★★★ TASK 12.3 — `12-signup-first-run-people.md` §5. Two new topics, both emitted inside
  //     `POST /api/signup/questions` (`src/routes/signup.mjs`): the tenant's own answers, and the
  //     sample-client producer's own creation (`src/provisioning/sampleContent.mjs`) — fired only
  //     when `sampleClientsRequested` is true.
  // ★★★ TASK 12.5 — `provisioning.samples.removed`, emitted from `removeSamples`
  //     (`src/people/writes.mjs`), the handler behind `POST /api/people/samples/remove`
  //     (`src/routes/writes.mjs`). One event per call, not one per archived person — each archived
  //     sample person already gets its own `people.person.archived` from `archiveRecord` (§3.7).
  provisioning: ['provisioning.run.completed', 'provisioning.step.failed',
                 'provisioning.questions.answered', 'provisioning.samples.created',
                 'provisioning.samples.removed'],
  // ★★★ NEW SECTION AT 0150 (STAGE 4 TASK 4, F505). THE TENANT'S OWN CONFIGURATION SURFACE.
  //   ★★ [MEASURED, F505] spec 02 §5 planned this section from the start — nine topics, named —
  //      but no Stage 3 task carried it, and `src/routes/settings.mjs` UPDATEd a practice's own
  //      slug with no event at all. write-census flagged it and it was left RED on purpose rather
  //      than exempted, so it could not be forgotten a second time.
  //   ★★★ ONLY `setting.changed` IS EMITTED TODAY. The other eight are declared here — because §12's
  //       own rule is "new events are added to the catalogue first" — but RESERVED in
  //       `db/gates/s3_topic_emitters.mjs` with the screen that owns each one: nothing in `src/`
  //       writes terminology, automations, notification rules, or the data export/import tools yet.
  //       [MEAS, F68] this catalogue already carries topics declared and never emitted, and P8.4
  //       exists to remove that class — RESERVED names the owner so it is a tracked gap, not a
  //       silent one.
  //   ★ NOT `platform` (the CROSS-TENANT namespace, §A9) and not `developer` (the credential and
  //     integration surface, 0064) — a setting is a fact about ONE tenant's own configuration, and
  //     it is neither a credential nor a cross-tenant fact.
  settings:  ['settings.setting.changed', 'settings.terminology.changed', 'settings.automation.changed',
              'settings.notification_rule.changed', 'settings.data.export_requested',
              'settings.data.export_ready', 'settings.data.person_export_requested',
              'settings.data.person_removal_completed', 'settings.import.completed',
              // ★ NEW at task 6.5 (spec 06 §5, §2.7). Fired by `src/billing/webhook.mjs`'s mirror,
              //   called from `src/routes/webhooks.mjs`'s existing 'stripe' provider dispatch, every
              //   time a Stripe subscription-family event updates `keystone.workbench_subscription`.
              //   subjectType: 'workbench_subscription' (SUBJECT_TYPES, above). Unlike its eight
              //   siblings above, this one IS emitted from `src/` at build time — not RESERVED in
              //   `db/gates/s3_topic_emitters.mjs`.
              'settings.subscription.updated',
              // ★ Stage 11 task 11.23 (CT-F44) — emitted by `announceChange` (src/settings/reach.mjs)
              //   when a practice tells its clients about a policy change. Payload `{key}` only.
              'settings.policy.announced',
              // ★ Stage 17 task 17.15 (CT-F12) — emitted by the usage reconciliation job
              //   (`src/billing/usageReconcile.mjs`) when a month's counts are finalized.
              'settings.usage.reconciled',
              // ★ Stage 12 (CT-F22) — the location model; and `settings.import.undone`, emitted by
              //   the built undo route since round two and never catalogued (F723).
              'settings.location.created', 'settings.location.updated', 'settings.import.undone',
              // ★ Stage 18 task 18.29 — device registration for push notifications.
              'settings.push_device.registered', 'settings.push_device.removed',
              // ★ NEW (T0.1, CONTRACTS §5).
              'settings.invoice_layout.archived', 'settings.invoice_layout.unarchived',
              'settings.payment_methods.changed'],
  // ★★★ NEW SECTION AT 0290 (spec 03a, task 3a.1, F-5 spot-check 22 Sep 2026). THE
  //     CALENDAR-CONNECTION LIFECYCLE: connect/disconnect, a renewal failure, and a remote-change
  //     flag on a synced booking (03a-calendar-and-sync.md §5).
  //   ★★ NOT `settings`, even though `calendar.connection.connected`/`.disconnected` reuse the
  //      `settings.changed` AUDIT pattern (§5) — that reuse is about which AUDIT_ACTIONS entry the
  //      listener writes, not about which outbox SECTION owns the event itself. A calendar
  //      connection is a fact about Engagements' own calendar/sync surface, not the tenant's
  //      configuration screens.
  //   ★ Ships together with migration 0290, which widens `event_emitted_by_check` to admit
  //     `calendar` — this file's own two-layer rule above: a NEW SECTION is a database change AND a
  //     `TOPICS` key, together, or `emit()` and Postgres disagree (the exact 0023 split-brain).
  calendar:  ['calendar.connection.connected', 'calendar.connection.disconnected',
              'calendar.connection.renewal_failed', 'calendar.remote_change.flagged'],
  // ★★★ NEW SECTION AT 0447 (Stage 16 task 16.6). Reports events — monthly ready.
  // ★ [TY, 2 Oct 2026] 'reports.accountant.sent' removed along with the whole accountant feature.
  reports:   ['reports.monthly.ready'],
  // ★★ NEW — the messages section. src/messages/writes.mjs has emitted `emittedBy:"messages"`
  //    since it shipped, into a section that did not exist, so POST /api/app/messages threw at
  //    outbox.mjs:361 before it committed. Migration 0474 widens event_emitted_by_check in the
  //    same change — a section IS a database change (0054's rule), unlike a topic.
  messages: ['messages.message.sent'],
  // ★★★ NEW SECTION AT 0481 (TASK 20.21). THE PLATFORM LIFECYCLE AND ANNOUNCEMENTS.
  //   ★ Eight topics: subscription (plan/status changes from Stripe webhook mirror),
  //     usage (at 80% of any meter), run (finding on a scheduled item), onboarding (7-day stalled
  //     setup meter or no staff sign-in), announcement (published by operators),
  //     promotion (published and consent-gated), and lifecycle (trial ending ≤7 days, win-back).
  //   ★ Transactional entries (subscription, usage, run, onboarding) are `locked: true` in the
  //     automation catalogue. Promotional entries (announcement, promotion) are unlocked and
  //     consent-gated: workbenchAnnouncements refuses a recipient whose consent_record withdraws
  //     marketing, and every promotional send carries an unsubscribe path that WRITES consent_record.
  // ★ [TY, 2 Oct 2026] 'workbench.lifecycle.win_back' REMOVED ENTIRELY (its only emitter,
  //   automations/sweeps.mjs's own SWEEP 3, is gone — see that file's header note) — removed here
  //   too so nothing could ever emit it again even by accident.
  workbench: ['workbench.subscription.updated', 'workbench.usage.warning', 'workbench.run.finding',
             'workbench.onboarding.stalled', 'workbench.announcement.published',
             'workbench.promotion.offered', 'workbench.lifecycle.trial_ending'],
});

export const ALL_TOPICS = Object.freeze(Object.values(TOPICS).flat());

// ★★★ DERIVED FROM `TOPICS`, NOT DECLARED — AND THE FIRST THING THAT HAPPENED WHEN THIS FILE WAS
// EXTENDED PROVES WHY. It used to be its own frozen array of ten names sitting a few lines above
// the `TOPICS` map whose keys are THE SAME FACT. Adding the `network` section to `TOPICS` at 15B
// left this list untouched, so `SECTIONS.includes('network')` was **false** while
// `TOPICS.network` existed — and `emit()` validates `emittedBy` against SECTIONS, so every network
// write would have been refused by our own guard with *"network is not a section"* while the
// database (migration 0023) was perfectly willing to store it. **Two sources of truth for one
// fact, diverging within minutes of the fact changing.**
// ★ This is the same defect class as F60 (`buildState.BUILT` hand-written beside a 29-entry
//   `LIST_VIEWS`) and as P4.10's two disagreeing nav label tables. The fix is the same one: stop
//   hand-writing what is already written down.
// ★★ The remaining agreement that CANNOT be derived is with the database, because
//    `event_emitted_by_check` is a closed list in SQL. The P15B gate asserts the two are equal.
export const SECTIONS = Object.freeze(Object.keys(TOPICS));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 2 — THE SUBJECT-TYPE VOCABULARY. 02-event-catalogue.md §2 rule 3: "subject types
//     are one fixed vocabulary (person, document, booking, invoice, …)."
//
// ★★★ THE MEASURED DEFECT THIS CLOSES (F474). Before this task, `emit()` validated `topic` and
//     `emittedBy` against closed sets and left `subjectType` as a bare, unchecked string — so three
//     uncoordinated vocabularies grew up around one column: History's own reader (`records/
//     queries.mjs` `ACTIVITY_SUBJECT`, 9 values), the 26 literals actually written by `emit()`
//     callers (recon §3, [MEASURED via `grep -rhoE "subjectType:\s*[^,\n]+"`] 35 raw occurrences
//     collapsing to 28 distinct names once `app_user`/`user`/`document_instance` are folded in), and
//     `src/tasks/chains.mjs`'s own hand-picked five. A person's writes used `app_user`; a document's
//     used `document_instance`; History's `ACTIVITY_SQL` looked for `person`/`document` and found
//     neither — so the two record types opened most by a coach had an empty History tab BY
//     CONSTRUCTION, for every event type except the two dynamic call sites in `records/archive.mjs`.
//
// ★★ ONE CLOSED SET, DERIVED FROM WHAT THE PRODUCT ACTUALLY NEEDS, NOT INVENTED: History's own 9
//    subject types, plus every other object an existing writer legitimately emits about but that has
//    no record page (and therefore no History tab to feed) — recon §3's full measured list. Nothing
//    here is renamed except the three literals §2 rule 3 names explicitly: `app_user` and `user`
//    become `person` (both were always "an app_user row", just reached through two different write
//    paths — permissions/teams/guardians wrote `user`, people/documents wrote `app_user`); `document_
//    instance` becomes `document`, matching the table's own record-page name and the one literal
//    (`records/archive.mjs`) that was already spelling it correctly.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const SUBJECT_TYPES = Object.freeze([
  // ★ History's own 9 (`src/records/queries.mjs` `ACTIVITY_SUBJECT`, :699-703) — every one of these
  //   already has a record page and a History tab reading `ACTIVITY_SQL` for it.
  "person", "account", "network_party", "document", "service", "plan", "subscription",
  "booking", "invoice",
  // ★ Every other object an existing emitter legitimately writes about, measured in recon §3, that
  //   has no record page of its own (so nothing reads History for it, but the vocabulary still has
  //   to be closed and single, because `event.subject_type` is one column, not two).
  "entitlement", "run_schedule_item", "document_template", "team", "payment", "package",
  "availability_rule", "api_token", "account_pipeline", "webhook_endpoint", "role",
  "payment_method", "line_item", "document_type", "document_category", "date_override",
  "custom_field", "campaign", "booking_policy",
  // Run 9 Part 3.6: a playbook run whose wait is over (documents.playbook.step_due).
  "playbook_run",
  // Shared document engine (6 Oct 2026): an AI draft job (documents.ai.job_requested).
  "document_ai_job", "document_detect_job", "usage_period",
  // ★ NEW at task 3a.2 (spec 03a §5, F-18 spot-check, 22 Sep 2026). `calendar_connection` — for
  //   `calendar.connection.connected`/`.disconnected`/`.renewal_failed`, which are facts about a
  //   CONNECTION row, not any one booking. `calendar.remote_change.flagged` deliberately does NOT
  //   use this — it carries `subjectType: 'booking'` instead (spec 03a §5's own walkthrough).
  //   JS-only enforcement (`keystone.event.subject_type` carries no database CHECK,
  //   `src/events/outbox.mjs:401`) — no migration.
  "calendar_connection",
  // ★ `message` — for `messages.message.sent` (src/messages/writes.mjs), a fact about one MESSAGE row.
  //   It was never added: every client message 500'd with TopicViolation at emit (measured 26 Sep
  //   2026, the first message a test client sent from the portal). JS-only, same as above.
  "message",
  // ★ Stage 20 (0498) — `booking.availability.changed` for a host's daily cap (setHostDailyCap).
  "host_booking_limit",
  // ★ NEW at task 2.4 (spec 02 §5). `discount` — for `items.discount.created`/`.active_changed`,
  //   facts about a DISCOUNT DEFINITION row, which has no record page of its own. JS-only
  //   enforcement (same reasoning as `calendar_connection` immediately above) — no migration.
  "discount",
  // ★ NEW at task 6.5 (spec 06 §5). `workbench_subscription` — for `settings.subscription.updated`,
  //   fired when the Stripe webhook mirrors a change to `keystone.workbench_subscription`. Distinct
  //   from the pre-existing `subscription` entry above (History's own 9): that one is a client-
  //   facing engagement/package subscription with its own record page; this one is the practice's
  //   OWN the platform-billing relationship, which has no record page — same reasoning as
  //   `calendar_connection`/`discount` immediately above. JS-only enforcement — no migration.
  "workbench_subscription",
  // ★ Stage 12
  "payer_group", "payer_group_member", "staff_shift", "time_off", "referral", "person_goal",
  "location", "person_merge_dismissal",
  // ★ NEW at task 14.15 (the maintainer's own widening, STAGE-14-PLAN.md, this dispatch — NOT an inference).
  //   `image` — for `items.image.uploaded`, a fact about an `image` library row with no record page
  //   of its own. 14.19 measured this member absent and emitted with `subjectType: null, subjectId:
  //   null` instead, carrying the id in `payload.image_id`; `src/items/images.mjs` is NOT changed to
  //   use this member by this task — that file is 14.19's, not 14.15's — only the vocabulary itself
  //   is widened, same posture 2.4 took for `discount` immediately above. JS-only enforcement
  //   (same reasoning as `calendar_connection`/`discount`/`workbench_subscription`) — no migration.
  "image",
  // ★ NEW at task 14.15 (coordinator's addition, mid-build — same precedent as `image` immediately
  //   above and `discount` at task 2.4). `gift_card` — for `items.gift_card.sold`/`.voided`/
  //   `.nudged`, facts about a `gift_card` row with no record page of its own. 14.25 measured this
  //   member absent and no task's file list adding it, and emitted with `subjectType: null,
  //   subjectId: null` instead (`src/items/giftCards.mjs` GAP 3, its own header) — that file is NOT
  //   changed to use this member by this task; only the vocabulary itself is widened. JS-only
  //   enforcement — no migration.
  "gift_card",
  // ★ NEW at Stage 15 task 15.1 (STAGE-15-PLAN.md §15.1). Eight subject types for the refund/
  //   payout/dispute mirror rows and the estimate/payment-plan/payment-link/device families Stage
  //   15 builds — `refund`, `payout`, `dispute`, `estimate`, `payment_plan`, `payment_link`,
  //   `device`, `refund_request` — each a fact about a row with no record page of its own.
  //   JS-only enforcement (`keystone.event.subject_type` carries no database CHECK,
  //   `src/events/outbox.mjs:401`) — no migration.
  "refund", "payout", "dispute", "estimate", "payment_plan", "payment_link", "device",
  "refund_request",
  // ★★★ RUN-2 T19 (26 Sep 2026) — TEN SUBJECTS THAT BUILT CODE ALREADY EMITS, never added here, so
  //     emit() refused every one of them at runtime ("is not a subject type"): creating/assigning/
  //     completing a task, every automation run, every landing-page / campaign-group / tax-id /
  //     coupon-code write, support-access requests, credit notes, template activation, and the
  //     n8n error callback. Found by scanning every literal `subjectType:` in src/ against this list.
  "task", "automation_run", "landing_page", "campaign_group", "tax_id", "promotion_code",
  "support_access", "credit_note", "email_template", "workflow_error",
]);

/**
 * ★★★ THE THREE LITERALS §2 RULE 3 RETIRES, AND WHAT THEY BECOME. Not consulted by `emit()` —
 *    `emit()` REFUSES these outright (they are not in `SUBJECT_TYPES`), because the fix is to rewrite
 *    every writer to pass the real name (Stage 3 Task 2), not to keep accepting the old one and
 *    silently translating it forever.
 * ★★ Exported anyway, and kept as the one place this specific correction is written down, because
 *    two other things need to state it EXACTLY once each rather than re-deriving it: migration 0136
 *    (rewriting the 20 existing rows this recon found) and `src/records/archive.mjs` (whose dynamic
 *    `subjectType` used to hand-roll the `document_instance` half of this same mapping as a local
 *    ternary — see that file for why it now reads this map instead of repeating it).
 */
export const SUBJECT_TYPE_ALIASES = Object.freeze({
  app_user: "person",
  user: "person",
  document_instance: "document",
});
