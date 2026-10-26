// @ts-check
// Stage 14 task 14.24 — LOYALTY. Rules, rewards, the ledger, claimable people, and "Tell them".
//
// Schema is `db/migrations/0414_loyalty.sql` (task 14.7, written but not applied as of this task —
// see that file's own header for the full reasoning). Three tables:
//   · `keystone.loyalty_rule`   — how many points per dollar/visit/referral, one row per kind.
//   · `keystone.loyalty_reward` — what a person can claim with points.
//   · `keystone.loyalty_entry`  — the APPEND-ONLY ledger. Balance is `SUM(points)`, NEVER a counter.
//     app_rw holds SELECT, INSERT ONLY on this table (0414: "a ledger you can rewrite is not one").
//     A correction is a new `reason = 'adjust'` row, never an UPDATE/DELETE — nothing in this file
//     issues either against `loyalty_entry`.
//
// ★★★ THE NEVER-NEGATIVE TRIGGER (`keystone.loyalty_entry_never_negative`, 0414 §D) CANNOT FIRE FROM
//     ANYTHING IN THIS FILE. It refuses an INSERT that would take `SUM(points) + NEW.points` below
//     zero for a person. `loyalty_entry_points_shape` already requires `points > 0` for every reason
//     this file ever inserts (`earn_payment`/`earn_visit`/`earn_referral`, in `accrueLoyalty` below) —
//     a positive addition to a balance that itself can never be negative (the trigger's own invariant)
//     can never take the sum below zero. The only reasons that CAN carry negative points, `claim` and
//     `adjust`, are NOT written by this file — field 4 says so explicitly ("Claim: NOT here — Stage
//     15's 15.66/15.67, CT-F41"), and there is no `adjust` writer named for this task either. So there
//     is no route in this file that needs to translate the trigger's Postgres exception
//     ("Not enough points — % short.", ERRCODE 23514/check_violation under
//     `pg_advisory_xact_lock`) into a person-facing sentence — MEASURED, not assumed, from the three
//     facts above. The property test at `test/s14_items_loyalty.test.mjs` exercises the trigger
//     directly with hand-written SQL claim rows, exactly as field 8 asks, precisely because nothing
//     application-side reaches it yet.
//
// ★★★ `loyalty.enabled` AND `loyalty.tell_channel` ARE BOTH ALREADY REGISTERED SETTINGS
//     (`src/settings/keys.mjs:465,534`, MEASURED) — this file reads both through `getSetting`, never
//     a raw query, so the closed-vocabulary/validator checks that module owns stay in force.
//
// ★ UPDATE, same build session: `items.loyalty.points_earned` and `items.loyalty.told` were NOT in
//   `src/events/topics.mjs`'s closed catalogue when this file was first written (grep: 0 hits) — task
//   14.15 landed them concurrently, in the SAME `items` array 14.16's own header already describes
//   this pattern for (`items.category.created`, landed before its own topic too). Re-measured after
//   14.15 landed: both topics are now present. No code change needed here; noted so a stale claim
//   does not outlive the gap it described.
//
// ★★★ MEASURED GAP, REPORTED RATHER THAN WORKED AROUND — THE "EMAIL JOB" HALF OF `tellPerson` IS NOT
//     WIRED BY THIS FILE. Field 4: "email → notification + email job only". The only two
//     application-reachable ways to add a policed graphile-worker job are (a) `helpers.addJob(...)`
//     from INSIDE a `src/queue/tasks.mjs` `TOPIC_HANDLERS` listener, reached only via the outbox
//     drain — that file is not in this task's file list — or (b) `enqueue()`
//     (`src/queue/runner.mjs`), which [MEASURED, grep for `queue/runner.mjs"` across `src/` and
//     `db/`] has exactly ONE caller anywhere in the codebase today, `db/gates/p18_worker.mjs`, and
//     ZERO application callers. `src/settings/importCsv.mjs`'s own header hit this identical fork
//     (same two options, same measurement) and explicitly declined (b): "adding the first
//     application caller of either mechanism is a wiring decision bigger than this task's own file
//     list." This file follows that same precedent rather than quietly setting it: `tellPerson`
//     creates the `notification` row via `createNotification` (in-app, and push if the recipient has
//     a registered device token — `deliverableChannels`'s own rule) for BOTH the `person_preference`
//     and `email` settings; the email channel itself is not enqueued by this task. Flagged here, not
//     silently done and not silently skipped.
//
// ★★★ `route.section` REUSES `/items/services`, THE SAME REUSE `src/routes/itemsCatalogue.mjs`
//     ALREADY MAKES (its own header, same reasoning). [MEASURED] `src/nav/sections.mjs`'s
//     `ITEMS_CHILDREN` has no `/items/loyalty` row today, and that file is not in this task's list —
//     a section string `authoriseSection` cannot resolve refuses EVERY caller, including Owner
//     (`unknown_path`, fails closed), which would be worse than reusing an existing, already-open
//     items path until whichever task adds the loyalty screen's own nav row.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict, dependency } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
import { createNotification } from "../notifications/writes.mjs";
import { AppError, ErrorKind } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION_ITEMS = "items";

