// TASK 6.3 — THE NOTIFICATION-RULE TOPIC CATALOGUE. `SetNotifications`' events × role matrix
// (06-settings.md §2.3, §3, §11). Same idiom as `src/automations/catalogue.mjs:1-140`'s
// `AUTOMATIONS` array — one frozen list, and the screen/route/seed all read this one copy.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY ENTRY NAMES A TOPIC ALREADY EMITTED SOMEWHERE IN `src/`, MEASURED BY FILE:LINE — NEVER
//     AN ENGLISH GUESS SPELLED AS THREE SEGMENTS. `automations/catalogue.mjs:79-97`'s own comment
//     states the failure this avoids: "I WROTE `money.invoice.overdue` FIRST AND IT DOES NOT
//     EXIST... an automation subscribed to an invented topic would be registered, listed on the
//     settings screen, toggled ON by a practice, and receive nothing forever." A
//     `notification_rule` row behaves the same way — this is CLAUDE.md failure #1
//     ("built and wired to nothing") in miniature, one row at a time.
//
// ★★★ NINE TOPICS WERE NAMED IN PLAIN ENGLISH BY 06-settings.md §3 AND MOCKUPS §13:418
//     ("receipts, documents to sign, booking confirmations and cancellations" — the four `alwaysOn`
//     — plus "booking reminder, waitlist offer, document countersign needed, invoice overdue, task
//     assigned"). Migration 0336's own header deferred the seed for exactly this reason (the topic
//     vocabulary did not exist yet). SEVEN resolve to a real, reachable emitter below. TWO DO NOT —
//     see the STOP note at the bottom of this file. They are left OUT of `NOTIFICATION_TOPICS`
//     rather than guessed, per this task's own instruction: "don't let it block the rest."
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const NOTIFICATION_TOPICS = Object.freeze([
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ALWAYS ON — MOCKUPS §13:418's four, `locked = true` in `keystone.notification_rule` (0336) and
  // refused by `setNotificationRule()` (`src/notifications/writes.mjs`) if a caller tries to turn
  // one off, even an Owner.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    // ★ "Booking confirmations" (MOCKUPS §13:418). NOT `booking.booking.confirmed` — that topic is
    //   DECLARED (`src/events/topics.mjs:80`) but has NO emitter anywhere in `src/` (measured by
    //   grep — the F68 "declared and never emitted" class this project has already named). The
    //   real event that tells a client their session is booked is `booking.booking.created`,
    //   emitted at `src/booking/createBooking.mjs:222` and `src/booking/publicBooking.mjs:373`,
    //   and it is the SAME topic `automations/catalogue.mjs:47-49`'s own "Booking confirmation"
    //   entry already uses for the identical fact.
    topic: "booking.booking.created",
    label: "A client books a session",
    family: "booking",
    defaultOn: true,
    locked: true,
  },
  {
    // ★ "Booking cancellations" (MOCKUPS §13:418). Emitted at `src/booking/createBooking.mjs:319`.
    topic: "booking.booking.cancelled",
    label: "A session is cancelled",
    family: "booking",
    defaultOn: true,
    locked: true,
  },
  {
    // ★ "Documents to sign" (MOCKUPS §13:418). `documents.document.sent` is emitted at
    //   `src/documents/writes.mjs:475` and is already the topic `TOPIC_TEMPLATE`
    //   (`src/queue/tasks.mjs:674`) maps to the `document.ready_to_sign` email, and the topic
    //   `automations/catalogue.mjs:71-73`'s "Unsigned document chase" subscribes to for the same
    //   fact.
    topic: "documents.document.sent",
    label: "A document is sent to sign",
    family: "documents",
    defaultOn: true,
    locked: true,
  },
  {
    // ★ "Receipts" (MOCKUPS §13:418). `money.invoice.paid` is emitted at
    //   `src/payments/webhook.mjs:103-105` — its own comment names the fact directly: "'paid'
    //   receipts sent repeatedly for one payment" (`:97`). There is no topic spelled `money.receipt`
    //   anywhere in `src/events/topics.mjs`; this is the real event behind the English name.
    topic: "money.invoice.paid",
    label: "A payment is received (receipt)",
    family: "money",
    defaultOn: true,
    locked: true,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // TOGGLEABLE — a practice may switch these off per role/channel.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    // ★ "Booking reminder" (§3). Emitted at `src/queue/tasks.mjs:410,551` (the scheduled reminder
    //   job) and already the topic `automations/catalogue.mjs:55-57`'s "Session reminder" uses.
    //   The frame's own row 6 ("Reminder before a session",
    //   `specs/mockups/SetNotifications.frame.html:61`) names this exact fact.
    topic: "booking.booking.reminder",
    label: "Reminder before a session",
    family: "booking",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ "Document countersign needed" (§3). There is no topic spelled `document.countersign_needed`
    //   anywhere in `src/events/topics.mjs` — `02-event-catalogue.md:86` names it but that section
    //   of that file is an early planning list in two-segment names (`document.reminder_due`,
    //   `waitlist.offered`, …) that were never carried into the real three-segment vocabulary
    //   (measured: none of them exist in `src/events/topics.mjs` or anywhere in `src/`).
    //   `documents.document.signed` (emitted at `src/documents/writes.mjs:666`, whenever ANY party
    //   signs and the instrument remains `partially_signed`, payload carrying `remaining_parties`)
    //   is the closest and only real fact matching "somebody signed and the instrument now needs
    //   its next signer" — the moment a countersignature becomes needed.
    topic: "documents.document.signed",
    label: "A document needs a countersignature",
    family: "documents",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ "Invoice overdue" (§3). `automations/catalogue.mjs:79-97`'s own comment already answers
    //   this exact question, verbatim: *"`money.invoice.opened`, NOT `money.invoice.overdue` — I
    //   WROTE THE SECOND ONE FIRST AND IT DOES NOT EXIST... there is no 'overdue' EVENT — overdue
    //   is a STATE reached by the passage of time, and nothing emits when a date passes. So the
    //   workflow subscribes to the invoice being OPENED and applies its own delay."* Reusing that
    //   same, already-settled answer rather than re-deriving a second one. Emitted at
    //   `src/money/writes.mjs:504`.
    topic: "money.invoice.opened",
    label: "An invoice is overdue",
    family: "money",
    defaultOn: true,
    locked: false,
  },
  // ★ NEW (B3.1): four money notifications from the Stripe webhook flow. Emitted from
  //   `src/money/writes.mjs` when refund/payout/dispute states change.
  {
    // ★ Payment failure. Emitted from `createOrUpdateRefund` when state becomes "failed".
    topic: "money.payment.failed",
    label: "A payment fails",
    family: "money",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ Payout failure. Emitted from `createOrUpdatePayout` when state becomes "failed".
    topic: "money.payout.failed",
    label: "A payout fails",
    family: "money",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ Dispute opened. Emitted from `createOrUpdateDispute` when state becomes "under_review"
    //   (which means Stripe has opened the dispute for investigation).
    topic: "money.dispute.opened",
    label: "A payment dispute opens",
    family: "money",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ Day summary. Emitted by the `staff_day_summary` periodic job (Stage 18 task 18.31b) when
    //   a coach has sessions today. Sent as a push at 8:00 practice time.
    topic: "booking.day.summary",
    label: "Your day, first thing",
    family: "booking",
    defaultOn: true,
    locked: false,
  },
  // ★ F836, "7 missing emails" brief, 1 Oct 2026 — four topics with a real emitter AND, as of this
  //   brief, a real listener (src/queue/tasks.mjs's TOPIC_HANDLERS) for the first time.
  {
    // ★ Emitted at src/documents/dueFacts.mjs:28-30 (the document-expiry sweep).
    topic: "documents.document.expired",
    label: "A document lapses unsigned",
    family: "documents",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ §23.15.1 — emitted when a person opens a document for the first time (pdfSigning.openForParty, writes.mjs for the template builder). Off by default: it is the noisiest of the four.
    topic: "documents.document.opened",
    label: "Someone opens a document I sent",
    family: "documents",
    defaultOn: false,
    locked: false,
  },
  {
    // ★ §23.5.2 — emitted by pdfSigning.requestChangesAsParty when a person asks for changes instead of signing.
    topic: "documents.document.changes_requested",
    label: "Someone asks for changes to a document",
    family: "documents",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ §23.15.1 — emitted by src/documents/emailIdentity.mjs when the mail provider reports an invitation bounced.
    topic: "documents.document.bounced",
    label: "A document's email bounces",
    family: "documents",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ Emitted at src/documents/writes.mjs:796-800 (the public decline route).
    topic: "documents.document.declined",
    label: "A document is declined",
    family: "documents",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ Emitted at src/money/creditNotes.mjs:305-309.
    topic: "money.credit_note.issued",
    label: "A credit note is issued",
    family: "money",
    defaultOn: true,
    locked: false,
  },
  {
    // ★ Emitted at src/money/writes.mjs:457-461 — gated in the listener to source_type='package'
    //   so a plan renewal or manual comp does not fire this topic's "you bought a package" email.
    topic: "money.entitlement.granted",
    label: "A client buys a package",
    family: "money",
    defaultOn: true,
    locked: false,
  },
]);

