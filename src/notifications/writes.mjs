// @ts-check
// P15B.12 — THE NOTIFICATION WRITES. createNotification · setNotificationPreference · markRead.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ WHICH SECTION OWNS WHAT HERE — AND THE TWO ANSWERS I GOT WRONG FIRST
// ═════════════════════════════════════════════════════════════════════════════
// `createNotification` does NOT emit. `setNotificationPreference` DOES, under `people`.
//
//   · **A NOTIFICATION IS THE CONSEQUENCE OF AN EVENT, NOT AN EVENT.** It is created BY a consumer
//     that already read `booking.booking.created` or `money.invoice.paid`. Emitting again would
//     double-count the same fact and put "we told somebody" in the activity feed as though the
//     practice had done something. ★ `notification.event_id` points BACK at the event that caused it,
//     which is the correct direction for that relationship — and this module REQUIRES it (see below).
//   · **A PREFERENCE IS A FACT ABOUT A PERSON**, and `people.preference.changed` already exists. It
//     belongs to `people`, not to a section of its own.
//     ★★ [MEASURED] there is no `notifications` section — the 11 are documents booking money people
//        accounts network items growth tasks platform provisioning. My first answer invented one; my
//        second used `growth`, whose ONLY topic is `campaign.sent`. **A session reminder is not a
//        campaign, and emitting it under that topic would be a lie in the audit log** — worse than
//        having no event. The write census records both wrong answers.
//
// ★ So this file has exactly one emit, and it is a `people` topic.

import { emit, userActor } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { fanOut, deliverableChannels, PRODUCTION_SENDERS } from "./send.mjs";
import { invalid, conflict, notFound, forbidden } from "../http/errors.mjs";
import { ALL_TOPICS } from "../events/outbox.mjs";
// ★ TASK 6.3 — SetNotifications' events × role matrix. `NOTIFICATION_TOPICS` is the closed catalogue
//   `setNotificationRule` validates `topic` and `alwaysOn`/locked refusal against;
//   `NOTIFICATION_ROLES` is the three-column matrix `notification_rule.role`'s own CHECK admits.
import { NOTIFICATION_TOPICS } from "./topics.mjs";
import { NOTIFICATION_ROLES, getEffectiveChannels } from "./rules.mjs";
import { writeAudit } from "../permissions/audit.mjs";

export const CHANNELS = Object.freeze(["in_app", "email", "push"]);

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

/**
 * Create an in-app notification.
 *
 * ★★★ `eventId` IS REQUIRED. The column is nullable and this module refuses a null anyway, because a
 *     notification with no cause is unanswerable: "why did I get this?" has no answer, and nothing can
 *     tell whether it was sent twice for one fact or once for two. §X4's whole shape is
 *     event → consumer → notification, and a notification that skipped the middle arrow came from
 *     somewhere that should not have been telling people things.
 *   ★ The FK is `ON DELETE SET NULL`, so an old notification can OUTLIVE its event — that is a
 *     retention decision about the outbox, not permission to create one without a cause.
 *
 * ★★ `topic` MUST BE A REAL TOPIC from the closed catalogue (P15B.3). The column is free text, so
 *    without this check a typo would produce a notification nobody's preferences can match — it would
 *    be delivered to everyone or to no one, depending on how the preference lookup defaults.
 */