/** 0414's CHECK on `loyalty_rule.kind`, in the same order the migration declares it. */
const RULE_KINDS = Object.freeze(["per_dollar", "per_visit", "per_referral"]);

/**
 * ★★★ 14-OI-4 (CLOSED 25 Sep) — ALL THREE KINDS HAVE A NAMED WRITER, SO ALL THREE ARE LIVE SWITCHES.
 *     `loyaltySummary` returns a real writer for every kind (never `null`) so 14.61 can render three
 *     live toggles without a `writer: null` branch — see this task's own field text.
 */
const RULE_WRITERS = Object.freeze({
  per_visit: "14.27",     // this stage — the attended-session listener
  per_dollar: "15.66",    // Stage 15 — accrual on payment
  per_referral: "15.66",  // Stage 15 — SAME module/listener credits both legs (the coordinator's ruling)
});

/** 0414's CHECK on `loyalty_entry.reason` — the three this file may ever accrue. `claim`/`adjust`
 *  are deliberately absent: this task does not write either (see the file header). */
const REASON_KIND = Object.freeze({
  earn_payment: "per_dollar",
  earn_visit: "per_visit",
  earn_referral: "per_referral",
});

/** `loyalty.tell_channel`'s own `oneOf` (`src/settings/keys.mjs:466`). */
const TELL_CHANNELS = Object.freeze(["person_preference", "email", "text"]);

/**
 * The whole Loyalty screen in one read: the practice's switch, the figure strip, all three rules
 * (always, even unset — see RULE_WRITERS above), every reward with its lifetime claim count, and
 * the people who can claim something right now.
 *
 * ★ `figures.collecting` = distinct people with a positive balance, right now.
 * ★ `figures.collecting_delta_month` — NOT specified further by field 4's signature, so decided here
 *   and written down rather than left implicit (same posture `src/items/catalogue.mjs`'s
 *   `createUnit` takes for its own under-specified de-dup rule): the CURRENT collecting count minus
 *   the collecting count as it would have read 30 days ago, both derived from the SAME append-only
 *   ledger (a balance "as of" a past moment is just `SUM(points)` filtered to `created_at` before
 *   that moment — the ledger's whole point is that this is always answerable, never estimated).
 * ★ `figures.can_claim` = how many people are in `claimable` below (they can afford at least one
 *   active reward). `figures.claimed_total` = lifetime count of `reason = 'claim'` rows — a real
 *   redemption count is only ever an INSERT COUNT on an append-only ledger, never a running total.
 * ★ `claimable[].best_reward` = the priciest ACTIVE reward the person's current balance affords —
 *   "best" read as "most valuable they could walk away with", not "cheapest"/"soonest".
 */
