// @ts-check
// P18.2 — ★★★ THE SEND PATH. EVERY OUTCOME IS RECORDED. SILENCE IS NEVER THE RECORD.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE ITEM'S RED-FIRST, AND IT IS THE WHOLE DESIGN: *"make the provider return 500. PROVES RED WHEN:
//     a delivery row records the failure. ★ A send failure must be RECORDED, never inferred from
//     silence."*
//
// ★★ SO THE ROW IS WRITTEN **BEFORE** THE REQUEST LEAVES, AND IN ITS OWN TRANSACTION.
//    Three orderings were possible and only one is correct:
//      · record AFTER the request — a process that dies mid-send leaves NO trace, and the message may
//        or may not have gone. That is the "inferred from silence" case, exactly.
//      · record in the SAME transaction as the request — impossible: an HTTP call is not transactional,
//        and holding a database transaction open across a network round trip pins a pooled connection
//        for the provider's latency (P18.2's provider timeout is 15s; the pool is 10 connections).
//      · record `attempted` first, COMMIT, send, then record the outcome. ★ A crash between the two
//        leaves an `attempted` row — which reads as "we tried and do not know", and that is the TRUTH.
//    ★★★ "WE DO NOT KNOW" IS A LEGITIMATE STATE AND MUST BE REPRESENTABLE. The failure this project
//        keeps meeting is a system that cannot distinguish "nothing happened" from "we lost track".
//
// ★ NOTE THE ASYMMETRY WITH U26, AND WHY IT IS NOT A CONTRADICTION. U26 requires an outbox event in the
//   SAME transaction as its state change, because both are OUR writes. A provider call is not our write
//   and cannot join our transaction; the outbox is how the two are bridged.

import { emailChromeFor } from "./emailChrome.mjs";
import { renderTemplate } from "./templates.mjs";
import { sendViaResend, emailIsConfigured, EmailConfigError, resendRequestBody } from "./resend.mjs";
import { redirectForEnvironment } from "./redirect.mjs";
import { renderNotificationEmail } from "./notificationEmail.mjs";
import { withTenant } from "../db/index.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { publicLogoUrl, practiceOrigin } from "../branding/publicLogo.mjs";
import * as mail from "../mail/index.mjs";

/** ★ The product's default sender address (mail module: KEYSTONE_MAIL_SENDER, the old KEYSTONE_EMAIL_FROM still read). Not defaulted — an invented from-address fails silently at the provider. */
export function sendingAddress(env = process.env) {
  try { return mail.productSender(env).address; }
  catch (e) { throw new EmailConfigError(e.message); }
}


/**
 * ★★★ SEND ONE NOTIFICATION BY EMAIL, AND RECORD WHAT HAPPENED.
 *
 * @param {object}  opts
 * @param {string}  opts.tenantId
 * @param {string}  opts.notificationId   the notification this delivery belongs to (FK, NOT NULL)
 * @param {string}  opts.to
 * @param {string}  opts.templateKey
 * @param {object}  opts.vars
 * @param {object}  opts.terms            the tenant's terminology — `{}` today; see templates.mjs
 * @param {Array<{filename:string, content:Buffer}>|null} opts.attachments
 *   ★ NEW, Part 3 invoice rebuild — Resend's own API already accepted `{filename, content:
 *   base64}` (src/email/resend.mjs's `resendRequestBody`/`sendViaResend`, unchanged); nothing
 *   above this function ever threaded anything into it. Callers pass a raw `Buffer` here; it is
 *   base64-encoded once, right before building the request body.
 * @returns {Promise<{status: string, deliveryId: string|null, providerMessageId: string|null,
 *                    error: string|null, rendered: object|null}>}
 */
