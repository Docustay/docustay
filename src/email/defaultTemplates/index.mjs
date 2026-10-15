/**
 * ★★★ SHIPPED EMAIL TEMPLATES — EXTRACTED AS DATA, CONTENT UNCHANGED (F17 §5)
 *
 * Each template is a shipped default, keyed by `key`, with its family, subject line (literal),
 * HTML body, and plain text body. Terminology tokens (`{userType.coach}`) in subjects/bodies
 * are resolved at render time by `renderTemplate` — the resolver applies them, and the sent
 * delivery row freezes what they resolved to.
 *
 * ★ EXTRACTION FIDELITY IS THE WHOLE POINT: these 30 bodies move from code (templates.mjs) to
 *   data with content unchanged — same subject strings byte-for-byte, same HTML, same text,
 *   same variable names. Do not reword, do not reformat, do not "improve" a single string.
 *
 * ★ PER-COACHING_TYPE VARIANTS: when a template's wording differs by coaching_type (coaching /
 *   studio / clinic), the `variants` field carries a map { coaching_type: template }. The
 *   resolver picks the variant at render time if one exists for the tenant's type.
 */

import { DOCUMENT_DEFAULT_TEMPLATES } from "../../documents/emailTemplates.mjs";

export const DEFAULT_TEMPLATES = [
  ...DOCUMENT_DEFAULT_TEMPLATES,   // the Documents island's own wordings

  // ═════════════════════════════════════════════════════════════════════════════
  // ★ A session reminder. ★★ IT NAMES THE TIME ZONE.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "booking.reminder",
    family: "bookings",
    subject: (v, t) => `${v.practiceName}: your session on ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `This is a reminder of your session with your ${t("userType.member", "Team member")}:\n\n` +
      `  ${v.serviceName}\n  ${v.whenLocal} (${v.timeZone})\n\n` +
      (v.creditStanding ? `${v.creditStanding}\n\n` : "") +
      // ★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — kept byte-identical to templates.mjs's own copy
      //   (this file's own header rule). See that file for the reasoning.
      (v.locationLine ? `${v.locationLine}\n\n` : "") +
      `If you need to change it, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone", `userType.coach`],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★ An invoice. ★★ THE AMOUNT IS PASSED ALREADY FORMATTED.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "money.invoice_issued",
    family: "money",
    subject: (v, t) => `${v.practiceName}: invoice ${v.invoiceNumber} for ${v.amount}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} is now available${v.dueLocal ? `, due ${v.dueLocal}` : ""}.\n\n` +
      `View it here: ${v.link}\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "invoiceNumber", "amount", "link"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 8.10 — SIGN-IN MAIL. Sent by src/email/authEmail.mjs, never sendNotificationEmail.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "auth.invite",
    family: "auth",
    subject: (v, t) => `${v.practiceName} invited you to join`,
    html_body: "",
    text_body: (v, t) =>
      `Hello,\n\n` +
      `${v.inviterName} has invited you to join ${v.practiceName} on Workbench.\n\n` +
      (v.personalLine ? `${v.personalLine}\n\n` : "") +
      `Accept the invitation here: ${v.acceptUrl}\n\n` +
      `This invitation expires on ${v.expiresOn}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "inviterName", "acceptUrl", "expiresOn"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer, 29 Sep 2026 — THE CLIENT PORTAL INVITE. `auth.invite` above is STAFF-worded ("has
  //     invited you to join {practice} on the platform" — a colleague joining a team); this is its own
  //     key because a client or a parent reads a different message ("your coach" and "book,
  //     message and pay", not "join the team"). Sent by src/email/clientInviteEmail.mjs, never
  //     sendNotificationEmail — see that file's header for why.
  // ★★ `required: ["acceptUrl"]` — the maintainer: "with the sign-in link required so it can't be deleted."
  //    `growthTemplates.mjs`'s `createTemplateVersion` refuses to save a version whose body has
  //    dropped a key in this list. No other shipped template declares one; this is the first
  //    template where a missing placeholder makes the email a dead end; not a default the editor
  //    is unhelpful without.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "auth.client_invite",
    family: "auth",
    subject: (v, t) => `${v.practiceName} invited you to their client portal`,
    html_body: "",
    text_body: (v, t) =>
      `Hello,\n\n` +
      `${v.practiceName} has invited you to their client portal, where you can book, pay and message ` +
      `your ${t("userType.member", "Team member")}.\n\n` +
      (v.personalLine ? `${v.personalLine}\n\n` : "") +
      `Set up your account here: ${v.acceptUrl}\n\n` +
      `This link works once and expires on ${v.expiresOn}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "acceptUrl", "expiresOn", "personalLine", "userType.member"],
    required: ["acceptUrl"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★ the maintainer, 29 Sep 2026 — for somebody who already has a portal login. No token, no expiry: it is a
  //   reminder of where to sign in, not a credential of its own — see
  //   src/email/clientInviteEmail.mjs's header for why this one stays out of the "editable" ask.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "auth.client_portal_link",
    family: "auth",
    subject: (v, t) => `Sign in to ${v.practiceName}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello,\n\n` +
      `Here's where to sign in to your ${v.practiceName} client portal:\n\n` +
      `${v.portalUrl}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "portalUrl"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★★★ THE CODE AND NOTHING ELSE.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "auth.email_code",
    family: "auth",
    subject: (v, t) => `Your Workbench sign-in code`,
    html_body: "",
    text_body: (v, t) =>
      `Your sign-in code is ${v.code}. It expires in ${v.minutes} minutes.\n\n` +
      `If you did not request this code, you can ignore this email.`,
    variables: ["code", "minutes"],
  },

  {
    key: "auth.backup_codes_low",
    family: "auth",
    subject: (v, t) => `You have ${v.remaining} backup codes left`,
    html_body: "",
    text_body: (v, t) =>
      `You have ${v.remaining} backup codes left for two-step sign-in.\n\n` +
      `Generate new codes from your account's security settings.\n\n` +
      `If you did not expect this, contact your practice.`,
    variables: ["remaining"],
  },

  {
    key: "auth.two_step_changed",
    family: "auth",
    subject: (v, t) => `Two-step sign-in was changed on your account`,
    html_body: "",
    text_body: (v, t) =>
      `Two-step sign-in was ${v.what} on your account on ${v.when}.\n\n` +
      `If this wasn't you, contact your practice immediately.`,
    variables: ["what", "when"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 13.15 — THE EVENTS F05 PROMISES, FINALLY REACHING PEOPLE.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "booking.confirmed",
    family: "bookings",
    subject: (v, t) => `${v.practiceName}: you're booked for ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `You're booked — ${v.whenLocal} (${v.timeZone}), ${v.serviceName}.\n\n` +
      // ★ 6 Oct 2026 — team booking: the person the call is WITH, shown to the host only (notification.body, set by notifyBookedFrom for staff).
      (v.clientLine ? `${v.clientLine}\n\n` : "") +
      // ★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — kept byte-identical to templates.mjs's own copy.
      (v.locationLine ? `${v.locationLine}\n\n` : "") +
      `If you need to change it, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.moved",
    family: "bookings",
    subject: (v, t) => `${v.practiceName}: your session moved to ${v.whenLocal}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your session has moved to ${v.whenLocal} (${v.timeZone}):\n\n` +
      `  ${v.serviceName}\n\n` +
      `If this does not work for you, contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "whenLocal", "timeZone"],
  },

  {
    key: "booking.cancelled",
    family: "bookings",
    subject: (v, t) => v.whenLocal
      ? `${v.practiceName}: your session on ${v.whenLocal} was cancelled`
      : `${v.practiceName}: your session was cancelled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      (v.whenLocal
        ? `Your session on ${v.whenLocal} (${v.timeZone}) has been cancelled.\n\n`
        : `Your session (${v.serviceName}) has been cancelled.\n\n`) +
      (v.reasonLine ? `${v.reasonLine}\n\n` : "") +
      `Questions? Contact ${v.practiceName}.\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName", "timeZone"],
  },

  {
    key: "booking.waitlist_offer",
    family: "bookings",
    subject: (v, t) => `${v.practiceName}: a time just opened up`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A time has come up — ${v.whenLocal}, with ${v.hostName}.\n\n` +
      `  ${v.serviceName}\n\n` +
      (v.toldOthers ? `${v.toldOthers}\n\n` : "") +
      `Whoever takes it first gets it: ${v.link}\n\n— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "whenLocal", "serviceName", "hostName", "link"],
  },



  // ═════════════════════════════════════════════════════════════════════════════
  // ★★★ STAGE 15 TASK 15.37 — MONEY TEMPLATES (F720).
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "money.invoice_reminder",
    family: "money",
    subject: (v, t) => `${v.practiceName}: invoice ${v.invoiceNumber} is due`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} is due ${v.dueLocal}.\n\n` +
      `View and pay it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "invoiceNumber", "amount", "dueLocal", "link"],
  },

  {
    key: "money.receipt",
    family: "money",
    subject: (v, t) => `${v.practiceName}: payment received`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Thank you — ${v.amount} received for ${v.serviceName}` +
      (v.whenLocal ? ` on ${v.whenLocal}` : "") + `.\n\n` +
      (v.cardLine ? `Charged to ${v.cardLine}.\n\n` : "") +
      `View the receipt: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "serviceName", "whenLocal", "cardLine", "link"],
  },

  // ★ NEW, 30 Sep 2026 ("credit-used email" brief) — byte-identical to templates.mjs's own copy,
  //   per this file's own rule that the two registries never disagree.
  {
    key: "money.credit_used",
    family: "money",
    subject: (v, t) => `${v.practiceName}: a credit was used`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A credit was used for ${v.serviceName}.\n\n` +
      (v.creditStanding ? `${v.creditStanding}\n\n` : "") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName"],
  },

  {
    key: "money.credit_returned",
    family: "money",
    subject: (v, t) => `${v.practiceName}: a credit came back`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your credit for ${v.serviceName} was returned — it's ready to use again.\n\n` +
      (v.creditStanding ? `${v.creditStanding}\n\n` : "") +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "serviceName"],
  },

  {
    key: "money.update_card",
    family: "money",
    subject: (v, t) => `${v.practiceName}: please update your card`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.practiceName} asked you to update the card on file. Update it here — neither ${v.practiceName} nor Workbench ever sees the number:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  // ★ NEW, 1 Oct 2026 (receipts brief, Part 1) — see templates.mjs's own note on the split.
  {
    key: "money.payment_failed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: your payment didn't go through`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your payment${v.amount ? ` of ${v.amount}` : ""} to ${v.practiceName} didn't go through.\n\n` +
      `Update your card here — neither ${v.practiceName} nor Workbench ever sees the number:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "link"],
  },

  // ★ NEW, 1 Oct 2026 (receipts brief, Part 2).
  {
    key: "money.card_updated",
    family: "money",
    subject: (v, t) => `${v.practiceName}: your card was updated`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your bank automatically updated ${v.cardLine} on file with ${v.practiceName}. No action is needed.\n\n` +
      `See it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "cardLine", "link"],
  },

  {
    key: "money.card_removed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: a card was removed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A card on file with ${v.practiceName} was removed. If you didn't do this, let ${v.practiceName} know.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "link"],
  },

  // ★ NEW, 1 Oct 2026 (saved-card brief, Part 3).
  {
    key: "money.card_expiring",
    family: "money",
    subject: (v, t) => `${v.practiceName}: your card expires soon`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.cardLine} on file with ${v.practiceName} expires ${v.expMonth}/${v.expYear}. Update it before then to avoid a missed payment:\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "cardLine", "expMonth", "expYear", "link"],
  },

  // ★ NEW, 1 Oct 2026 (receipts brief, Part 2) — plan lifecycle, four states.
  {
    key: "money.plan_started",
    family: "money",
    subject: (v, t) => `${v.practiceName}: ${v.planName} started`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} has started.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "planName", "link"],
  },
  {
    key: "money.plan_cancelled",
    family: "money",
    subject: (v, t) => `${v.practiceName}: ${v.planName} cancelled`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} has been cancelled.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "planName", "link"],
  },
  {
    key: "money.plan_paused",
    family: "money",
    subject: (v, t) => `${v.practiceName}: ${v.planName} paused`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} is paused` +
      (v.resumeOn ? `, resuming ${v.resumeOn}` : "") + `.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "planName", "resumeOn", "link"],
  },
  {
    key: "money.plan_resumed",
    family: "money",
    subject: (v, t) => `${v.practiceName}: ${v.planName} resumed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${v.planName} plan with ${v.practiceName} is active again.\n\n` +
      `${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "planName", "link"],
  },

  {
    key: "money.refund_notice",
    family: "money",
    subject: (v, t) => `${v.practiceName}: refund on the way`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.amount} is on its way back to your card. It takes 5 to 10 days to land.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount"],
  },

  {
    key: "money.estimate",
    family: "money",
    subject: (v, t) => `${v.practiceName}: estimate`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `An estimate for ${v.amount} is ready for you.\n\n` +
      `View it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "link"],
  },

  {
    key: "money.estimate_expiring",
    family: "money",
    subject: (v, t) => `${v.practiceName}: estimate expiring soon`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your estimate for ${v.amount} is expiring soon.\n\n` +
      `View it here: ${v.link}\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "amount", "link"],
  },

  // ★ F720's three staff-facing money templates.
  {
    key: "money.invoice_raised",
    family: "money",
    subject: (v, t) => `Invoice ${v.invoiceNumber} for ${v.amount} is unpaid`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Invoice ${v.invoiceNumber} for ${v.amount} is still unpaid. It was due ${v.dueLocal}.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "invoiceNumber", "amount", "dueLocal"],
  },

  {
    key: "money.payout_failed",
    family: "money",
    subject: (v, t) => `Payout failed`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A payout of ${v.amount} didn't reach your bank. Stripe says: ${v.reason}. Nothing is lost — it goes back to your Stripe balance and tries again once the bank details are right.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "amount", "reason"],
  },

  {
    key: "money.dispute_opened",
    family: "money",
    subject: (v, t) => `Payment dispute opened`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `A customer has disputed ${v.amount}. You have until ${v.answerBy} to answer it.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "amount", "answerBy"],
  },

  // ── Stage 16 ──
  {
    key: "growth.campaign",
    family: "growth",
    subject: (v, t) => v.subject,
    html_body: "",
    text_body: (v, t) =>
      `${v.body}\n\n` +
      `Unsubscribe with one click: ${v.unsubscribeUrl}`,
    variables: ["practiceName", "recipientName", "subject", "body", "unsubscribeUrl"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★ lead-intake brief, 30 Sep 2026 — the two new lead-form emails. Sent by
  //   src/email/leadEmail.mjs, which resolves the TEXT through this tenant-editable path (same
  //   `resolveTemplate` `clientInviteEmail.mjs` already uses) and then wraps it in the shared
  //   branded frame (src/email/brandedFrame.mjs) for the HTML part — "editable like the rest" AND
  //   "the branded frame the signing email uses" are both real for these two, not a contradiction
  //   resolved by picking one.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "growth.lead_thanks",
    family: "growth",
    subject: (v, t) => `${v.practiceName}: thanks for reaching out`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Thanks for reaching out to ${v.practiceName}${v.interestName ? ` about ${v.interestName}` : ""}. ` +
      (v.bestTimeLabel
        ? `We'll call you around ${v.bestTimeLabel}.\n\n`
        : `We'll be in touch soon.\n\n`) +
      `If you'd rather reach us first, call or text ${v.supportPhone} or email ${v.supportEmail}.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "interestName", "bestTimeLabel", "supportPhone", "supportEmail"],
  },
  {
    key: "growth.lead_notify_practice",
    family: "growth",
    subject: (v, t) => `New lead: ${v.leadName} — ${v.interestName}`,
    html_body: "",
    text_body: (v, t) =>
      `A new lead came in from the website.\n\n` +
      `  Name:      ${v.leadName}\n` +
      `  Email:     ${v.leadEmail}\n` +
      `  Phone:     ${v.leadPhone}\n` +
      `  Interested in: ${v.interestName}\n` +
      `  Best time to call: ${v.bestTimeLabel}\n` +
      (v.leadNote ? `  Note: ${v.leadNote}\n` : "") +
      `\nView the record: ${v.link}\n\n— Workbench`,
    variables: ["leadName", "leadEmail", "leadPhone", "interestName", "bestTimeLabel", "leadNote", "link"],
  },

  {
    key: "automation.package_low",
    family: "automations",
    subject: (v, t) => `${v.practiceName}: your block is running low`,
    html_body: "",
    text_body: (v, t) => {
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
    variables: ["practiceName", "recipientName"],
  },

  // ═════════════════════════════════════════════════════════════════════════════
  // ★ "automation.win_back" was fixed to exist here on 30 Sep 2026 (the win-back sweep had been
  //   calling a never-registered "growth.win_back" key) — but a second, pre-existing entry with the
  //   SAME key already lived further down this file (now below, "we miss you"), with first-name
  //   personalization and a booking link the 30 Sep fix's version lacked. `resolveTemplate.mjs`'s
  //   lookup is `DEFAULT_TEMPLATES.find(t => t.key === key)` — first match wins — so THAT simpler
  //   duplicate, not this richer one, was the one actually sending. FOUND and removed, Part 2
  //   (worker-failures brief), 1 Oct 2026: the duplicate is gone; the richer entry below is now the
  //   one and only "automation.win_back", exactly as it should always have been.
  // ═════════════════════════════════════════════════════════════════════════════

  {
    key: "automation.invoice_chase",
    family: "automations",
    subject: (v, t) => `${v.practiceName}: payment due`,
    html_body: "",
    text_body: (v, t) => {
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
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "automation.review_ask",
    family: "automations",
    subject: (v, t) => `${v.practiceName}: share your feedback`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${t("userType.member", "Team member")} at ${v.practiceName} would love to hear what you think about your sessions.\n\n` +
      `Share your feedback: ${v.reviewLink}\n\n` +
      `It takes about a minute, and your thoughts help shape how ${v.practiceName} works.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "reviewLink", `userType.coach`],
  },

  {
    key: "automation.win_back",
    family: "automations",
    subject: (v, t) => `${v.practiceName}: we miss you`,
    html_body: "",
    text_body: (v, t) => {
      const firstName = v.recipientName.split(" ")[0];
      const bodyText = v.body || (
        `Hello ${v.recipientName},\n\n` +
        `It's been a while since your last session at ${v.practiceName}. We'd love to help you get back on track.` +
        (v.link ? `\n\nBook your next appointment: ${v.link}` : "") +
        `\n\n— ${v.practiceName}`
      );
      return bodyText.replace(/{first name}/g, firstName);
    },
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "reports.monthly_ready",
    family: "reports",
    subject: (v, t) => `${v.practiceName}: your monthly report is ready`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your monthly write-up${v.month ? ` for ${v.month}` : ""} is ready to review.\n\n` +
      (v.link ? `View it here: ${v.link}\n\n` : "") +
      `— Workbench`,
    variables: ["practiceName", "recipientName"],
  },

  // ★ Stage 18 task 18.4 — operator access request.
  {
    key: "support_access.requested",
    family: "support",
    subject: (v, t) => `${v.practiceName}: Workbench asked to look at your account`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Workbench support asked to look at ${v.practiceName}'s account, read only, for ${v.duration} minutes.\n\n` +
      `Why: ${v.why}\n\n` +
      `Nothing happens unless you say yes. Answer it in Settings → Team and roles → Support access.\n\n` +
      `Whatever you decide, the request stays in your activity log.\n\n` +
      `— Workbench`,
    variables: ["practiceName", "recipientName", "why", "duration"],
  },



  {
    key: "money.credit_note_issued",
    family: "money",
    subject: (v, t) => `${v.practiceName}: a credit note was issued`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.practiceName} issued you a credit note. It reduces what you owe, or adds credit to your ` +
      `account, on the same terms as the original invoice.\n\n` +
      `You can see the details in your account.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName"],
  },

  {
    key: "money.package_purchased",
    family: "money",
    subject: (v, t) => `${v.practiceName}: thanks for your purchase`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.summary} — it's ready to use. Book your sessions whenever you're ready.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "summary"],
  },
];