export async function loyaltySummary(tx, { tenantId }) {
  const enabled = await getSetting(tx, "loyalty.enabled", false);

  const { rows: ruleRows } = await run(tx, db
    .selectFrom("keystone.loyalty_rule")
    .select(["kind", "points", "active"])
    .where("tenant_id", "=", tenantId));
  const ruleByKind = new Map(ruleRows.map((r) => [r.kind, r]));
  const rules = RULE_KINDS.map((kind) => {
    const row = ruleByKind.get(kind);
    return {
      kind,
      points: row ? row.points : null,
      active: row ? row.active : false,
      writer: RULE_WRITERS[kind],
    };
  });

  const { rows: rewardRows } = await tx.query(
    `SELECT r.id, r.name, r.points_cost, r.active,
            count(e.id) FILTER (WHERE e.reason = 'claim') AS claimed
       FROM keystone.loyalty_reward r
       LEFT JOIN keystone.loyalty_entry e
              ON e.tenant_id = r.tenant_id AND e.claimed_reward_id = r.id
      WHERE r.tenant_id = $1
      GROUP BY r.id, r.name, r.points_cost, r.active
      ORDER BY r.points_cost, r.name`,
    [tenantId]);
  const rewards = rewardRows.map((r) => ({
    id: r.id, name: r.name, points_cost: r.points_cost, active: r.active,
    claimed: Number(r.claimed),
  }));

  const { rows: claimableRows } = await tx.query(
    `WITH balances AS (
       SELECT app_user_id, sum(points) AS balance
         FROM keystone.loyalty_entry
        WHERE tenant_id = $1
        GROUP BY app_user_id
     )
     SELECT b.app_user_id, u.display_name, b.balance,
            br.id AS best_reward_id, br.name AS best_reward_name,
            br.points_cost AS best_reward_points_cost
       FROM balances b
       JOIN keystone.app_user u ON u.tenant_id = $1 AND u.id = b.app_user_id
       JOIN LATERAL (
              SELECT r.id, r.name, r.points_cost
                FROM keystone.loyalty_reward r
               WHERE r.tenant_id = $1 AND r.active = true AND r.points_cost <= b.balance
               ORDER BY r.points_cost DESC
               LIMIT 1
            ) br ON true
      WHERE b.balance > 0
      ORDER BY b.balance DESC, u.display_name`,
    [tenantId]);
  const claimable = claimableRows.map((r) => ({
    app_user_id: r.app_user_id,
    display_name: r.display_name,
    points: Number(r.balance),
    best_reward: { id: r.best_reward_id, name: r.best_reward_name, points_cost: r.best_reward_points_cost },
  }));

  const { rows: collectingRows } = await tx.query(
    `WITH now_balance AS (
       SELECT app_user_id, sum(points) AS bal
         FROM keystone.loyalty_entry WHERE tenant_id = $1 GROUP BY app_user_id
     ), month_ago_balance AS (
       SELECT app_user_id, sum(points) AS bal
         FROM keystone.loyalty_entry
        WHERE tenant_id = $1 AND created_at < now() - interval '30 days'
        GROUP BY app_user_id
     )
     SELECT (SELECT count(*) FROM now_balance WHERE bal > 0)       AS collecting,
            (SELECT count(*) FROM month_ago_balance WHERE bal > 0) AS collecting_month_ago`,
    [tenantId]);
  const collecting = Number(collectingRows[0].collecting);
  const collectingMonthAgo = Number(collectingRows[0].collecting_month_ago);

  const { rows: claimedRows } = await tx.query(
    `SELECT count(*) AS n FROM keystone.loyalty_entry WHERE tenant_id = $1 AND reason = 'claim'`,
    [tenantId]);

  return {
    enabled,
    figures: {
      collecting,
      collecting_delta_month: collecting - collectingMonthAgo,
      can_claim: claimable.length,
      claimed_total: Number(claimedRows[0].n),
    },
    rules,
    rewards,
    claimable,
  };
}

