// @ts-check
// P9.8 / P9.9 — THE SEND PATH. The five FCM token rules live HERE, not in the client.
//
// ★★★ §X6, and it is worth quoting because it reassigns blame correctly:
//   "THE FCM TOKEN BUG WAS OURS, NOT NOVU'S — AND NOVU NEVER FIXED IT. Novu stores the token as
//    a subscriber credential and relays to FCM. Deletion-on-rejection, the upsert key and the
//    refresh cadence were always ours to write. That is why the live system still hit **83% token
//    duplication** and a stale-token outage WHILE RUNNING NOVU."
//
// ★★ So changing vendor could never have fixed it, and the rules go in the SEND PATH — the one
// place that learns a token is dead. A client cannot know: it is told nothing when its own token
// is rejected for somebody else's send.

// ★ TASK 6.3 — `getEffectiveChannels` is the one new read `fanOut()` below gains (06-settings.md
//   §11); see `src/notifications/rules.mjs` for the three-tier fallback it implements.
import { getEffectiveChannels } from "./rules.mjs";

// ★ Wave C4 Task C4.4 — push sender for FCM
import { pushSender } from "./push.mjs";

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ [DOC] The two rejection signals that mean "this token is dead — delete the row". */
const DEAD_TOKEN_SIGNALS = Object.freeze([
  'registration-token-not-registered',   // FCM
  'messaging/registration-token-not-registered',
  'NotRegistered',
  'InvalidRegistration',
  'Unregistered',
  '410',                                  // APNs 410 Gone
]);

/** ★ [DOC] Android registrations are garbage-collected after 270 days of inactivity. */
export const ANDROID_GC_DAYS = 270;

/** ★★ Is this provider response telling us the token is dead? */
export function isDeadToken(err) {
  const s = `${err?.code ?? ''} ${err?.status ?? ''} ${err?.message ?? err ?? ''}`;
  return DEAD_TOKEN_SIGNALS.some((sig) => s.includes(sig));
}

/**
 * ★★★ RULE 1 + RULE 3 — ONE DEVICE, ONE ROW. UPSERT, NEVER INSERT. And stamp the timestamp on
 * EVERY upload, because [DOC] that is Firebase's own signal that the app opened and synced.
 *
 * ★★ RULE 5 falls out of rule 1: tokens change on reinstall, device restore, cleared app data
 * and OS update. **The upsert key is what makes that churn harmless** — without it, every
 * reinstall is a new row, and that is how a system reaches 83% duplication without anyone doing
 * anything wrong.
 */
export async function registerDeviceToken(tx, { tenantId, appUserId, platform, token,
                                                now = new Date() }) {
  if (!token || typeof token !== 'string') throw new TypeError('a device token is required');

  const { rows } = await tx.query(
    `INSERT INTO keystone.device_token
       (tenant_id, app_user_id, platform, token, registered_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (tenant_id, app_user_id, platform, token)
     DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
     RETURNING id, (xmax = 0) AS inserted`,
    [tenantId, appUserId, platform, token, now]);
  // ★ `xmax = 0` distinguishes an INSERT from an UPDATE, so a caller can tell "new device" from
  // "same device checking in" without a prior read.
  return { id: rows[0].id, inserted: rows[0].inserted };
}

/**
 * ★★★ RULE 2 — DELETE THE ROW ON REJECTION, EVERY TIME.
 * ★ Not "mark inactive", not "increment a failure count". A dead token is not data: it is a row
 * that will be selected again on the next send, fail again, and cost another provider round-trip
 * forever. The live stale-token outage was exactly this.
 */
export async function deleteDeadToken(tx, { tenantId, token }) {
  const { rowCount } = await run(tx, db
    .deleteFrom("keystone.device_token")
    .where("tenant_id", "=", tenantId)
    .where("token", "=", token));
  return rowCount;
}

/**
 * ★ RULE 4 — PRUNE PROACTIVELY. [DOC] Android is GC'd at 270 days and FCM then rejects sends;
 * iOS has no equivalent expiry, so it is pruned on the same schedule rather than left to rot.
 */
export async function pruneStaleTokens(tx, { tenantId, now = new Date(),
                                             days = ANDROID_GC_DAYS }) {
  const cutoff = new Date(now.getTime() - days * 86400_000);
  const { rowCount } = await run(tx, db
    .deleteFrom("keystone.device_token")
    .where("tenant_id", "=", tenantId)
    .where("last_seen_at", "<", cutoff));
  return rowCount;
}