/** ★ The practice's logo for the email frame: an absolute https URL an email client can fetch (the stored pointer is served publicly on the practice's own host), or null → the frame's styled practice-name text. Never throws: a logo is never a reason an email does not go. */
async function practiceEmailLogo(tenantId, env) {
  try {
    return await withTenant(tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT t.slug, (SELECT value #>> '{}' FROM keystone.tenant_setting WHERE tenant_id = t.id AND key = 'branding.logo_url') AS logo
           FROM keystone.tenant t WHERE t.id = $1`, [tenantId]);
      return publicLogoUrl(rows[0]?.logo ?? null, practiceOrigin(rows[0]?.slug, env));
    });
  } catch { return null; }
}

export async function sendNotificationEmail({
  tenantId, notificationId, to, templateKey, vars = {}, terms = {}, attachments = null,
}, { fetchImpl, env = process.env, now = () => new Date() } = {}) {

  // ── 0 · ★★★ TASK 9.9 / CT-067 — THE SAMPLE REFUSAL, ON THE DOOR ITSELF, NOT THE CORRIDOR. ──
  // ★★★ [MEASURED, CT-067] the only gate lived ONE LAYER OUT — the job
  //     (`src/queue/tasks.mjs:790-812`) and the webhook path (`src/webhooks/subscribers.mjs`) — so
  //     any caller that reached THIS function directly, bypassing the job, sent the email anyway.
  //     THE OUTER GATES STAY EXACTLY AS THEY ARE (two layers is the point, 07 §4.3 / MOCKUPS §21:598);
  //     this is the second layer, on the sender itself.
  // ★★ Read straight from the subject's own flag — `keystone.app_user.is_sample` (task 9.4), the
  //    canonical source — never a caller-supplied flag that could be wrong or simply forgotten. A
  //    notification this query cannot see (an id that does not resolve) is a caller bug, not proof of
  //    a sample subject, and is left exactly where it already is — nothing else in this function
  //    checks that either, so this does not invent a new failure mode for it.
  const sampleRecipient = await withTenant(tenantId, async (tx) => {
    const { rows } = await run(tx, db
      .selectFrom("keystone.notification as n")
      .innerJoin("keystone.app_user as u", "u.id", "n.recipient_id")
      .select(["u.is_sample"])
      .where("n.tenant_id", "=", tenantId)
      .where("n.id", "=", notificationId));
    return rows[0]?.is_sample === true;
  });
  if (sampleRecipient) {
    // ★ Recorded in History exactly like the "not configured" skip just below — a refusal, never a
    //   silent nothing — and BEFORE any render or transport work, per CT-067.
    const deliveryId = await recordDelivery({
      tenantId, notificationId, status: "skipped", rendered: null,
      error: "sample subject — never emailed", completedAt: now(),
    });
    return { status: "skipped", deliveryId, providerMessageId: null,
             error: "sample subject — never emailed", rendered: null };
  }

  // ── 1 · RENDER FIRST, BEFORE ANY ROW EXISTS ─────────────────────────────────
  // ★★ A template that cannot render is not a delivery failure — nothing was ever attempted — so it must
  //    not leave a `failed` row implying the provider refused us. It is a bug in the caller, and it
  //    throws. ★ Recording it as a delivery would put a fake provider failure in the operator's list.
  //
  // ★★★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — THIS WAS THE ACTUAL SEND PATH FOR EVERY NOTIFICATION
  //     TEMPLATE (booking.reminder, booking.confirmed, document.ready_to_sign, every money template —
  //     `deliverNotificationEmail` → `sendNotificationEmail` is the ONE door), and it called
  //     `renderTemplate` with no `resolve` param — the THIRD branch documented on `renderTemplate`
  //     itself ("existing callers with no resolve param... keep that behaviour until task 20.42 wires
  //     a resolve param into the path"). That meant it always took the HARDCODED path (`TEMPLATES` in
  //     templates.mjs), never `resolveTemplate`'s tenant-override lookup against `keystone.email_template`
  //     — so editing and activating a template in Run → Templates (`src/routes/growthTemplates.mjs`,
  //     which genuinely does write and activate rows there) changed a row nothing ever read at send
  //     time. [MEASURED] every other write path for that table is real; this was the missing wire.
  //   ★ `tenantId` is already this function's own parameter — the only thing missing was opening a
  //     transaction to hand `resolveTemplate` a `tx`, so this is a purely additive wrap, not a new fact.
  const rendered = await withTenant(tenantId, (tx) => renderTemplate(templateKey, vars, terms, { tx, tenantId }));

  // ── 1b · ★★★ STAGE 4 TASK 6 — HAS THIS EMAIL ALREADY GONE, OR MIGHT IT HAVE? (02 §2.6: no double emails) ─────
  // ★★ A job that sends is retried now (07 §4.1a), re-run after a crash, and re-added under its key by a re-dispatch
  //    or by "Retry now". Every one of those arrives HERE, so the one-email rule is enforced here, from the row:
  //      · `sent` / `delivered`            → already sent. Never again.
  //      · `attempted` WITH an outcome note → IN DOUBT: the request left and no answer came back. Never again —
  //                                           a person decides (the give-up says so).
  //      · `attempted`, no note, older than an in-flight send could be (IN_FLIGHT_SECONDS) → a send interrupted by
  //                                           a crash: IN DOUBT, the same.
  //      · `attempted`, no note, recent     → another run is sending it right now: IN FLIGHT, try again later.
  //      · `failed` / `skipped` / no row    → it did not go: send.
  // ★★★ Fix round 1 (review I-2, I-3 / R66):
  //      · `failed` WITH a provider message id → it DID go, and Resend later reported a bounce or a complaint (the
  //                                           webhook, routes/webhooks.mjs). Never again — sending again would mail
  //                                           an address that bounced, or a person who marked us as spam.
  //      · IN DOUBT, but with a STORED body, first attempted < 23 h ago → RETRY under the same Idempotency-Key with
  //                                           the byte-identical body: Resend replays the original id instead of
  //                                           sending twice. Outside the window, or a legacy row with no stored
  //                                           body (sent without a key) → in doubt, a person decides, as before.
  // ★★★ Fix round 2 (review I-1, 0155):
  //      · `failed`/`skipped` that was EVER in doubt → the same window as an in-doubt row: a later definite failure
  //                                           does not erase that an earlier attempt may have been delivered.
  const prior = await priorDelivery(tenantId, notificationId);
  if (prior) {
    const settled = verdictFor(prior);
    if (settled) return { ...settled, deliveryId: prior.id, providerMessageId: null, rendered };
  }

  // ── 2 · ★★★ IS EMAIL CONFIGURED? A `skipped` ROW, NOT A `failed` ONE. ───────
  // ★★ THE DISTINCTION IS THE POINT. `failed` means we tried and the provider would not take it —
  //    somebody should look at the provider. `skipped` means this deployment cannot send at all —
  //    somebody should set a variable. Collapsing them sends an operator to the wrong place, and with
  //    no RESEND_API_KEY set (which is TRUE on this deployment today) that would be every single row.
  // ★ Run 8 R8-48 (J5): the organisation's own sender is resolved FIRST. An organisation sending through its own SMTP server or connected mailbox needs no provider key —
  //   a self-hosted install with SMTP set up had every owner notice ("X signed", "complete") skipped here for want of RESEND_API_KEY.
  const identity = await withTenant(tenantId, (tx) => mail.resolveIdentity(tx, { tenantId, purpose: templateKey.startsWith("auth.") ? "auth" : "default" }));
  const ownTransport = identity.mode === "smtp" || identity.mode === "mailbox";
  if (!emailIsConfigured(env) && !ownTransport) {
    const deliveryId = await recordDelivery({
      tenantId, notificationId, status: "skipped", rendered,
      error: "email is not configured on this deployment: RESEND_API_KEY is not set", completedAt: now(),
    });
    return { status: "skipped", deliveryId, providerMessageId: null,
             error: "RESEND_API_KEY is not set", rendered };
  }
  // ★★★ BATCH A — WHO THIS EMAIL IS FROM IS THE MAIL MODULE'S ANSWER, NOT A PLATFORM-WIDE VARIABLE. One identity per organisation (platform "<Org> via <Product>" with the organisation's Reply-To · its own verified
  //     domain · its own SMTP server), the same for every email family; sign-in and password mail stay on the fixed product sender. The module also owns the per-organisation daily limit.
  const { from, replyTo } = mail.fromLine(identity);
  // owner alerts (and the usage warnings among them) are not counted and never blocked by the limit they warn about; neither is sign-in mail (fixed sender, above) — only signing requests, reminders and completed copies count
  if (!identity.fixed && templateKey !== "workbench.owner_notice") {
    const lim = await withTenant(tenantId, (tx) => mail.checkLimit(tx, { tenantId }));
    if (lim.reached) {
      const msg = `daily sending limit reached (${lim.limit} a day) — it resets at midnight UTC, or raise the limit under Settings → Email`;
      const deliveryId = await recordDelivery({ tenantId, notificationId, status: "skipped", rendered, error: msg, completedAt: now() });
      return { status: "skipped", deliveryId, providerMessageId: null, error: msg, rendered, kind: "limit_reached" };
    }
  }

  // ★★★ 08 §4/§7 — staging/local never emails real people. This is a CONFIGURATION refusal, exactly
  //     like `sendingAddress` just above it — so it runs BEFORE any delivery row exists, for the same
  //     reason: a config problem is a bug in this deployment, not a delivery outcome, and must not
  //     leave an `attempted` row with nothing to complete it (that is what step 3 below is careful to
  //     avoid for a template that fails to render). Moving this below the `attempted` insert was tried
  //     and was wrong: a refusal here threw PAST the insert, leaving an orphaned `attempted` row (no
  //     error, no completed_at) and sending the worker job into endless retries.
  const routed = redirectForEnvironment({ to, subject: rendered.subject }, env);

  // ★★★ FOUND LIVE, 1 Oct 2026 ("7 missing emails" brief) — `rendered.html` is `""` for every
  //     shipped template (resolveTemplate.mjs's own comment: "currently empty for all"). Every
  //     notification email this product sends has gone out as plain text, system-wide. Wrapped here
  //     — the ONE choke point every notification email passes through — in the same branded React
  //     Email frame `src/email/signLinkEmail.mjs` already proved for the sign-link email, generalised
  //     in `notificationEmail.mjs`. `vars.practiceName` is the one variable every shipped template
  //     already relies on (EMAIL_ALIASES maps it from `practice.name`); a caller that somehow omits
  //     it gets "Your practice" rather than a broken render. No logo resolution here yet
  //     (`branding.logo_url` is a `ks-object:` storage pointer needing a separate resolve step, out
  //     of scope for this fix) — the frame's own fallback (styled practice-name text) covers it.
  // ★ NEW, Part 3 invoice rebuild — a per-template-key "chrome" derivation: which of the SHARED
  //   frame's optional slots (one CTA button, one large lead line + subtext) a given template
  //   fills, and from which `vars` keys. Only `money.invoice_issued` uses this today; every other
  //   template falls through with everything null, bit-for-bit the same render as before this
  //   change. Kept here (not in the registry/templates.mjs) because it is about the FRAME, not
  //   the editable liquid text — a practice can still rewrite the subject/body in Run → Templates
  //   without touching whether a Pay button appears.
  const chrome = emailChromeFor(templateKey, vars);
  const brandedHtml = (await renderNotificationEmail({
    practiceName: vars?.practiceName || "Your practice",
    logoUrl: await practiceEmailLogo(tenantId, env),
    subject: routed.subject,
    bodyText: rendered.text,
    ctaLabel: chrome.ctaLabel,
    ctaLink: chrome.ctaLink,
    leadText: chrome.leadText,
    leadSubtext: chrome.leadSubtext,
  })).html;

  // Launch step 8: a demo workspace sends nothing; the notice is recorded for its demo inbox and counts as sent
  { const held = await withTenant(tenantId, (tx) => mail.holdMessage(tx, { to, subject: rendered.subject, text: rendered.text, html: brandedHtml })); if (held) return { status: "sent", deliveryId: null, providerMessageId: held.providerMessageId, error: null, rendered }; }

  // ── 3 · THE `attempted` ROW, COMMITTED BEFORE THE REQUEST LEAVES ────────────
  // ★★ Stage 4 Task 6 — A CLAIM, not an overwrite: it takes the row only from `failed`/`skipped` (or creates it). Two
  //    runs racing for the same email (a job and its successor under the same key) — exactly one wins; the other
  //    reads what the winner left and reports it instead of sending.
  // ★★ R66: the body is built ONCE and stored by the claim; on a retry the claim hands back the STORED body, which is
  //    what goes — byte-identical — never this fresh render (which may have drifted: a renamed document, a new name).
  const resendAttachments = attachments
    ? attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") }))
    : null;
  const freshBody = resendRequestBody({
    to: routed.to, from, subject: routed.subject, text: rendered.text, html: brandedHtml,
    ...(replyTo ? { replyTo } : {}), attachments: resendAttachments,
  });
  const claimed = await claimDelivery({ tenantId, notificationId, body: freshBody, rendered });
  const deliveryId = claimed?.id ?? null;
  if (!deliveryId) {
    const now2 = await priorDelivery(tenantId, notificationId);
    return { ...(verdictFor(now2) ?? { status: "in_flight", error: "another run holds this email's delivery row" }),
             deliveryId: now2?.id ?? null, providerMessageId: null, rendered };
  }

  // ── 4 · THE REQUEST ────────────────────────────────────────────────────────
  // ★★★ R66 — ONE KEY PER DELIVERY, for its whole life: `ks-nd-<notification_delivery.id>`. The row's id never changes
  //     (the claim upserts), so every retry of this email — the schedule, a crash re-run, a superseded job, "Retry
  //     now" — presents the same key with the same bytes, and Resend sends it at most once within 24 h.
  // ★ Own SMTP server: the module sends it (no provider idempotency key exists there, so an unclear outcome is a plain failure a person can see). Everything else goes to the provider, byte-identical on a retry.
  const outcome = ownTransport
    ? await withTenant(tenantId, async (tx) => {
        const r = await mail.sendMail(tx, { tenantId, to, subject: rendered.subject, html: brandedHtml, text: rendered.text,
          attachments: resendAttachments, purpose: "default" });
        return { ok: r.status === "sent", status: null, providerMessageId: r.providerMessageId, response: null, error: r.error, kind: r.status === "failed" ? "dependency" : "validation", ambiguous: false };
      })
    : await sendViaResend({ rawBody: claimed.request_body, idempotencyKey: idempotencyKeyFor(deliveryId) }, { fetchImpl, env });
  if (outcome.ok && !ownTransport) await withTenant(tenantId, async (tx) => { await mail.recordMessage(tx, { tenantId, providerMessageId: outcome.providerMessageId }); if (!identity.fixed && templateKey !== "workbench.owner_notice") await mail.countSend(tx, { tenantId }); });

  // ── 5a · ★★★ STAGE 4 TASK 6 — AN OUTCOME NOBODY KNOWS STAYS `attempted` ────
  // ★★ The request left and no answer came back (our timeout, a dropped connection). Recording `failed` would be a
  //    lie in the dangerous direction — the next run would read "it did not go" and send it again. The row stays
  //    `attempted` (completed_at NULL, as 0042 requires) and carries the reason, which is what marks it IN DOUBT.
  if (!outcome.ok && outcome.ambiguous) {
    // ★★ R66: whether it may be retried is read from the ROW (its first attempt), not from this process's clock.
    // ★★★ Fix round 2 (I-1): the row is marked EVER in doubt first, unconditionally — a fact about Resend, true whoever
    //     holds the row now, and never cleared, so a later definite failure cannot erase it. The note itself is written
    //     only under THIS run's claim.
    const held = await withTenant(tenantId, async (tx) => {
      await run(tx, db
        .updateTable("keystone.notification_delivery")
        .set({ ever_in_doubt: true })
        .where("id", "=", deliveryId));
      const { rows } = await tx.query(
        `UPDATE keystone.notification_delivery SET error = $2, rendered = COALESCE(rendered, $3)
          WHERE id = $1 AND status = 'attempted' AND attempted_at = $5::timestamptz
          RETURNING (request_body IS NOT NULL AND first_attempted_at > now() - make_interval(hours => $4)) AS retry_ok`,
        [deliveryId, `in doubt — ${outcome.error ?? "no answer from the provider"}`, JSON.stringify(rendered),
         IN_DOUBT_RETRY_HOURS, claimed.claimed_at]);
      return rows[0] ?? null;
    });
    if (!held) return lostClaim(tenantId, notificationId, rendered);
    const retryOk = held.retry_ok === true;
    return { status: "in_doubt", deliveryId, providerMessageId: null, error: outcome.error, rendered,
             kind: outcome.kind, httpStatus: outcome.status ?? null, retryAfterSeconds: null,
             providerMessage: outcome.providerMessage ?? null,
             networkCode: outcome.networkCode ?? null, timeoutMs: outcome.timeoutMs ?? null,
             // ★ A 409 invalid_idempotent_request is never retried: the same stored body would be refused again.
             retryInDoubt: retryOk && outcome.idempotencyMismatch !== true,
             idempotencyMismatch: outcome.idempotencyMismatch === true,
             inDoubtWhy: retryOk ? null : "window" };
  }

  // ── 5 · THE OUTCOME, ON THE SAME ROW ───────────────────────────────────────
  // ★★ `rendered` is written on BOTH branches. A failed send still has to be showable: "what did you
  //    try to send me" is the first question, and a row that cannot answer it is a row that only proves
  //    somebody was unhappy.
  // ★★★ Fix round 2 (I-1) — THE OUTCOME HOLDS THE CLAIM. A run that stalled past IN_FLIGHT_SECONDS may have lost the
  //     row to another run, which may already have recorded `sent`, or be sending now. A FAILURE is written only under
  //     this run's own claim (still `attempted`, still stamped with this run's attempted_at). ★ A SUCCESS is a fact
  //     about Resend whoever holds the row: it is written over any row that has not recorded a send — so an email that
  //     went is never left reading `failed` (a person would then "send it by hand": the second email).
  const written = await withTenant(tenantId, async (tx) => {
    const r = await tx.query(
      `UPDATE keystone.notification_delivery
          SET status = $2, provider = $9, provider_message_id = $3,
              provider_response = $4, error = $5, rendered = COALESCE(rendered, $6), completed_at = $7
        WHERE id = $1
          AND ((status = 'attempted' AND attempted_at = $8::timestamptz)
               OR ($2 = 'sent' AND status IN ('attempted', 'failed', 'skipped') AND provider_message_id IS NULL))`,
      [deliveryId,
       outcome.ok ? "sent" : "failed",
       outcome.providerMessageId,
       // ★ `redirected_from` is added alongside the provider's own fields — never in place of them —
       //   so History can show who a staging/local send was REALLY for, without touching the shape
       //   `outcome.response` already had. No redirect and no response leaves this exactly `null`,
       //   as before.
       (outcome.response === null && routed.redirectedFrom === null)
         ? null
         : JSON.stringify({ ...(outcome.response ?? {}), redirected_from: routed.redirectedFrom }),
       // ★ Never an empty reason on a `failed` row — migration 0042 refuses it, and rightly: "failed"
       //   with no message is silence wearing a status.
       outcome.ok ? null : (outcome.error ?? "the provider failed and gave no message"),
       JSON.stringify(rendered),
       now(),
       claimed.claimed_at,
       ownTransport ? identity.mode : "resend"]);
    // ★ `rendered` above is COALESCEd: the claim froze the snapshot that matches the STORED body (R66), so a retry's
    //   fresh render never replaces what was actually sent.
    return r.rowCount;
  });
  if (written === 0) return lostClaim(tenantId, notificationId, rendered);

  return {
    status: outcome.ok ? "sent" : "failed",
    deliveryId,
    providerMessageId: outcome.providerMessageId,
    error: outcome.error,
    rendered,
    // ★ Stage 4 Task 6 — what the caller needs to decide retry vs give up, from the provider's facts.
    kind: outcome.kind ?? null, httpStatus: outcome.status ?? null, retryAfterSeconds: outcome.retryAfterSeconds ?? null,
    providerMessage: outcome.providerMessage ?? null, networkCode: outcome.networkCode ?? null,
  };
}

// ★ Stage 4 Task 6 — how long a send can honestly be "in flight": the provider timeout (15 s) plus generous slack.
//   An `attempted` row with no outcome older than this was interrupted (the process died mid-send).
const IN_FLIGHT_SECONDS = 120;
// ★★ R66 — Resend keeps an Idempotency-Key for 24 h (MEASURED, resend.com docs). An in-doubt send is retried only
//    while its FIRST attempt is younger than this — an hour of margin, so the key is certain to be held still.
export const IN_DOUBT_RETRY_HOURS = 23;
/** ★ R66 — the delivery's one Idempotency-Key. 42 characters; Resend allows 1–256. */
const idempotencyKeyFor = (deliveryId) => `ks-nd-${deliveryId}`;

async function priorDelivery(tenantId, notificationId) {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, status, error, provider_message_id, attempted_at > now() - make_interval(secs => $3) AS recent,
              (request_body IS NOT NULL AND first_attempted_at > now() - make_interval(hours => $4)) AS retry_ok,
              first_attempted_at IS NOT NULL AS has_anchor, ever_in_doubt
         FROM keystone.notification_delivery
        WHERE tenant_id = $1 AND notification_id = $2 AND channel = 'email'`,
      [tenantId, notificationId, IN_FLIGHT_SECONDS, IN_DOUBT_RETRY_HOURS]);
    return rows[0] ?? null;
  });
}

