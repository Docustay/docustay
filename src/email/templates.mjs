// P18.2 — ★★★ EMAIL TEMPLATES. THEY READ TERMINOLOGY LIVE, AND A SEND FREEZES WHAT THEY RESOLVED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE TERMINOLOGY SITUATION, MEASURED BEFORE BUILDING ON IT — because the item says "templates read
//     terminology live" and it would be easy to write that sentence into code without checking.
//
// [MEASURED 2026-09-13]
//   · Keystone's mechanism is `termKey` + `fallback` on nav rows (`src/nav/sections.mjs`), resolved by
//     `resolveNavLabels(terms)`.
//   · **`terms` IS `{}` TODAY.** `src/routes/index.mjs:100` says so in its own comment: *"terms = {}
//     until a terminology store exists."* There is NO store, and `/settings/terminology` is recorded as
//     **out of scope** (Part G #5).
//   · The "52-key CLOSED set" that `sections.mjs:163` refers to exists as a claim in a comment; there is
//     no module holding it.
//
// ★★ SO "READS TERMINOLOGY LIVE" MEANS SOMETHING PRECISE AND LIMITED HERE, and saying which is the
//    honest version of implementing it:
//      · templates resolve every party noun through `t(key, fallback)` **at render time**, from whatever
//        the tenant's resolver returns — so the day a store appears, templates follow it with no edit;
//      · today that resolver returns `{}`, so every template renders its FALLBACK;
//      · and a send FREEZES the resolved map, so a later store change cannot rewrite history.
//
// ★★★ THE FALLBACK IS MANDATORY, AND THAT RULE IS BORROWED DELIBERATELY. `sections.mjs`'s validator
//     rule (b) says: a row carrying a `termKey` and NO fallback renders BLANK the moment the store is
//     empty — "the blank returns with the next termKey row added". An email is worse than a nav row
//     here: a blank in a subject line is a message somebody receives and cannot act on, and there is no
//     second chance to render it. So `t()` THROWS on a missing fallback rather than returning "".

/** ★ The party nouns an email may name. A CLOSED list: a template cannot invent a term key. */
// ★★★ P10.6 — IMPORTED, NOT DECLARED. This module used to carry its OWN hardcoded list of eight
//     keys while `src/terminology/keys.mjs` derived four from the nav: **two closed sets, each
//     certain it was the closed set**, and the one over there had a header warning against exactly
//     this. A term configurable in one and unknown in the other is a word an operator renames and
//     sees change in the app and not in the email.
//   ★ It imports the VOCABULARY, not the store — so no cycle: `terminology/keys.mjs` imports only
//     the nav, and this module still knows nothing about settings.
export { TERM_KEYS } from "../terminology/keys.mjs";
import { DOCUMENT_TEMPLATE_FALLBACKS, DOCUMENT_TEMPLATE_REQUIRED_VARS } from "../documents/emailTemplates.mjs";
import { TERM_KEYS } from "../terminology/keys.mjs";

/**
 * ★★★ THE RESOLVER. `terms` is whatever the tenant has configured — `{}` today.
 * @returns {(key: string, fallback: string) => string}
 */
export function makeTermResolver(terms = {}) {
  return function t(key, fallback) {
    // ★★ A MISSING FALLBACK IS A PROGRAMMING ERROR, NOT A RENDER OUTCOME. Blank subject lines are how
    //    this class of bug reaches a person, and it cannot be un-sent.
    if (typeof fallback !== "string" || fallback.trim() === "") {
      throw new Error(
        `t("${key}") was called with no fallback. A term with no fallback renders BLANK whenever the ` +
        `tenant has not configured it — and today NO tenant has, because there is no terminology store. ` +
        `Every t() call must carry the word to use when nothing is configured.`);
    }
    if (!TERM_KEYS.includes(key)) {
      // ★ A closed set, for the same reason topics are closed: an unknown key would silently take the
      //   fallback forever and look correct, so a typo could never be found.
      throw new Error(`"${key}" is not a term key. The ${TERM_KEYS.length} are: ${TERM_KEYS.join(", ")}`);
    }
    const configured = terms?.[key];
    return typeof configured === "string" && configured.trim() !== "" ? configured : fallback;
  };
}