export async function createNotification(tx, {
  tenantId, recipientId, eventId, topic, title, body = null, deepLink = null,
  // ★ FIX, 30 Sep 2026 (worker-failures brief) — migration 0542. See that file's own header:
  //   several automation kinds share ONE topic ('tasks.automation.ran') but need DIFFERENT email
  //   templates, which a topic→template map cannot express. Optional; every existing caller is
  //   unaffected.
  templateKey = null,
}) {
  if (!recipientId) throw invalid("recipientId is required");
  if (!eventId) {
    throw invalid(
      "eventId is required — a notification must name the event that caused it. Without one, 'why did I " +
      "get this?' has no answer and nothing can tell one notification for two facts from two for one.");
  }
  if (!ALL_TOPICS.includes(topic)) {
    throw invalid(
      `topic "${topic}" is not in the closed catalogue — a notification on an unknown topic matches ` +
      `nobody's preferences, so it is delivered to everyone or to no one depending on how the lookup ` +
      `defaults. Add the topic first (P15B.3).`);
  }
  if (typeof title !== "string" || !title.trim()) {
    throw invalid("title is required — a notification with no title renders as an empty row (U30)");
  }

  // Launch plan Part 4: one business event = one notice per person, for the topics Docustay's inbox shows (migration 0740 makes the database refuse a second). Asked first, so a retried job or a second
  // listener gets the notice that already exists back, and does not fan out a second time.
  if (/^documents\./.test(topic) || topic === "settings.subscription.updated") {
    const { rows: [already] } = await tx.query(`SELECT id, title FROM keystone.notification WHERE tenant_id = $1 AND recipient_id = $2 AND event_id = $3 AND (topic LIKE 'documents.%' OR topic = 'settings.subscription.updated') LIMIT 1`, [tenantId, recipientId, eventId]);
    if (already) return { id: already.id, topic, title: already.title, delivered: [], duplicate: true };
  }
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.notification")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        recipient_id: recipientId ?? null,
        event_id: eventId ?? null,
        topic: topic ?? null,
        title: title.trim() ?? null,
        body: body ?? null,
        deep_link: deepLink ?? null,
        template_key: templateKey ?? null,
      }));
  } catch (e) {
    if (e.code === FK_VIOLATION) {
      // ★ Either the recipient or the event does not exist IN THIS TENANT — under RLS a cross-tenant id
      //   presents exactly as a missing one, and the fix is the same either way.
      throw notFound("the recipient or the causing event does not exist in this organisation");
    }
    throw e;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P8.1 — THE FAN-OUT RUNS HERE, IN THE SAME TRANSACTION AS THE NOTIFICATION ROW.
  //     `fanOut` was complete and had no caller in `src/` at all; this is it. Placed at the
  //     CHOKEPOINT rather than at the call sites for the same reason `deliver_notification_email`
  //     puts the preference check at the single door every email leaves by: there are four
  //     producers today (`growth/campaigns.mjs:218`, `queue/tasks.mjs:262` and `:370`, and the
  //     `/api/notifications` route) and **a fifth added later inherits the promise instead of
  //     having to remember it.**
  //   ★★ SAME TRANSACTION IS THE POINT, NOT A CONVENIENCE. The notification and the record of
  //      what was done with it commit together or not at all, so the two can never disagree about
  //      whether a person was told.
  //   ★ `email` is deliberately NOT fanned out here — the queue job owns that channel and already
  //     honours the preference. See the block comment in `send.mjs`; adding it would put two
  //     writers on one `UNIQUE (tenant_id, notification_id, channel)` row.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const channels = await deliverableChannels(tx, { tenantId, recipientId });
  const delivered = await fanOut(tx, {
    tenantId, notificationId: id, recipientId, channels, senders: PRODUCTION_SENDERS,
  });

  // ★★★ NO emit(). See the header. The fact was already announced by the section that owns it; this is
  //     the consequence, and the consequence has a row, not an event.
  return { id, topic, title: title.trim(), delivered };
}

/**
 * ★★★ SET A PREFERENCE — AND `false` IS A DECISION, NOT AN ABSENCE.
 *
 * `UNIQUE (tenant_id, app_user_id, topic, channel)` means one row per person-topic-channel, so this is
 * an upsert. ★★ AN EXPLICIT `enabled = false` ROW IS NOT THE SAME AS NO ROW: "I turned this off" and
 * "I have never been asked" are different states, and a delivery path that treats a missing row as
 * off would silently stop telling people things they never opted out of — while one that treats it as
 * on would mail someone who did. **Whichever default the sender picks, it must be able to tell.**
 */