/** The settled answer a prior row gives, or null when it does not stop a send (never went / in doubt within R66). */
function verdictFor(prior) {
  if (!prior) return null;
  if (prior.status === "sent" || prior.status === "delivered") return { status: "already_sent", error: null };
  // ★★ I-2: a `failed` row WITH a provider id is a bounce or a complaint reported AFTER Resend took the email.
  if (prior.status === "failed" && prior.provider_message_id) return { status: "already_sent", error: prior.error };
  // ★★★ Fix round 2 (I-1): a `failed`/`skipped` row that was EVER in doubt may already have been delivered under its
  //     key. It is re-sent only as an in-doubt row is — its stored body, within the window; past it, a person decides.
  if ((prior.status === "failed" || prior.status === "skipped") && prior.ever_in_doubt && !prior.retry_ok) {
    return { status: "in_doubt", retryInDoubt: false, inDoubtWhy: prior.has_anchor ? "window" : "no_key",
             error: prior.error ?? "an earlier attempt at this email may have been delivered" };
  }
  if (prior.status === "attempted") {
    if (prior.error || !prior.recent) {
      // ★★ R66: in doubt, but the stored body and the key can still make a retry single — the claim takes it.
      if (prior.retry_ok) return null;
      return { status: "in_doubt", retryInDoubt: false, inDoubtWhy: prior.has_anchor ? "window" : "no_key",
               error: prior.error ?? "a previous attempt was interrupted after it started and never recorded an outcome" };
    }
    return { status: "in_flight", error: "another attempt at this email started moments ago and has not finished" };
  }
  return null;
}