/** ★ Which terms a render actually consulted — this is what gets frozen onto the delivery row. */
export function makeRecordingResolver(terms = {}) {
  const base = makeTermResolver(terms);
  const used = {};
  const t = (key, fallback) => { const v = base(key, fallback); used[key] = v; return v; };
  return { t, used: () => ({ ...used }) };
}

/**
 * ★★★ THE TEMPLATES. Each one is `{ version, subject(vars, t), text(vars, t) }`.
 *
 * ★★ PLAIN TEXT ONLY, AND THAT IS A DECISION RATHER THAN AN OMISSION. An HTML email needs a sanitiser,
 *    an inliner and a plain-text alternative, and every one of those is a place for a client's name to
 *    arrive unescaped. Text cannot be a vector, renders everywhere, and is legible in a screen reader.
 *    ★ HTML is a later item and is NOT delivered here — stated so a reader does not assume it.
 *
 * ★ `version` is frozen onto the delivery row beside the rendered copy, so "which wording did they
 *   get" is answerable without guessing from a date.
 */
export const TEMPLATES = Object.freeze({
  ...DOCUMENT_TEMPLATE_FALLBACKS,   // the Documents island's own wordings
  // ★ A session reminder. ★★ IT NAMES THE TIME ZONE. A reminder saying "10:00" is a reminder somebody
  //   will get wrong, and across a DST boundary it is the one they will get wrong by an hour (§B4 STEP 3).
  "booking.reminder": {
    version: 2,
    subject: (v, t) => `${v.practiceName}: your session on ${v.whenLocal}`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `This is a reminder of your session with your ${t("userType.member", "Team member")}:\n\n` +
      `  ${v.serviceName}\n  ${v.whenLocal} (${v.timeZone})\n\n` +
      // ★★★ KS-16.2 RULING 5 — THE COUNT-DOWN, IN THE EMAIL AS WELL AS ON THE SCREEN. Square's own
      //     users complain that *"receipts do not count down, so a client cannot tell how many
      //     sessions are left"*, and that is precisely the state Keystone was in. The ruling names
      //     THREE surfaces, and a confirmation nobody has to open the app to read is one of them.
      //   ★★ OPTIONAL, AND ABSENT RATHER THAN ZERO. A client who bought no package has no standing
      //      to report, and "0 remaining" would tell them they had run out of something they never
      //      had. ★ It is deliberately NOT in REQUIRED_VARS for that reason.
      (v.creditStanding ? `${v.creditStanding}\n\n` : "") +
      // ★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — a video session's Zoom/Meet link, absent rather than
      //   blank for the same reason `creditStanding` is: most bookings before this task never
      //   recorded a location at all.
      (v.locationLine ? `${v.locationLine}\n\n` : "") +
      `If you need to change it, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
  },

  // ★ An invoice. ★★ THE AMOUNT IS PASSED ALREADY FORMATTED, by the caller that knows the currency.
  //   A template doing money arithmetic is a template that can get money wrong.
  "money.invoice_issued": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: invoice ${v.invoiceNumber} for ${v.amount}`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} is now available${v.dueLocal ? `, due ${v.dueLocal}` : ""}.\n\n` +
      `View it here: ${v.link}\n\n— ${v.practiceName}`,
  },

  // ★★★ TASK 8.10 — SIGN-IN MAIL. Sent by `src/email/authEmail.mjs`, never `sendNotificationEmail`
  //     (that path needs a `notificationId`, which an invitee or a code requester may not have).
  // ★ NONE OF THE FOUR NAME A ROLE OF THEIR OWN (`coach`/"client"/"parent" are terminology-configurable,
  //   `src/nav/sections.mjs:62`), so none of them call `t()` — a hardcoded role word here would be
  //   wrong for half the practices.
  // ★★★ Task 12.14 (OQ-12.8) — version 1 → 2: a changed body is a new version (this file's own
  //     header rule). `REQUIRED_VARS["auth.invite"]` (below) is UNCHANGED — `personalLine` is
  //     optional, so the missing-var throw at render time never fires for an invite with no message.
  "auth.invite": {
    version: 3,   // 3: names the product the person is joining (Docustay or the platform), in the subject and the body
    subject: (v, t) => v.productName === "Docustay" ? `${v.inviterName} invited you to join ${v.practiceName} on Docustay` : `${v.practiceName} invited you to join on ${v.productName || "Workbench"}`,   // Run 10 R10-36: the Docustay subject says who invited and to what, as the body does; the platform's is unchanged
    text: (v, t) =>
      `Hello,\n\n` +
      `${v.inviterName} has invited you to join ${v.practiceName} on ${v.productName || "Workbench"}.\n\n` +
      // ★ "A line from you" — `v.personalLine` is `""` when no message was given
      //   (`sendInviteEmail`'s own default, `src/routes/writes.mjs`), so this adds nothing for the
      //   vast majority of invites, same "absent rather than blank" idiom `booking.reminder`'s own
      //   `creditStanding` uses above.
      (v.personalLine ? `${v.personalLine}\n\n` : "") +
      `Accept the invitation here: ${v.acceptUrl}\n\n` +
      `This invitation expires on ${v.expiresOn}.\n\n` +
      `— ${v.practiceName}`,
  },

  // ★★★ THE CODE AND NOTHING ELSE. No name, no practice, no link — whoever intercepts this email
  //     learns a six-digit code and nothing about where to use it.
  "auth.email_code": {
    version: 1,
    subject: (v, t) => `Your Workbench sign-in code`,
    text: (v, t) =>
      `Your sign-in code is ${v.code}. It expires in ${v.minutes} minutes.\n\n` +
      `If you did not request this code, you can ignore this email.`,
  },

  // ★ Docustay's own password-reset mail (Part 29 B3): generated by us, sent through the sign-in sender, never Firebase's.
  "auth.password_reset": {
    version: 1,
    subject: () => `Reset your Workbench password`,
    text: (v) =>
      `Someone asked to reset the password for this email address. To choose a new one, open this link:\n\n${v.link}\n\n` +
      `The link works once and expires soon. If you did not ask for this, you can ignore this email — your password has not changed.`,
  },

  "auth.backup_codes_low": {
    version: 1,
    subject: (v, t) => `You have ${v.remaining} backup codes left`,
    text: (v, t) =>
      `You have ${v.remaining} backup codes left for two-step sign-in.\n\n` +
      `Generate new codes from your account's security settings.\n\n` +
      `If you did not expect this, contact your practice.`,
  },

  "auth.two_step_changed": {
    version: 1,
    subject: (v, t) => `Two-step sign-in was changed on your account`,
    text: (v, t) =>
      `Two-step sign-in was ${v.what} on your account on ${v.when}.\n\n` +
      `If this wasn't you, contact your practice immediately.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 13.15 — THE EVENTS F05 PROMISES, FINALLY REACHING PEOPLE. Booked, moved, cancelled, and
  //     a freed slot offered. ★ they/them throughout — `app_user` has no reliable gender column.
  //   ★ No sentence states a charge, a refund or a policy consequence — those are Money's (Stage 15)
  //     and saying them here would be a promise this stage cannot keep.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  "booking.confirmed": {
    version: 2,
    subject: (v, t) => `${v.practiceName}: you're booked for ${v.whenLocal}`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You're booked — ${v.whenLocal} (${v.timeZone}), ${v.serviceName}.\n\n` +
      // ★ 6 Oct 2026 — team booking: the person the call is WITH, shown to the host only (notification.body, set by notifyBookedFrom for staff).
      (v.clientLine ? `${v.clientLine}\n\n` : "") +
      // ★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — same optional location line as booking.reminder.
      (v.locationLine ? `${v.locationLine}\n\n` : "") +
      `If you need to change it, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
  },
  "booking.moved": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your session moved to ${v.whenLocal}`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your session has moved to ${v.whenLocal} (${v.timeZone}):\n\n` +
      `  ${v.serviceName}\n\n` +
      `If this does not work for you, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
  },
  // ★ `whenLocal` is OPTIONAL here, unlike every other template above — see this template's
  //   `REQUIRED_VARS` row and src/queue/tasks.mjs's `emailFor` (booking.cancelled branch) for why:
  //   most real cancellations carry no time in the event that triggers this send.
  "booking.cancelled": {
    version: 1,
    subject: (v, t) => v.whenLocal
      ? `${v.practiceName}: your session on ${v.whenLocal} was cancelled`
      : `${v.practiceName}: your session was cancelled`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      (v.whenLocal
        ? `Your session on ${v.whenLocal} (${v.timeZone}) has been cancelled.\n\n`
        : `Your session (${v.serviceName}) has been cancelled.\n\n`) +
      (v.reasonLine ? `${v.reasonLine}\n\n` : "") +
      `Questions? Contact ${v.practiceName}.\n\n— ${v.practiceName}`,
  },
  // ★ Sent directly by `sendWaitlistOffer` (src/queue/tasks.mjs), never through `emailFor` — it needs
  //   `hostName`, which nothing on the `emailFor` delivery path can supply (that task's own header).
  "booking.waitlist_offer": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: a time just opened up`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A time has come up — ${v.whenLocal}, with ${v.hostName}.\n\n` +
      `  ${v.serviceName}\n\n` +
      (v.toldOthers ? `${v.toldOthers}\n\n` : "") +
      `Whoever takes it first gets it: ${v.link}\n\n— ${v.practiceName}`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ STAGE 15 TASK 15.37 — MONEY TEMPLATES (F720). Plain text, F08 voice.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  "money.invoice_reminder": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: invoice ${v.invoiceNumber} is due`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} is due ${v.dueLocal}.\n\n` +
      `View and pay it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ R12 (RECONCILE, the maintainer 27 Sep) — resendGiftCard (src/items/giftCards.mjs) sends this with { number, code }.
  //   Without it, every resend — and every gift-card sale with a holder email — threw "is not a template".
  "items.gift_card_resent": {
    version: 1,
    subject: (v, t) => `Your gift card code`,
    text: (v, t) =>
      `Here is the code for gift card ${v.number}:\n\n` +
      `${v.code}\n\n` +
      `Keep it somewhere safe — anyone with this code can spend the card. Any code sent before this one no longer works.`,
  },

  "money.receipt": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: payment received`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Thank you — ${v.amount} received for ${v.serviceName}` +
      (v.whenLocal ? ` on ${v.whenLocal}` : "") + `.\n\n` +
      (v.cardLine ? `Charged to ${v.cardLine}.\n\n` : "") +
      `View the receipt: ${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ NEW, 30 Sep 2026 ("credit-used email" brief) — `consumeCreditForBooking` (src/money/
  //   credits.mjs) announced nothing; nothing downstream could ever tell a client a credit was
  //   spent. `creditStanding` is optional and absent rather than zero, the same idiom
  //   "booking.reminder" already uses — a client whose package has no standing to report should
  //   never be told "0 remaining".
  "money.credit_used": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: a credit was used`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A credit was used for ${v.serviceName}.\n\n` +
      (v.creditStanding ? `${v.creditStanding}\n\n` : "") +
      `— ${v.practiceName}`,
  },

  // ★ NEW, 30 Sep 2026 ("credit-used email" brief) — the return-trip half: a cancelled session's
  //   credit came back. Deliberately its OWN email, not folded into the cancellation notice — the
  //   emitters' own comments explain why (src/booking/createBooking.mjs, src/booking/holds.mjs).
  "money.credit_returned": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: a credit came back`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your credit for ${v.serviceName} was returned — it's ready to use again.\n\n` +
      (v.creditStanding ? `${v.creditStanding}\n\n` : "") +
      `— ${v.practiceName}`,
  },

  "money.update_card": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: please update your card`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.practiceName} asked you to update the card on file. Update it here — neither ${v.practiceName} nor Workbench ever sees the number:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ NEW, 1 Oct 2026 (receipts brief, Part 1) — split from money.update_card, which used to run
  //   double duty for both "a charge failed" and "please update your card" (a staff-initiated
  //   request with no failure at all). the maintainer's own wording.
  "money.payment_failed": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your payment didn't go through`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your payment${v.amount ? ` of ${v.amount}` : ""} to ${v.practiceName} didn't go through.\n\n` +
      `Update your card here — neither ${v.practiceName} nor Workbench ever sees the number:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ NEW, 1 Oct 2026 (receipts brief, Part 2).
  "money.card_updated": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your card was updated`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your bank automatically updated ${v.cardLine} on file with ${v.practiceName}. No action is needed.\n\n` +
      `See it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  "money.card_removed": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: a card was removed`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A card on file with ${v.practiceName} was removed. If you didn't do this, let ${v.practiceName} know.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ NEW, 1 Oct 2026 (saved-card brief, Part 3) — the card-expiry sweep's client email.
  "money.card_expiring": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your card expires soon`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.cardLine} on file with ${v.practiceName} expires ${v.expMonth}/${v.expYear}. Update it before then to avoid a missed payment:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ NEW, 1 Oct 2026 (receipts brief, Part 2) — plan lifecycle, four states.
  "money.plan_started": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: ${v.planName} started`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} has started.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },
  "money.plan_cancelled": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: ${v.planName} cancelled`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} has been cancelled.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },
  "money.plan_paused": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: ${v.planName} paused`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} is paused` +
      (v.resumeOn ? `, resuming ${v.resumeOn}` : "") + `.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },
  "money.plan_resumed": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: ${v.planName} resumed`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} is active again.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  "money.refund_notice": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: refund on the way`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.amount} is on its way back to your card. It takes 5 to 10 days to land.\n\n` +
      `— ${v.practiceName}`,
  },

  "money.estimate": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: estimate`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `An estimate for ${v.amount} is ready for you.\n\n` +
      `View it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  "money.estimate_expiring": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: estimate expiring soon`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your estimate for ${v.amount} is expiring soon.\n\n` +
      `View it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ F720's three staff-facing money templates.
  "money.invoice_raised": {
    version: 1,
    subject: (v, t) => `Invoice ${v.invoiceNumber} for ${v.amount} is unpaid`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} is still unpaid. It was due ${v.dueLocal}.\n\n` +
      `— Workbench`,
  },

  "money.payout_failed": {
    version: 1,
    subject: (v, t) => `Payout failed`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A payout of ${v.amount} didn't reach your bank. Stripe says: ${v.reason}. Nothing is lost — it goes back to your Stripe balance and tries again once the bank details are right.\n\n` +
      `— Workbench`,
  },

  "money.dispute_opened": {
    version: 1,
    subject: (v, t) => `Payment dispute opened`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A customer has disputed ${v.amount}. You have until ${v.answerBy} to answer it.\n\n` +
      `— Workbench`,
  },

  // ── Stage 16 ──
  "growth.campaign": {
    version: 1,
    subject: (v, t) => v.subject,
    text: (v, t) =>
      `${v.body}\n\n` +
      `Unsubscribe with one click: ${v.unsubscribeUrl}`,
  },

  "automation.package_low": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your block is running low`,
    text: (v, t) => {
      const firstName = v.recipientName.split(" ")[0];
      const bodyText = v.body || (
        `Hello ${v.recipientName},\n\n` +
        (v.sessionsRemaining
          ? `You're down to ${v.sessionsRemaining} ${v.sessionsRemaining === 1 ? "session" : "sessions"} in your package. Let ${v.practiceName} know if you'd like to renew.`
          : `Your session package is running low. Let ${v.practiceName} know if you'd like to renew.`) +
        `\n\n— ${v.practiceName}`
      );
      return bodyText.replace(/{first name}/g, firstName);
    },
  },

  "automation.invoice_chase": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: payment due`,
    text: (v, t) => {
      const firstName = v.recipientName.split(" ")[0];
      const bodyText = v.body || (
        `Hello ${v.recipientName},\n\n` +
        (v.invoiceNumber && v.amount && v.daysPastDue
          ? `Invoice ${v.invoiceNumber} for ${v.amount} is waiting — it's been ${v.daysPastDue} days past due.`
          : `Payment for your invoice is due.`) +
        (v.link ? `\n\nPay it here: ${v.link}` : "") +
        `\n\n— ${v.practiceName}`
      );
      return bodyText.replace(/{first name}/g, firstName);
    },
  },

  "automation.review_ask": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: share your feedback`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${t("userType.member", "Team member")} at ${v.practiceName} would love to hear what you think about your sessions.\n\n` +
      `Share your feedback: ${v.reviewLink}\n\n` +
      `It takes about a minute, and your thoughts help shape how ${v.practiceName} works.\n\n` +
      `— ${v.practiceName}`,
  },

  // ★ [TY, 2 Oct 2026] "automation.win_back" ("we miss you") REMOVED ENTIRELY — see
  //   automations/sweeps.mjs's own header note on why.

  "reports.monthly_ready": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your monthly report is ready`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your monthly write-up${v.month ? ` for ${v.month}` : ""} is ready to review.\n\n` +
      (v.link ? `View it here: ${v.link}\n\n` : "") +
      `— Workbench`,
  },

  // ★ Stage 18 task 18.4 — operator access request. The Owner receives an email when an
  //   operator asks for temporary read-only access to the account. The `why` (free text,
  //   at 10–1000 characters) is carried on the notification row's `body` field.
  "support_access.requested": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: Workbench asked to look at your account`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Workbench support asked to look at ${v.practiceName}'s account, read only, for ${v.duration} minutes.\n\n` +
      `Why: ${v.why}\n\n` +
      `Nothing happens unless you say yes. Answer it in Settings → Team and roles → Support access.\n\n` +
      `Whatever you decide, the request stays in your activity log.\n\n` +
      `— Workbench`,
  },
});