export async function setNotificationPreference(tx, {
  tenantId, appUserId, topic, channel, enabled, actorUserId = null,
}) {
  if (!appUserId) throw invalid("appUserId is required");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A PREFERENCE IS SET FOR YOURSELF. `appUserId` ARRIVED FROM THE BODY AND WAS TRUSTED.
  //     [MEASURED 2026-09-15 by the P7.F10 agent, recorded as `F282`] the dispatcher stamps only
  //     `tenantId` and `actorUserId` from the session (`routes/writes.mjs`); `appUserId` came
  //     straight from the caller. RLS scopes this table to the TENANT, not to the PERSON — so any
  //     staff member could have silenced a COLLEAGUE'S notifications by naming them in the payload.
  //
  //   ★★★ THIS IS THE IDENTICAL DEFECT `markNotificationRead` FIXED FIFTY LINES BELOW, in this same
  //       file, for the identical reason — and the fix there is already the decided pattern. Two
  //       functions, one table, one authority rule, and only one of them enforced it.
  //   ★★ IT TIGHTENS, WHICH IS THE SAFE DIRECTION. `F273` in this phase is the opposite mistake —
  //      widening a role so a screen would work. Nothing is widened here: a caller who could
  //      previously set only their own preference still can.
  //   ★ `actorUserId` NULL means no session (a gate or a worker acting deliberately) and is left to
  //     the caller's own judgement — the check fires only when a session IS present and names
  //     somebody else, which is the case that was exploitable.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (actorUserId && appUserId !== actorUserId) {
    throw forbidden(
      "a notification preference can only be set for yourself — this request named a different " +
      "person, and a preference is a fact about the person it belongs to");
  }
  if (!ALL_TOPICS.includes(topic)) {
    throw invalid(`topic "${topic}" is not in the closed catalogue — a preference for an unknown topic can never apply`);
  }
  if (!CHANNELS.includes(channel)) {
    throw invalid(`channel must be one of ${CHANNELS.join(", ")} — got ${JSON.stringify(channel)}`);
  }
  if (typeof enabled !== "boolean") {
    throw invalid(
      "enabled must be true or false — there is no third state. Omitting the row entirely means 'never " +
      "asked', which is a different fact and is expressed by NOT calling this.");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const { rows } = await tx.query(
    `INSERT INTO keystone.notification_preference (id, tenant_id, app_user_id, topic, channel, enabled)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, app_user_id, topic, channel) DO UPDATE SET enabled = EXCLUDED.enabled
     RETURNING id, enabled, (xmax <> 0) AS replaced`,
    [id, tenantId, appUserId, topic, channel, enabled]);

  await emit(tx, {
    tenantId,
    // ★★ `people.preference.changed` — the pre-existing topic for "a fact about a person changed".
    //    See the header for why this is NOT growth and NOT a section of its own.
    topic: "people.preference.changed",
    emittedBy: "people",
    subjectType: "person",
    subjectId: appUserId,
    // ★ STAGE 3 TASK 1 — `actorUserId` is already validated above as either null or the same person
    //   this preference belongs to.
    actor: userActor(actorUserId),
    payload: {
      preference_topic: topic, channel, enabled,
      // ★ `replaced` distinguishes a first answer from a changed one. A consumer confirming "your
      //   settings were saved" should not claim a change that did not happen.
      replaced: rows[0].replaced,
    },
  });
  return { id: rows[0].id, enabled: rows[0].enabled, replaced: rows[0].replaced };
}

/**
 * ★★★ TASK 6.3 — `POST /api/settings/notifications/rule` (06-settings.md §2.3). THE PRACTICE'S OWN
 *     DEFAULT, NOT A PERSON'S — sets ONE `keystone.notification_rule` row for (topic, role, channel),
 *     read as `getEffectiveChannels()`'s TIER 2 fallback (`src/notifications/rules.mjs`) beneath any
 *     person's own `notification_preference` override (§10 point 7, §11 — never the other way).
 *
 * ★★ AN ALWAYSON/LOCKED TOPIC REFUSES OUTRIGHT, NOT JUST A "TURN IT OFF". §2.3's own error table
 *    names ONE refusal for this case — `forbidden` "for an alwaysOn/locked topic" — with no separate
 *    carve-out for `enabled: true`. The frame renders these four rows as static "Always on" text,
 *    never a control (`specs/mockups/SetNotifications.frame.html`'s "Always sent" prose), so a
 *    request naming one can only be a client that skipped the UI or a stale link — either way, the
 *    server is the one place this cannot be silently accepted and then ignored.
 *
 * ★ `role`/`channel` are validated against the SAME two closed vocabularies the migration's own CHECK
 *   constraints admit (`NOTIFICATION_ROLES`, `CHANNELS`) — a typo here must be a 400, never a row an
 *   `INSERT` silently rejects with a raw constraint-violation message.
 */