/**
 * ★★★ THE FAN-OUT. §X6: "ONE `notification` row, plus ONE `notification_delivery` row PER CHANNEL
 * carrying the provider response. ★ NEVER INFER DELIVERY FROM THE ABSENCE OF AN ERROR."
 *
 * ★★ THE DELIVERY ROW IS WRITTEN **BEFORE** THE PROVIDER IS CALLED, as `attempted`. If the
 * process dies mid-send, the row survives saying `attempted` — which is the truth, and is
 * distinguishable from both `sent` and never-tried. ★ A row written only on success leaves a
 * vanished send indistinguishable from a send that never happened.
 *
 * @param senders { email, push, in_app } — injected, so a failure can be provoked with no network
 */
export async function fanOut(tx, { tenantId, notificationId, recipientId, channels, senders = {},
                                   now = new Date() }) {
  const results = [];

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 6.3 — THE TOPIC IS FETCHED ONCE, HERE, NOT PER CHANNEL. `getEffectiveChannels()`
  //     (`src/notifications/rules.mjs`) needs it for both tiers of its own lookup (a person's own
  //     preference AND the practice's `notification_rule` default are both keyed on topic), and the
  //     old inline query below fetched it fresh inside the loop — once per channel was always
  //     redundant, since a notification's topic cannot change between two channels of the SAME
  //     fan-out call.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows: [notif] } = await run(tx, db
    .selectFrom("keystone.notification")
    .select("topic")
    .where("id", "=", notificationId));
  const topic = notif?.topic ?? null;

  for (const channel of channels) {
    // ★★★ 06-settings.md §10 point 7 / §11 — `getEffectiveChannels()` is the fallback BENEATH the
    //     person's own preference, never instead of it: it asks `notification_preference` FIRST and
    //     only reaches the practice's `notification_rule` default when that person has never decided
    //     (`src/notifications/rules.mjs`'s own three-tier order). An explicit opt-OUT, OR a
    //     practice-level default of off with no personal override, suppresses the channel — and it
    //     is RECORDED as `skipped`, not silently omitted. "Nothing was sent" and "we chose not to
    //     send" are different answers.
    const enabled = topic
      ? await getEffectiveChannels(tx, { tenantId, recipientId, topic, channel })
      : true; // ★ no topic found (should not happen inside a real fan-out) — fails to the old default.

    if (enabled === false) {
      await tx.query(
        `INSERT INTO keystone.notification_delivery
           (tenant_id, notification_id, channel, status, completed_at)
         VALUES ($1,$2,$3,'skipped',$4)
         ON CONFLICT (tenant_id, notification_id, channel) DO NOTHING`,
        [tenantId, notificationId, channel, now]);
      results.push({ channel, status: 'skipped' });
      continue;
    }

    // ★★★ THE ROW GOES IN FIRST.
    const d = await tx.query(
      `INSERT INTO keystone.notification_delivery
         (tenant_id, notification_id, channel, status, attempted_at)
       VALUES ($1,$2,$3,'attempted',$4)
       ON CONFLICT (tenant_id, notification_id, channel) DO NOTHING
       RETURNING id`,
      [tenantId, notificationId, channel, now]);

    if (d.rowCount === 0) { results.push({ channel, status: 'already_attempted' }); continue; }
    const deliveryId = d.rows[0].id;

    const sender = senders[channel];
    if (!sender) {
      await run(tx, db
        .updateTable("keystone.notification_delivery")
        .set({ status: "failed", error: "no sender configured for this channel", completed_at: now })
        .where("id", "=", deliveryId));
      results.push({ channel, status: 'failed', error: 'no sender configured' });
      continue;
    }

    try {
      // ★ Wave C4 Task C4.4 — pass tx to sender so push can query device tokens within the same transaction
      const resp = await sender(tx, { tenantId, recipientId, notificationId });
      // ★★★ P18.2/0043 — A SENDER MAY RETURN WHAT IT SENT, AND FOR EMAIL IT MUST.
      //     `delivery_sent_email_carries_its_snapshot` requires an email that reached `sent` to carry
      //     {subject, text} — because "what did you send me" is the first question after any dispute and
      //     a template re-rendered later shows what it says TODAY, not what the person received.
      //   ★★ THIS SEAM IS WHY THE CONSTRAINT IS SATISFIABLE FROM HERE. [MEASURED] the fan-out writes the
      //      delivery row itself and previously discarded everything the sender knew except a provider
      //      and a message id — so an email sent through this path was unshowable by construction, and
      //      it took the constraint to surface that. **The sender is the only thing that knows what it
      //      sent, so the sender is what has to hand it back.**
      //   ★ Other channels may return nothing: an in-app notification's text lives on the `notification`
      //     row and a push payload is assembled by the sender, so there is no separate copy to freeze.
      await run(tx, db
        .updateTable("keystone.notification_delivery")
        .set({
          status: "sent",
          provider: resp?.provider ?? null,
          provider_message_id: resp?.messageId ?? null,
          provider_response: JSON.stringify(resp ?? {}),
          rendered: resp?.rendered === undefined || resp?.rendered === null ? null : JSON.stringify(resp.rendered),
          completed_at: now
        })
        .where("id", "=", deliveryId));
      results.push({ channel, status: 'sent', messageId: resp?.messageId ?? null });
    } catch (e) {
      // ★★ A PUSH REJECTION IS ALSO A TOKEN FACT. This is the only place that learns it, so this
      // is where rule 2 fires — inside the same transaction as the delivery record, so the two
      // can never disagree about what happened.
      let tokenDeleted = 0;
      if (channel === 'push' && isDeadToken(e) && e?.token) {
        tokenDeleted = await deleteDeadToken(tx, { tenantId, token: e.token });
      }
      await run(tx, db
        .updateTable("keystone.notification_delivery")
        .set({
          status: "failed",
          error: (String(e?.message ?? e).trim() || "the sender failed and gave no message").slice(0, 1000),
          provider_response: JSON.stringify({ code: e?.code ?? null, deadToken: tokenDeleted > 0 }),
          completed_at: now
        })
        .where("id", "=", deliveryId));
      // ★ P18.2/0042 — NEVER AN EMPTY REASON. `String(new Error())` is "Error" but a thrown `''` or a
      //   custom error with a blank message yields "", and `delivery_failure_states_its_reason` (added
      //   at 0042, kept universal because this path already satisfied it) refuses a blank. One
      //   coalesce keeps a message-less throw from turning a recorded failure into a constraint
      //   violation — which would be a worse failure than the one being recorded.
      results.push({ channel, status: 'failed', error: String(e?.message ?? e), tokenDeleted });
    }
  }

  return results;
}

