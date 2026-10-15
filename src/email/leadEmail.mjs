// @ts-check
// lead-intake brief, 30 Sep 2026 — THE TWO LEAD-FORM EMAILS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ MIRRORS `clientInviteEmail.mjs`'s OWN PATTERN, NOT REUSED BY IMPORT (same reason that file
//     gives for not reusing `authEmail.mjs`): sent directly through Resend, never through
//     `sendNotificationEmail` (src/email/send.mjs) — that function requires a `notificationId` FK
//     onto an EXISTING `keystone.notification` row and renders PLAIN TEXT ONLY [MEASURED — its
//     `resendRequestBody` call passes no `html` field at all, for every template that goes through
//     it today]. Neither fits here: a public lead has no notification to hang off, and the maintainer's ask
//     ("the branded frame the signing email uses") needs real HTML.
//
// ★★ THE ONE DELIBERATE DIFFERENCE FROM `clientInviteEmail.mjs`: the resolved text is ALSO wrapped
//    in the shared branded frame (`brandedFrame.mjs`) for the HTML part, so the send is BOTH
//    tenant-editable (Run → Templates, via `resolveTemplate`) AND branded — `clientInviteEmail.mjs`
//    only does the first half of that because credential mail has no need of the second.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { resolveTemplate } from "./resolveTemplate.mjs";
import { makeTermResolver } from "./templates.mjs";
import { deliverAsOrganisation } from "./deliver.mjs";
import { renderBrandedEmail } from "./brandedFrame.mjs";

async function sendOne({ tx, tenantId, to, practiceName, logoUrl, heading, ctaLabel, ctaHref, templateKey, vars }, { fetchImpl, env = process.env } = {}) {
  const tpl = await resolveTemplate(tx, tenantId, templateKey);
  const t = makeTermResolver({});
  const subject = tpl.subject(vars, t);
  const bodyText = tpl.text(vars, t);

  const { html, text } = await renderBrandedEmail({
    practiceName, logoUrl, heading, bodyText, ctaLabel, ctaHref, preview: subject,
  });
  const out = await deliverAsOrganisation(tx, { tenantId, to, subject, text, html }, { fetchImpl, env });
  if (out.status === "skipped") console.warn(`sendLeadEmail: "${templateKey}" not sent — ${out.error}`);
  return { status: out.status === "limit_reached" ? "skipped" : out.status, providerMessageId: out.providerMessageId, error: out.error };
}

/**
 * THE PERSON'S THANK-YOU — sent to whoever just submitted the public lead form.
 * @param {object} opts.vars {practiceName, recipientName, interestName, bestTimeLabel, supportPhone, supportEmail}
 */
export function sendLeadThanksEmail({ tx, tenantId, to, practiceName, logoUrl = null, vars }, deps = {}) {
  return sendOne({
    tx, tenantId, to, practiceName, logoUrl,
    heading: "Thanks for reaching out",
    templateKey: "growth.lead_thanks", vars,
  }, deps);
}

/**
 * THE PRACTICE'S NOTIFICATION — sent to the practice's own notification address.
 * @param {object} opts.vars {leadName, leadEmail, leadPhone, interestName, bestTimeLabel, leadNote, link}
 */
export function sendLeadNotifyPracticeEmail({ tx, tenantId, to, practiceName, logoUrl = null, vars }, deps = {}) {
  return sendOne({
    tx, tenantId, to, practiceName, logoUrl,
    heading: `New lead: ${vars.leadName}`,
    ctaLabel: "View record", ctaHref: vars.link,
    templateKey: "growth.lead_notify_practice", vars,
  }, deps);
}