/** Upsert an earn rule — one row per (tenant, kind), `0414`'s own unique index. */
export async function setRule(tx, { tenantId, kind, points, active, actorUserId = null }) {
  if (!RULE_KINDS.includes(kind)) {
    throw invalid(`kind must be one of ${RULE_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  if (!Number.isInteger(points) || points <= 0) {
    throw invalid("points must be a positive whole number");
  }
  if (typeof active !== "boolean") throw invalid("active must be true or false");

  // ★ `actorUserId` is part of field 4's own signature but is not used below: no topic for a rule
  //   change is declared in `src/events/topics.mjs`'s `items` array (no `emit`), and no audit action
  //   is named by field 4 either. Accepted, not silently dropped from the signature, and not
  //   silently invented a use for.
  void actorUserId;

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const { rows } = await tx.query(
    `INSERT INTO keystone.loyalty_rule (id, tenant_id, kind, points, active)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET points = EXCLUDED.points, active = EXCLUDED.active, updated_at = now()
     RETURNING kind, points, active`,
    [id, tenantId, kind, points, active]);
  return { kind: rows[0].kind, points: rows[0].points, active: rows[0].active, writer: RULE_WRITERS[kind] };
}

/** Create a reward. No delete path this stage — same "toggled off, never deleted" shape 0414 gives
 *  the table (`active`, no DELETE grant). */
export async function createReward(tx, { tenantId, name, pointsCost }) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a reward needs a name");
  if (!Number.isInteger(pointsCost) || pointsCost <= 0) {
    throw invalid("pointsCost must be a positive whole number");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db
    .insertInto("keystone.loyalty_reward")
    .values({
      id,
      tenant_id: tenantId ?? null,
      name: name.trim() ?? null,
      points_cost: pointsCost ?? null,
      active: true,
    }));
  return { id, name: name.trim(), points_cost: pointsCost, active: true };
}

/** Partial update — rename, reprice, or toggle active. */
export async function updateReward(tx, { tenantId, id, name, pointsCost, active }) {
  const sets = [];
  const args = [tenantId, id];
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("a reward name cannot be blank");
    args.push(name.trim()); sets.push(`name = $${args.length}`);
  }
  if (pointsCost !== undefined) {
    if (!Number.isInteger(pointsCost) || pointsCost <= 0) {
      throw invalid("pointsCost must be a positive whole number");
    }
    args.push(pointsCost); sets.push(`points_cost = $${args.length}`);
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") throw invalid("active must be true or false");
    args.push(active); sets.push(`active = $${args.length}`);
  }
  if (sets.length === 0) throw invalid("nothing to update");

  const r = await tx.query(
    `UPDATE keystone.loyalty_reward SET ${sets.join(", ")}, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    args);
  // ★ Zero rows is 404, not success — under RLS a cross-tenant id looks exactly like a missing one.
  if (r.rowCount === 0) throw notFound("no such reward in this organisation");
  return { id };
}

/**
 * Earn points for one attended visit, one dollar spent, or one referral. A no-op — never an
 * error — when the programme is off or the rule for this kind is inactive: field 4's own words.
 *
 * ★ `sourceType`/`sourceId` are REQUIRED here (unlike the table's own nullable columns, which allow
 *   `adjust` rows to skip them): they are what makes `loyalty_entry_earns_once_key`
 *   (`UNIQUE (tenant_id, reason, source_type, source_id, app_user_id)`) actually do its job for an
 *   earn row. Without them every accrual for the same person and reason would collide on the SAME
 *   (NULL, NULL) pair and the second real earn would be silently swallowed as "already earned".
 * ★ `ON CONFLICT ... DO NOTHING` is what makes a REPLAYED event (the outbox's own retry story)
 *   absorbed rather than double-earned — field 4's own words, "an event earns once".
 */
export async function accrueLoyalty(tx, { tenantId, appUserId, reason, sourceType, sourceId, amountMinor = null }) {
  if (!appUserId) throw invalid("appUserId is required");
  const kind = REASON_KIND[reason];
  if (!kind) {
    throw invalid(`reason must be one of ${Object.keys(REASON_KIND).join(", ")} — got ${JSON.stringify(reason)}`);
  }
  if (typeof sourceType !== "string" || !sourceType.trim() || !sourceId) {
    throw invalid("sourceType and sourceId are required — they are what makes an event earn once");
  }

  const enabled = await getSetting(tx, "loyalty.enabled", false);
  if (!enabled) return { accrued: false, reason: "loyalty_disabled" };

  const { rows } = await run(tx, db
    .selectFrom("keystone.loyalty_rule")
    .select(["points", "active"])
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind));
  if (rows.length === 0 || rows[0].active !== true) {
    return { accrued: false, reason: "rule_inactive" };
  }

  let points;
  if (kind === "per_dollar") {
    if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor < 0) {
      throw invalid("amountMinor is required for a per_dollar accrual");
    }
    points = Math.floor(amountMinor / 100) * rows[0].points;
    // ★ Under a dollar earns zero whole-dollar points — a no-op, not a CHECK violation
    //   (`loyalty_entry_points_shape` requires points > 0 for an earn row).
    if (points <= 0) return { accrued: false, reason: "zero_points" };
  } else {
    points = rows[0].points;
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const { rows: inserted } = await tx.query(
    `INSERT INTO keystone.loyalty_entry (id, tenant_id, app_user_id, points, reason, source_type, source_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, reason, source_type, source_id, app_user_id) DO NOTHING
     RETURNING id`,
    [id, tenantId, appUserId, points, reason, sourceType, sourceId]);
  if (inserted.length === 0) {
    // ★ Absorbed by loyalty_entry_earns_once_key — a replayed event does not double-earn.
    return { accrued: false, reason: "already_earned" };
  }

  await emit(tx, {
    tenantId, topic: "items.loyalty.points_earned", emittedBy: SECTION_ITEMS,
    subjectType: "person", subjectId: appUserId,
    // ★ accrueLoyalty's own field-4 signature carries no `actorUserId` — every caller of this
    //   function today is an internal listener (14.27), never a person's own session.
    actor: userActor(null),
    payload: { app_user_id: appUserId, points, reason, source_type: sourceType, source_id: sourceId },
  });

  return { accrued: true, id: inserted[0].id, points };
}