/**
 * ★★★ STAGE 4 TASK 10 — "MAY A PERSON PUT THIS EMAIL BACK ON THE QUEUE?", ANSWERED FROM THE SAME ROW
 *     AND THE SAME RULE AS A SEND.
 *
 * ★★ Platform Jobs' "Retry now" must refuse an email that is IN DOUBT past R66's window — Resend has
 *    forgotten the Idempotency-Key by then, so a re-send could be a SECOND email to a real person, and
 *    02 §2.6 says never. It must also refuse one already sent, and one another run is sending now.
 *  ★★★ AND IT MUST BE THE SAME RULE, NOT A COPY OF IT. This function is `priorDelivery` + `verdictFor`
 *      and nothing else: if the window, the bounce rule or the in-flight rule ever changes, the button
 *      changes with it. A second implementation of "may this email go?" is how two answers begin.
 *  ★★★ IT WRITES NOTHING. Not the delivery row, not `ever_in_doubt` (sticky since 0155 and never
 *      cleared — by construction here, because there is no UPDATE in this path at all). The retry only
 *      re-queues the JOB; every rule about the EMAIL is enforced where it always was, inside
 *      `sendNotificationEmail`, when the worker runs.
 *
 * @returns {Promise<{ok: true} | {ok: false, why: string, reason: string}>} `reason` is one plain
 *          sentence for a person to read on the screen — never a stack, never an address.
 */