export async function setNotificationRule(tx, {
  tenantId, topic, role, channel, enabled, actorUserId = null,
}) {
  const def = NOTIFICATION_TOPICS.find((t) => t.topic === topic);
  if (!def) {
    throw invalid(
      `topic "${topic}" is not in the notification-rule catalogue (src/notifications/topics.mjs) — ` +
      `a rule for an unknown topic can never apply`);
  }
  if (!NOTIFICATION_ROLES.includes(role)) {
    throw invalid(`role must be one of ${NOTIFICATION_ROLES.join(", ")} — got ${JSON.stringify(role)}`);
  }
  if (!CHANNELS.includes(channel)) {
    throw invalid(`channel must be one of ${CHANNELS.join(", ")} — got ${JSON.stringify(channel)}`);
  }
  if (typeof enabled !== "boolean") {
    throw invalid("enabled must be true or false — there is no third state.");
  }
  if (def.alwaysOn) {
    throw forbidden(
      `"${def.label}" is always on and cannot be changed here. It is one of the four notifications ` +
      `MOCKUPS §13 names as always sent — receipts, documents to sign, booking confirmations and ` +
      `cancellations — and the screen shows it as text, not a control.`);
  }

  const { rows } = await tx.query(
    `INSERT INTO keystone.notification_rule (tenant_id, topic, role, channel, enabled, locked)
     VALUES ($1,$2,$3,$4,$5,false)
     ON CONFLICT (tenant_id, topic, role, channel) DO UPDATE SET enabled = EXCLUDED.enabled
     RETURNING id, enabled, (xmax <> 0) AS replaced`,
    [tenantId, topic, role, channel, enabled]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `settings.notification_rule.changed` — DECLARED IN THE CLOSED CATALOGUE
  //     (`src/events/topics.mjs`) AND, UNTIL THIS COMMIT, CARRIED IN `db/gates/s3_topic_emitters
  //     .mjs`'s `RESERVED` MAP AS "no emitter anywhere — the notifications table/switch screen is
  //     not built". This is that emitter, now real. The RESERVED entry itself is a one-line removal
  //     in a file outside this task's own list (`db/gates/s3_topic_emitters.mjs` is not named in
  //     Task 6.3's FEATURES-COMBINED-PLAN.md field block) — reported at step 2, for step 3/4 to make,
  //     rather than edited here without it being asked for.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  await emit(tx, {
    tenantId,
    topic: "settings.notification_rule.changed",
    emittedBy: "settings",
    actor: userActor(actorUserId),
    payload: { topic, role, channel, enabled, replaced: rows[0].replaced },
  });

  // ★ CT-105 — the SAME "Last changed by {name} on {date}" mechanism every other settings screen
  //   uses (`src/routes/settings.mjs:178-190`'s `lastChangedBy`, `object: "settings.notifications"`
  //   read back by the GET route below). `AUDIT_FIELDS["settings.changed"]` is `[]` (Q7-7) — the
  //   `after` shape here is filtered to nothing by `writeAudit` itself, which is correct: the row
  //   this action needs is WHO and WHEN, and the outbox event above already carries WHAT.
  await writeAudit(tx, {
    tenantId, action: "settings.changed", object: "settings.notifications",
    actorUserId, after: { topic, role, channel, enabled },
  });

  return { updated: true };
}

/**
 * Mark a notification read.
 * ★ Idempotent by predicate: `read_at IS NULL` means a second call matches zero rows and cannot MOVE
 *   the timestamp. "When did they first see it" is the only useful reading of that column, and an
 *   unconditional UPDATE would overwrite it every time the list was re-opened.
 */
export async function markNotificationRead(tx, { tenantId, notificationId, actorUserId = null }) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `recipient_id = $2` — AND IT WAS MISSING. [MEASURED 2026-09-15 while building P5.5]
  //     the predicate was `WHERE id = $1 AND read_at IS NULL` alone. RLS scopes this table to the
  //     TENANT; it does not scope it to the PERSON — so any coach or admin in the practice could
  //     mark a COLLEAGUE'S notification read by presenting its id, and ids are uuid v7, which is
  //     time-ordered and therefore partly guessable.
  //
  // ★★ THE COMMENT BELOW ALREADY CLAIMED THIS PROTECTION — *"Already read, OR NOT THEIRS TO READ"* —
  //    and no clause implemented it. A comment describing a guard that does not exist is the
  //    failure this project has recorded twice before; it reads as verification to the next person.
  //
  // ★ §K3, again: "same tenant" can never imply "same audience". `/api/settings/notifications`
  //   learned this once already by returning EVERY person's preferences to any staff caller.
  // ★★ The effect is small — it moves a timestamp and discloses nothing — but the badge that
  //    depends on it is per-person, so without this one person's click could decrement another's
  //    count, which is the visible half of the same defect.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const r = await run(tx, db
    .updateTable("keystone.notification")
    .set({ read_at: sql`now()` })
    .where("id", "=", notificationId)
    .where("recipient_id", "=", actorUserId)
    .where("read_at", "is", null)
    .returning(["read_at"]));
  if (r.rowCount === 0) {
    // ★ Already read, or not theirs to read — and now the second half is TRUE. NOT an error worth
    //   raising to a user: the caller asked for a state that already holds, or for one that was
    //   never theirs to ask about, and the two are deliberately indistinguishable here. Telling
    //   them WHICH would answer "does this id exist and whose is it", which is an oracle.
    return { id: notificationId, changed: false };
  }
  return { id: notificationId, changed: true, read_at: r.rows[0].read_at };
}