/** ★ Every variable a template needs, so a missing one is caught before a person receives the gap. */
const REQUIRED_VARS = Object.freeze({
  ...DOCUMENT_TEMPLATE_REQUIRED_VARS,
  "booking.reminder":       ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  "money.invoice_issued":   ["practiceName", "recipientName", "invoiceNumber", "amount", "link"],
  "auth.invite":            ["practiceName", "inviterName", "acceptUrl", "expiresOn"],
  "auth.email_code":        ["code", "minutes"],
  "auth.password_reset":    ["link"],
  "auth.backup_codes_low":  ["remaining"],
  "auth.two_step_changed":  ["what", "when"],
  // ★ Task 13.15. `booking.cancelled` deliberately omits `whenLocal` — OPTIONAL there, not required
  //   (see that template's own comment and `emailFor`'s booking.cancelled branch in
  //   src/queue/tasks.mjs) — same "absent rather than blank" idiom `booking.reminder`'s
  //   `creditStanding` and `auth.invite`'s `personalLine` already use above.
  "booking.confirmed":      ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  "booking.moved":          ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  "booking.cancelled":      ["practiceName", "recipientName", "serviceName", "timeZone"],
  "booking.waitlist_offer": ["practiceName", "recipientName", "whenLocal", "serviceName", "hostName", "link"],
  // ★ Task 14.30. Both sign-link templates require the SAME five vars.
  // ★ Stage 15 task 15.37 — money email templates (F720).
  "money.invoice_reminder":      ["practiceName", "recipientName", "invoiceNumber", "amount", "dueLocal", "link"],
  "items.gift_card_resent":     ["number", "code"],
  "money.receipt":               ["practiceName", "recipientName", "amount", "serviceName", "whenLocal", "cardLine", "link"],
  // ★ NEW, 30 Sep 2026 — creditStanding is optional (absent, not zero, for someone with no package).
  "money.credit_used":           ["practiceName", "recipientName", "serviceName"],
  "money.credit_returned":       ["practiceName", "recipientName", "serviceName"],
  "money.update_card":           ["practiceName", "recipientName", "link"],
  "money.payment_failed":        ["practiceName", "recipientName", "amount", "link"],
  "money.card_updated":          ["practiceName", "recipientName", "cardLine", "link"],
  "money.card_removed":          ["practiceName", "recipientName", "link"],
  "money.card_expiring":         ["practiceName", "recipientName", "cardLine", "expMonth", "expYear", "link"],
  "money.plan_started":          ["practiceName", "recipientName", "planName", "link"],
  "money.plan_cancelled":        ["practiceName", "recipientName", "planName", "link"],
  "money.plan_paused":           ["practiceName", "recipientName", "planName", "resumeOn", "link"],
  "money.plan_resumed":          ["practiceName", "recipientName", "planName", "link"],
  "money.refund_notice":         ["practiceName", "recipientName", "amount"],
  "money.estimate":              ["practiceName", "recipientName", "amount", "link"],
  "money.estimate_expiring":     ["practiceName", "recipientName", "amount", "link"],
  // ★ F720's three staff-facing templates. F881 — each demanded "practiceName", which none of the
  //   three bodies read (they sign off as "— the platform", not the practice's own name); "dueLocal"
  //   is also unused by invoice_raised's real body. Dead in production today — all three are
  //   actually sent through the registry/Zod-schema path (resolve:{tx,tenantId}, which skips this
  //   array entirely — see src/queue/tasks.mjs's own comment at the shared money-template branch,
  //   "their own registry schemas don't reference these keys"), not the hardcoded path this array
  //   gates — but corrected anyway, the same REQUIRED_VARS-drift class as F880's accountant_pack,
  //   so a future caller on the hardcoded path is not blocked by a demand the template never needed.
  "money.invoice_raised":        ["recipientName", "invoiceNumber", "amount"],
  "money.payout_failed":         ["recipientName", "amount", "reason"],
  "money.dispute_opened":        ["recipientName", "amount", "answerBy"],
  // ── Stage 16 ──
  // ★ F881 — was ["practiceName", "recipientName", "subject", "body", "unsubscribeUrl"]; the real
  //   body (line ~491) reads only subject/body/unsubscribeUrl. Same dead-on-the-hardcoded-path
  //   reasoning as the three money templates above.
  "growth.campaign":             ["subject", "body", "unsubscribeUrl"],
  "automation.package_low":      ["practiceName", "recipientName"],
  "automation.invoice_chase":    ["practiceName", "recipientName"],
  "automation.review_ask":       ["practiceName", "recipientName", "reviewLink"],
  "reports.monthly_ready":       ["practiceName", "recipientName"],
  // ★ Stage 18 task 18.4 — operator access request.
  "support_access.requested":    ["practiceName", "recipientName", "why", "duration"],
});