/**
 * ★ "Did it actually send?" — answerable, per channel, from stored provider responses.
 * ★★ Note what this CANNOT return: silence. Every channel attempted has a row, so a channel
 * missing from the result is a channel that was never attempted — itself a finding.
 */
export async function deliveryReport(tx, { tenantId, notificationId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.notification_delivery")
    .select(["channel", "status", "provider", "provider_message_id", "provider_response", "error", "attempted_at", "completed_at"])
    .where("tenant_id", "=", tenantId)
    .where("notification_id", "=", notificationId)
    .orderBy("channel", "asc"));
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P8.1 — THE PRODUCTION CALLER. `fanOut` WAS COMPLETE AND NOTHING IN `src/` HAD EVER RUN IT.
//
// ★★★ WHAT WAS ACTUALLY MISSING, MEASURED 2026-09-15 — NOT WHAT THE PLAN SAID.
//     The plan states *"since fanOut never runs, a user's notification preference has no effect on
//     anything"*. **That is out of date and checking it first is the whole job.** `deliver_
//     notification_email` (`src/queue/tasks.mjs:552`) ALREADY reads `notification_preference` in a
//     LEFT JOIN and already writes a `skipped` row; its own comment records that being added at
//     P2 CLOSE §VISUAL *because* fanOut was gate-only. **Email is done and must not be re-done.**
//     [MEASURED on the local database] `notification_delivery` = **0 rows, ever**, across every
//     channel — so the real gap is that NOTHING records an in-app delivery or consults the in-app
//     preference, and push has no sender at all.
//
// ★★★ EMAIL IS DELIBERATELY NOT IN `PRODUCTION_SENDERS`, AND THIS COMMENT IS THE REASON.
//     `notification_delivery` is `UNIQUE (tenant_id, notification_id, channel)`. The email job
//     writes that row itself. A second writer for the same channel would either lose the race and
//     silently `DO NOTHING`, or mark `sent` here **before the provider had been called** — which is
//     precisely the lie `fanOut`'s own header forbids ("NEVER INFER DELIVERY FROM THE ABSENCE OF AN
//     ERROR"). **One channel, one owner.** If you are about to add `email` here, you are about to
//     create two sources of truth for whether a person was emailed.
//
// ★★ PUSH IS ABSENT BECAUSE IT CANNOT WORK YET, AND ABSENT IS HONEST WHERE A STUB IS NOT.
//    `fanOut` records `failed / "no sender configured for this channel"` for a channel it is asked
//    to deliver and cannot — correct behaviour, but asking it on every notification would write a
//    failed row for every notification forever. [MEASURED] `device_token` holds **0 rows** and
//    `KEYSTONE_FIREBASE_SERVICE_ACCOUNT_JSON` is unset, so push has neither an audience nor a
//    credential. `deliverableChannels()` therefore asks for push only when a token exists AND a
//    sender is registered — so the day both arrive, nothing here has to be remembered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ The in-app "delivery" is the `notification` row itself — it is already written, in this same
 *   transaction, by `createNotification`. So this sender performs no I/O: it exists to RECORD that
 *   the in-app channel was served, which is the fact `notification_delivery` is for.
 * ★★ It returns no `rendered` snapshot on purpose. `fanOut`'s header rules that an email must carry
 *    {subject, text} because a template re-rendered later shows what it says TODAY — an in-app
 *    notification has no second copy to drift from; its text IS the row.
 * ★ Accepts tx (transaction) for consistency with other senders, though not used here.
 */
const inAppSender = async (tx, { notificationId }) => ({
  provider: "keystone",
  messageId: notificationId,
});

/**
 * ★★★ TASK 20.49 — SMS SENDER FOR TWILIO.
 *
 * Renders the notification's BODY as SMS text (subject is dropped — SMS has no subject).
 * Sends via Twilio, records usage with the message SID as providerRef.
 * ★ Quiet hours block SMS harder: no override channel — inside quiet hours, nothing sends.
 * ★ SMS consent is INDEPENDENT from email — an active `sms_marketing` row is required.
 * The consent check happens UPSTREAM at `getEffectiveChannels()` (src/notifications/rules.mjs).
 */
async function smsSender(tx, { tenantId, recipientId, notificationId }) {
  // ★ Fetch the notification to get its body (text, not subject)
  const { rows: [notif] } = await run(tx, db
    .selectFrom("keystone.notification")
    .select("body")
    .where("id", "=", notificationId));
  if (!notif || !notif.body) {
    throw new Error("notification not found or has no body for SMS");
  }

  // ★ Fetch the recipient's phone number
  const { rows: [person] } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("mobile_phone as mobile")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", recipientId));
  if (!person || !person.mobile) {
    throw new Error("recipient has no phone number on file");
  }

  // ★ Get Twilio credentials — if not configured, the sender shouldn't be in PRODUCTION_SENDERS
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
    throw new Error("Twilio is not configured (missing SID, token, or from number)");
  }

  // ★ Call Twilio API to send the SMS
  const { callOutside } = await import("../http/outside.mjs");
  const { recordUsage } = await import("../billing/usage.mjs");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64");

  const formData = new URLSearchParams();
  formData.append("From", twilioFromNumber);
  formData.append("To", person.mobile);
  formData.append("Body", notif.body);

  const result = await callOutside("twilio", url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!result.ok || !result.body?.sid) {
    throw new Error(
      `Twilio send failed: ${result.status} ${result.body?.error_message || result.body?.message || "unknown error"}`
    );
  }

  const messageId = result.body.sid;

  // ★ Record usage: 1 unit = 1 SMS (Twilio num_segments would be > 1 for long messages,
  //   but we count the send as 1 unit; billing adapters will verify and reconcile per provider)
  await recordUsage(tx, {
    tenantId,
    metric: "text",
    units: 1,
    provider: "twilio",
    providerRef: messageId,
  });

  return {
    provider: "twilio",
    messageId,
  };
}