export async function emailRetryReadiness({ tenantId, notificationId }) {
  const prior = await priorDelivery(tenantId, notificationId);
  const settled = verdictFor(prior);
  if (!settled) return { ok: true };
  if (settled.status === "already_sent") {
    return { ok: false, why: "already_sent",
             reason: "This email has already gone out, so it is not sent again." };
  }
  if (settled.status === "in_flight") {
    return { ok: false, why: "in_flight",
             reason: "Another attempt at this email started moments ago and has not finished — give it a minute." };
  }
  // ★ in_doubt. Two shapes, and the difference matters to whoever reads it: the key has expired, or
  //   there never was one (a legacy row sent before R66 stored the body).
  return { ok: false, why: settled.inDoubtWhy === "no_key" ? "in_doubt_no_key" : "in_doubt_window",
           reason: settled.inDoubtWhy === "no_key"
             ? "An earlier attempt at this email may already have been delivered, and it was sent " +
               "without an idempotency key, so sending again could send it twice. Not sent again."
             : `An earlier attempt at this email may already have been delivered, and it has been in ` +
               `doubt for over ${IN_DOUBT_RETRY_HOURS} hours (past Resend's 24-hour idempotency key), ` +
               `so it is not sent again.` };
}

/** ★ Fix round 2 — this run's claim was taken by another run mid-send: what the row says NOW is the answer. */
async function lostClaim(tenantId, notificationId, rendered) {
  const now2 = await priorDelivery(tenantId, notificationId);
  return { ...(verdictFor(now2) ?? { status: "in_flight", error: "another run took this email's delivery row while this one was sending" }),
           deliveryId: now2?.id ?? null, providerMessageId: null, rendered };
}