/**
 * ★★★ RENDER. Returns `{ subject, text, terms, template, template_version }` — exactly the shape
 *     migration 0042's CHECK requires on a `sent` row.
 *
 * ★★ IT REFUSES A MISSING VARIABLE RATHER THAN INTERPOLATING `undefined`. [The failure it prevents is
 *    concrete: `your undefined is ready to sign` is a real subject line that a real person reads, and
 *    U30's rule — nothing renders blank — applies with more force to something that leaves the building.]
 *
 * ★ TENANT OVERRIDE PATH (F17): when `{tx, tenantId}` is passed, resolveTemplate is called first
 *   to pick an active tenant override else a shipped default; the resolution happens at render time,
 *   so every send carries the template _version_ that produced it (immutable; a later activate
 *   of a different version on that tenant leaves the sent record frozen). Existing callers with
 *   no resolve param behave bit-for-bit as they do today — using the hardcoded TEMPLATES — and
 *   keep that behaviour until task 20.42 wires a resolve param into the path.
 */
export async function renderTemplate(templateKey, vars = {}, terms = {}, resolve = {}) {
  const { tx, tenantId } = resolve;

  let tpl;
  if (tx && tenantId) {
    // ★ RESOLVE: active tenant override or shipped default. Imports resolveTemplate from
    //   src/email/resolveTemplate.mjs, which lives at the bottom of this module to stay under
    //   the import horizon (it imports nothing from here).
    const { resolveTemplate } = await import("./resolveTemplate.mjs");
    tpl = await resolveTemplate(tx, tenantId, templateKey);
    // ★ PART 2 (worker-failures brief) — THIS PATH'S REQUIRED-VARIABLE GUARANTEE NOW COMES FROM
    //   THE REGISTRY'S OWN ZOD SCHEMA (src/email/registry.mjs, enforced inside
    //   `renderLiquidSide` the moment `tpl.subject(...)`/`tpl.text(...)` below are called) — NOT
    //   from `REQUIRED_VARS` here, which is skipped for this path. FOUND LIVE building this same
    //   registry: `REQUIRED_VARS` demanded `practiceName` for `money.invoice_raised`/
    //   `payout_failed`/`dispute_opened` and `recipientName`+`body` for `growth.campaign` — fields
    //   the REAL template bodies (both DEFAULT_TEMPLATES and the registry generated from them)
    //   never reference — a stale, hand-maintained list independently drifted from either real
    //   copy of the content it was supposed to describe, exactly the "two places decide what a
    //   template needs" shape the maintainer's brief asked to remove. `REQUIRED_VARS` still applies below for
    //   the HARDCODED path (auth.*, items.gift_card_resent) — those have no Zod schema yet.
  } else {
    // ★ HARDCODED PATH: existing behaviour, bit-for-bit. No tx/tenantId → use TEMPLATES above.
    tpl = TEMPLATES[templateKey];
    if (!tpl) {
      throw new Error(
        `"${templateKey}" is not a template. The ${Object.keys(TEMPLATES).length} are: ` +
        `${Object.keys(TEMPLATES).join(", ")}`);
    }

    const missing = (REQUIRED_VARS[templateKey] ?? []).filter(
      (k) => vars[k] === undefined || vars[k] === null || String(vars[k]).trim() === "");
    if (missing.length) {
      throw new Error(
        `template "${templateKey}" is missing ${missing.join(", ")}. Rendering anyway would send ` +
        `"undefined" to a person, which they cannot act on and nobody can un-send.`);
    }
  }

  const { t, used } = makeRecordingResolver(terms);
  const subject = tpl.subject(vars, t);
  const text = tpl.text(vars, t);

  // ★ A blank subject or body is refused even if every variable was present — a template could always
  //   be edited into emptiness, and this is the last place to notice.
  if (!subject.trim() || !text.trim()) {
    throw new Error(`template "${templateKey}" rendered an empty subject or body`);
  }
  return {
    subject, text,
    terms: used(),                 // ★ FROZEN: what terminology resolved to at this moment
    template: templateKey,
    template_version: tpl.version,
  };
}