/**
 * The senders production actually has. Push joins this map when it has a credential AND tokens.
 * SMS joins when Twilio credentials are configured.
 *
 * ★★★ WAVE C4 TASK C4.4 — push sender is conditionally included. If KEYSTONE_FIREBASE_PROJECT_ID
 * is set, push notifications are enabled. `deliverableChannels()` then checks for device tokens
 * before including push in the fan-out (so a notification doesn't fail just because a recipient
 * has no devices registered).
 *
 * ★★★ TASK 20.49 — SMS sender is conditionally included. If TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * and TWILIO_FROM_NUMBER are all set, SMS is enabled. The consent check (sms_marketing consent
 * required) happens upstream at `getEffectiveChannels()`.
 */
export const PRODUCTION_SENDERS = Object.freeze({
  in_app: inAppSender,
  ...(process.env.KEYSTONE_FIREBASE_PROJECT_ID ? { push: pushSender } : {}),
  ...(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    ? { sms: smsSender }
    : {}),
});

/**
 * Which channels this system can serve for THIS recipient, right now.
 * ★★ ASKED PER RECIPIENT, not per deployment: a tenant with one person on a phone and one without
 *    must not produce a failed push row for the second. The question "can we push to them" is a
 *    fact about them, not a configuration flag.
 */
export async function deliverableChannels(tx, { tenantId, recipientId }) {
  const channels = ["in_app"];
  if (PRODUCTION_SENDERS.push) {
    const t = await run(tx, db
      .selectFrom("keystone.device_token")
      .select(sql`1`)
      .where("tenant_id", "=", tenantId)
      .where("app_user_id", "=", recipientId)
      .limit(1));
    if (t.rowCount > 0) channels.push("push");
  }
  return channels;
}