/**
 * Mark all notifications read for the actor.
 * ★★★ `recipient_id = $2` — same security fix as `markNotificationRead` (line 277-291):
 *     RLS scopes to TENANT only, so without this clause any staff member could mark
 *     a COLLEAGUE'S notifications read. The predicate MUST check both tenant and recipient.
 */
export async function markAllNotificationsRead(tx, { tenantId, actorUserId }) {
  const r = await tx.query(
    // ★ an aggregate is not allowed in RETURNING (this threw on every "mark all read")
    `WITH u AS (UPDATE keystone.notification SET read_at = now()
                 WHERE tenant_id = $1 AND recipient_id = $2 AND read_at IS NULL
                 RETURNING 1)
     SELECT count(*)::int AS count FROM u`,
    [tenantId, actorUserId]);
  const count = r.rows[0]?.count ?? 0;
  return { changed: count > 0, count };
}

/**
 * Send a test notification to the caller.
 * ★★★ RESPECTS THE CALLER'S OWN PREFERENCE. Before creating a notification, checks whether
 *     the caller has enabled the in_app channel for this topic via `getEffectiveChannels`.
 *     If they have disabled it, returns `{sent: false}` WITHOUT creating a row — this is how
 *     off preferences actually stop notifications.
 *   ★ A test notification is NEVER emitted as an event — it is a utility for verification,
 *     not a fact about the practice. No corresponding event row is created.
 */
export async function sendTestNotification(tx, { tenantId, topic, actorUserId }) {
  if (!ALL_TOPICS.includes(topic)) {
    throw invalid(
      `topic "${topic}" is not in the closed catalogue — a test notification on an unknown ` +
      `topic would never match a preference, so it would be delivered to everyone or to no one.`);
  }

  // ★ Check the caller's own preference for this topic, in_app channel only
  //   (PRODUCTION_SENDERS confirms that is the only active channel in this codebase).
  const effective = await getEffectiveChannels(tx, {
    tenantId, recipientId: actorUserId, topic, channel: "in_app",
  });
  if (!effective) {
    return { sent: false };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ FIX (touch-up round two, wave 2.1 verification) — this used to call `createNotification`
  //   with a freestanding, freshly-minted `eventId` that names no real row. `event_id` is a real
  //   FK (`ON DELETE SET NULL`, nullable) and `createNotification` refuses a null one on purpose
  //   ("a notification with no cause is unanswerable" — see its own header comment, a deliberate
  //   rule for REAL notifications) — so every call here was hitting the FK violation and coming
  //   back as `notFound("the recipient or the causing event does not exist")`, always, for every
  //   topic. A test notification has no real business event to point at — that IS the honest fact
  //   here, not a gap to paper over — so this inserts directly with `event_id = NULL` (the column
  //   allows it) and runs the SAME fan-out `createNotification` runs, rather than bypassing the
  //   eventId rule inside that function for everyone else.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db
    .insertInto("keystone.notification")
    .values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      recipient_id: actorUserId ?? null,
      event_id: null,
      topic: topic ?? null,
      title: "Test notification",
      body: `Testing notifications for ${topic}`,
    }));

  const channels = await deliverableChannels(tx, { tenantId, recipientId: actorUserId });
  const delivered = await fanOut(tx, {
    tenantId, notificationId: id, recipientId: actorUserId, channels, senders: PRODUCTION_SENDERS,
  });

  return { sent: true, id, delivered };
}