/**
 * ★ The claim: create the row as `attempted`, or take it back. Returns { id, request_body } — the body to send — or
 *   null when somebody else holds it (or it must not be sent). It takes a row back ONLY when:
 *     · `failed`/`skipped` AND provider_message_id IS NULL — it never reached Resend (I-2: a bounce keeps its id and
 *       is never taken);
 *     · `attempted` and IN DOUBT (a note, or older than an in-flight send could be) WITH a stored body, first
 *       attempted < IN_DOUBT_RETRY_HOURS ago (R66) — the key makes the retry single.
 *   ★★★ Fix round 2 (I-1): a `failed`/`skipped` row that was EVER in doubt (`ever_in_doubt`, 0155) is taken only as
 *       an in-doubt row is — with its stored body, first attempted < IN_DOUBT_RETRY_HOURS ago. Taking back an
 *       `attempted` row marks it ever in doubt (it was interrupted, or its answer was lost). Never cleared.
 *   ★★ Returns `claimed_at` (this claim's attempted_at, as text so no microsecond is lost): the outcome writes only
 *      under it — a run that lost the row cannot overwrite it.
 *   ★★ The body and the first-attempt time are written ONCE (COALESCE) and never replaced: the retry sends the
 *      stored bytes, and `rendered` stays the snapshot of what those bytes say.
 *   Exactly one of two racing runs wins: the loser's conflict path re-checks the WHERE against the winner's committed
 *   row (`attempted`, no note, recent) and gets nothing back.
 */
