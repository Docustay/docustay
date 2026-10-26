// the maintainer, 29 Sep 2026 — THE CLIENT PORTAL INVITE SENDER.
//
// ★★★ MIRRORS `sendAuthEmail`/`sendSignLinkEmail` (src/email/authEmail.mjs, documentLinkEmail.mjs)
//     BODY, NOT REUSED BY IMPORT — same reason both of those give for themselves: this is credential
//     mail (it carries a one-use sign-in link), so it goes through Resend directly, never through
//     `sendNotificationEmail` (no `notificationId` to hang a delivery row off, and none should exist
//     — a durable "this address got a sign-in link" row is the login-history leak those two senders
//     already avoid).
//
// ★★ THE ONE DELIBERATE DIFFERENCE FROM THOSE TWO: renders through `resolveTemplate(tx, tenantId,
//    key)`, not the hardcoded `renderTemplate`. the maintainer's ruling: "Put the invite email in Run →
//    Templates as its own client-worded template, editable like the rest." `resolveTemplate` is the
//    SAME resolver Growth Templates / campaign sends already use — a tenant's active
//    `keystone.email_template` override wins, the shipped default in `defaultTemplates/index.mjs`
//    otherwise. Nothing about WHO the transport is (Resend, platform address) changes — only the
//    WORDING becomes tenant-editable.
//
// ★★★ THE SENDING ADDRESS DELIBERATELY STAYS THE PLATFORM ONE, WITH THE PRACTICE'S NAME. `sendAs`-
//     routable addresses (`keystone.sender_routing`) are a connected mailbox with a revocable OAuth
//     grant, and `src/email/writes.mjs`'s `setSenderRouting` refuses `purpose: "auth"` BY NAME: *"a
//     sign-in link is a credential; if the mailbox breaks... NOBODY CAN GET IN TO FIX IT."* Routing
//     THIS sender through that same mechanism would reopen exactly the hole that ruling closed —
//     recorded as a question for the maintainer rather than silently built or silently skipped (see the stage
//     report). Until he answers, every practice reads "from the platform in the practice's name",
//     which is the half of his ask this can satisfy safely today — [MEASURED, emailDomainHealth.mjs
//     header] no real practice has a verified sending route yet regardless.
import { resolveTemplate } from "./resolveTemplate.mjs";
import { makeTermResolver } from "./templates.mjs";
import { deliverAsOrganisation } from "./deliver.mjs";

const CLIENT_INVITE_TEMPLATE_KEY = "auth.client_invite";
const CLIENT_PORTAL_LINK_TEMPLATE_KEY = "auth.client_portal_link";

async function sendOne({ tx, tenantId, to, displayName, templateKey, vars }, { fetchImpl, env = process.env } = {}) {
  if (typeof templateKey !== "string" || !templateKey.startsWith("auth.client_")) {
    throw new Error(
      `sendClientInviteEmail: "${templateKey}" is not a client-portal template. This sender only ` +
      `sends "auth.client_*" templates.`);
  }

  const tpl = await resolveTemplate(tx, tenantId, templateKey);
  const t = makeTermResolver({});
  const subject = tpl.subject(vars, t);
  const text = tpl.text(vars, t);

  const out = await deliverAsOrganisation(tx, { tenantId, to, subject, text, purpose: "auth" }, { fetchImpl, env });
  if (out.status === "skipped") console.warn(`sendClientInviteEmail: "${templateKey}" not sent — ${out.error}`);
  return { status: out.status === "limit_reached" ? "skipped" : out.status, providerMessageId: out.providerMessageId, error: out.error };
}

/**
 * THE INVITE — a one-use, 30-day link that opens straight to "set your password".
 * @param {object} opts
 * @param {object} opts.tx  the withTenant handle (resolveTemplate needs `.query`)
 * @param {string} opts.tenantId
 * @param {string} opts.to
 * @param {string} opts.displayName  the practice's name, for the From header
 * @param {object} opts.vars  { practiceName, acceptUrl, expiresOn, personalLine }
 */
export function sendClientInviteEmail({ tx, tenantId, to, displayName, vars }, deps = {}) {
  return sendOne({ tx, tenantId, to, displayName, templateKey: CLIENT_INVITE_TEMPLATE_KEY, vars }, deps);
}

/**
 * THE PORTAL LINK — for somebody who has already signed in before. No token, no expiry: just where
 * to go. ★ Deliberately NOT a Growth Template (the maintainer's ask names only the invite email) — the copy is
 * one sentence and carries no credential of its own; the portal itself still requires their
 * password.
 * @param {object} opts.vars  { practiceName, portalUrl }
 */
export function sendClientPortalLinkEmail({ tx, tenantId, to, displayName, vars }, deps = {}) {
  return sendOne({ tx, tenantId, to, displayName, templateKey: CLIENT_PORTAL_LINK_TEMPLATE_KEY, vars }, deps);
}