/**
 * "Tell them" — one notification, once a week, per person. A second call inside 7 days is a 409
 * with the frame's own sentence, not a second notification.
 */
export async function tellPerson(tx, { tenantId, appUserId, actorUserId = null }) {
  if (!appUserId) throw invalid("appUserId is required");

  const { rows: personRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["first_name"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", appUserId));
  if (personRows.length === 0) throw notFound("no such person in this organisation");
  const firstName = personRows[0].first_name;

  const { rows: recentRows } = await tx.query(
    `SELECT created_at FROM keystone.event
      WHERE tenant_id = $1 AND topic = 'items.loyalty.told'
        AND subject_type = 'person' AND subject_id = $2
        AND created_at >= now() - interval '7 days'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, appUserId]);
  if (recentRows.length > 0) {
    const toldOn = new Date(recentRows[0].created_at).toISOString().slice(0, 10);
    throw conflict(`You told ${firstName} on ${toldOn} — give it a week.`);
  }

  const channel = await getSetting(tx, "loyalty.tell_channel", "person_preference");
  if (!TELL_CHANNELS.includes(channel)) {
    // ★ Defence in depth — `src/settings/keys.mjs`'s own `oneOf` validator already refuses this at
    //   write time; this file does not trust that alone, same posture every other reader of a closed
    //   setting takes.
    throw invalid(`loyalty.tell_channel is set to an unrecognised value ${JSON.stringify(channel)}`);
  }
  if (channel === "text") {
    throw dependency("Texting isn't set up yet.");
  }

  const ev = await emit(tx, {
    tenantId, topic: "items.loyalty.told", emittedBy: SECTION_ITEMS,
    subjectType: "person", subjectId: appUserId,
    actor: userActor(actorUserId),
    payload: { app_user_id: appUserId, channel },
  });

  // ★ `email`/`person_preference` both create the notification the same way here — see this file's
  //   header for why the email-job half of the distinction is not wired by this task.
  const { id: notificationId } = await createNotification(tx, {
    tenantId, recipientId: appUserId, eventId: ev.id,
    topic: "items.loyalty.told",
    title: "You have loyalty points ready to redeem",
  });

  return { id: notificationId, channel };
}

/**
 * "Tell them" for every currently-claimable person in one call. Not named by field 4's own
 * `Replaces` list — only the route `/tell-all` is — so this is the natural batch counterpart to
 * `tellPerson` built to give that route a function to call, and flagged as an inference rather than
 * a literal quote. One person already told this week is SKIPPED, not a failure for the whole batch
 * (their own individual 7-day lockout, not a tenant-wide one); any other error (the programme's
 * channel is `text`, for instance — one tenant-wide setting) aborts the whole call, matching what a
 * single `tellPerson` does for that same condition.
 */
export async function tellAllClaimable(tx, { tenantId, actorUserId = null }) {
  const { claimable } = await loyaltySummary(tx, { tenantId });
  const told = [];
  const skipped = [];
  for (const person of claimable) {
    try {
      const r = await tellPerson(tx, { tenantId, appUserId: person.app_user_id, actorUserId });
      told.push({ app_user_id: person.app_user_id, notification_id: r.id });
    } catch (e) {
      if (e instanceof AppError && e.kind === ErrorKind.CONFLICT) {
        skipped.push({ app_user_id: person.app_user_id, reason: "told_recently" });
        continue;
      }
      throw e;
    }
  }
  return { told, skipped };
}