async function claimDelivery({ tenantId, notificationId, body, rendered }) {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO keystone.notification_delivery AS nd
         (tenant_id, notification_id, channel, status, provider, attempted_at, request_body, first_attempted_at, rendered)
       VALUES ($1, $2, 'email', 'attempted', 'resend', now(), $3, now(), $4)
       ON CONFLICT (tenant_id, notification_id, channel) DO UPDATE
         SET status = 'attempted', error = NULL, provider = 'resend', provider_message_id = NULL,
             provider_response = NULL, attempted_at = now(), completed_at = NULL,
             request_body = COALESCE(nd.request_body, EXCLUDED.request_body),
             first_attempted_at = COALESCE(nd.first_attempted_at, now()),
             rendered = CASE WHEN nd.request_body IS NULL THEN EXCLUDED.rendered ELSE nd.rendered END,
             ever_in_doubt = nd.ever_in_doubt OR nd.status = 'attempted'
       WHERE (nd.status IN ('failed', 'skipped') AND nd.provider_message_id IS NULL
              AND (NOT nd.ever_in_doubt
                   OR (nd.request_body IS NOT NULL AND nd.first_attempted_at > now() - make_interval(hours => $5))))
          OR (nd.status = 'attempted' AND nd.request_body IS NOT NULL
              AND nd.first_attempted_at > now() - make_interval(hours => $5)
              AND (nd.error IS NOT NULL OR nd.attempted_at <= now() - make_interval(secs => $6)))
       RETURNING nd.id, nd.request_body, nd.attempted_at::text AS claimed_at`,
      [tenantId, notificationId, body, JSON.stringify(rendered), IN_DOUBT_RETRY_HOURS, IN_FLIGHT_SECONDS]);
    return rows[0] ?? null;
  });
}

/**
 * ★ One delivery row per (notification, channel) — the table's own UNIQUE constraint. So this UPSERTS:
 *   a retry updates the existing row rather than being refused.
 *
 * ★★★ AND THAT IS A RECORDED LIMITATION, NOT A DESIGN CHOICE I MADE HERE. [MEASURED from the catalog]
 *     `notification_delivery_tenant_id_notification_id_channel_key UNIQUE (tenant_id, notification_id,
 *     channel)` means **email delivery CANNOT keep one row per attempt.** A second attempt overwrites the
 *     first, so attempt history is lost — which is exactly what §P19.6 forbids for webhooks ("ONE ROW PER
 *     ATTEMPT"). ★ Closing it needs a migration and an `attempt` column; it is NOT delivered by P18.2 and
 *     is written into HANDOFF.md as a finding rather than left for somebody to discover from a support
 *     ticket. What survives today is the LAST attempt's outcome, and the row says so honestly.
 */
async function recordDelivery({ tenantId, notificationId, status, rendered, error, completedAt }) {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO keystone.notification_delivery
         (tenant_id, notification_id, channel, status, provider, error, rendered,
          attempted_at, completed_at)
       VALUES ($1,$2,'email',$3,'resend',$4,$5, now(), $6)
       ON CONFLICT (tenant_id, notification_id, channel) DO UPDATE
         SET status = EXCLUDED.status, error = EXCLUDED.error,
             rendered = COALESCE(EXCLUDED.rendered, keystone.notification_delivery.rendered),
             attempted_at = now(), completed_at = EXCLUDED.completed_at,
             provider = EXCLUDED.provider
       -- ★ Fix round 1: a row that went, or may have gone, is never overwritten by "not configured".
       WHERE keystone.notification_delivery.status IN ('failed', 'skipped')
         AND keystone.notification_delivery.provider_message_id IS NULL
       RETURNING id`,
      [tenantId, notificationId, status, error,
       rendered === null ? null : JSON.stringify(rendered), completedAt]);
    return rows[0]?.id ?? null;
  });
}