export const NOTIFICATION_TOPIC_KEYS = Object.freeze(NOTIFICATION_TOPICS.map((t) => t.topic));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STOP AND REPORT — TWO OF THE NINE, NOT GUESSED.
//
// 1 · "Waitlist offer." [MEASURED] grep of `src/**/*.mjs` for `waitlist` finds ZERO event topics —
//     only a nav row (`src/nav/sections.mjs:124`) and a `buildState.mjs:192` entry that marks
//     `/engagements/waitlist` itself as missing its own table (`missingTable: "waitlist_entry"`,
//     phase "15B"). The early-planning list at `02-event-catalogue.md:80` names
//     `waitlist.joined`/`waitlist.offered`/etc., but none of them were ever built — the waitlist
//     FEATURE itself does not exist yet, so there is no real event a notification rule could ever
//     fire on. Inventing a topic string here would seed a row that matches nothing, forever.
//
// 2 · "Task assigned." [MEASURED] `tasks.task.assigned` IS in the closed catalogue
//     (`src/events/topics.mjs:220`) but grep of every `emit(tx, {…})` call site in `src/` finds NO
//     caller that ever passes it — `src/tasks/writes.mjs` (`openChainTask`/`closeChainTasks`) never
//     calls `emit()` at all; tasks in this system are opened/closed by CHAIN rules
//     (`src/tasks/chains.mjs`) reacting to OTHER sections' topics, not by their own assignment
//     event. This is the "declared, never emitted" class `src/events/topics.mjs:283`'s own header
//     names (F68) — a notification rule keyed on it would be configured-looking and permanently
//     silent, the exact failure this file exists to prevent.
//
// Both are left OUT of `NOTIFICATION_TOPICS` above, not stubbed with a guessed string. Wiring
// either one for real is a task for whichever spec builds the waitlist table or a task-assignment
// emitter — not a guess made here to fill out a count of nine.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
