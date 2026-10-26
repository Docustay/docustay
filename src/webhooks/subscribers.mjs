// @ts-check
// P8.5 — WHO SUBSCRIBES TO A TOPIC, AND THE JOB THAT DELIVERS TO THEM.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ `deliverEvent` (`outbound.mjs:101`) WAS COMPLETE AND HAD ZERO IMPORTERS IN `src/`. It signs,
//     records the attempt BEFORE the network call, bounds the body excerpt, distinguishes a timeout
//     from a failure, and updates the row — a careful piece of work that nothing could ever call.
//     **No job read `webhook_endpoint` by topic, and no route could create one.** This module is
//     the missing half: the subscription query and the job.
//
// ★★★ ONCE ENDPOINTS CAN SUBSCRIBE, n8n IS A URL — AND SO IS ZAPIER, AND SO IS A TENANT'S OWN
//     ENDPOINT. That is KS-14's ruling ("another consumer of the existing outbox") and the reason
//     the subscriber is worth more than the integration it was requested for.
//
// ★★★ THE `pool` HANDED TO `deliverEvent` IS A PER-STATEMENT SHIM, AND THAT IS THE WHOLE TRICK.
//     `deliverEvent` wants to commit the attempt row BEFORE the HTTP call so a process that dies
//     mid-flight leaves evidence. But `withTenant` sets the tenant GUC with **SET LOCAL**
//     (`src/db/index.mjs:6`), which is bound to the transaction — so committing inside it would
//     drop the tenant context and every subsequent statement would fail RLS.
//   ★★ So each statement gets its OWN `withTenant`, which commits on its own. The INSERT is durable
//      the moment it returns, the fetch happens inside NO transaction at all, and the UPDATE is its
//      own transaction too. Three short transactions instead of one long one holding locks across a
//      15-second network timeout.
//   ★ `commit` is therefore not passed: there is nothing left to commit. Passing a `tx` instead
//     would have put the fetch inside a transaction AND lost the durability property the function
//     was built for — the two failures this shim exists to avoid.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { enrichEvent } from "./enrich.mjs";
import { deliverEvent, SAMPLE_REFUSAL, STALE_ATTEMPT_SECONDS } from "./outbound.mjs";
import { RETRY_SCHEDULE_SECONDS, LISTENER_MAX_ATTEMPTS } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * The ACTIVE endpoints in this tenant that asked for this topic.
 * ★★ `status = 'active'` only. A `paused` endpoint is a deliberate human act and a `disabled` one
 *    was switched off by the failure counter; delivering to either would undo the decision that
 *    stopped it.
 * ★ `event_types` is an exact-match `text[]` — the schema's CHECK requires whole three-part topics,
 *   so there is no wildcard to interpret and no chance of a prefix matching more than it means.
 */
export async function subscribersFor(tx, { tenantId, topic }) {
  const { rows } = await tx.query(
    `SELECT id, url, name, event_types, secret_envelope, secret_fingerprint, kek_version, status, previous_secret_envelope, previous_secret_expires_at
       FROM keystone.webhook_endpoint
      WHERE tenant_id = $1 AND status = 'active' AND $2 = ANY (event_types)
      ORDER BY created_at`,
    [tenantId, topic]);
  return rows;
}

/** ★ Cheap existence check for the outbox drain — it must not build rows it will not use. */
export async function hasSubscribers(tx, { tenantId, topic }) {
  const { rows } = await tx.query(
    `SELECT 1 FROM keystone.webhook_endpoint
      WHERE tenant_id = $1 AND status = 'active' AND $2 = ANY (event_types) LIMIT 1`,
    [tenantId, topic]);
  return rows.length > 0;
}

/**
 * ★★ THE BODY IS THE EVENT AS THE OUTBOX RECORDED IT, not a re-shaping. A receiver that has to
 *    guess which of our internal shapes it is looking at cannot write a stable integration, and the
 *    signature covers these exact bytes — so whatever is serialised here IS what was signed.
 */
export const eventBody = (event) => JSON.stringify({
  id: event.id,
  topic: event.topic,
  subject_type: event.subject_type ?? null,
  subject_id: event.subject_id ?? null,
  payload: event.payload ?? {},
  emitted_at: event.created_at ?? null,
});

/**
 * Deliver one event to every active subscriber.
 * ★★★ SAFE TO RUN TWICE (spec 02 §2.6, Task 5 review F1): `deliverEvent` inserts an attempt — and so
 *     POSTs — only for an endpoint with no attempt yet for this event (or a retry that is due). A re-run
 *     after a rolled-back dispatch, or a duplicate job, is `skipped` for every endpoint already delivered.
 * ★★★ SAMPLE EVENTS (spec 02 §2.9, Stage 3 Task 8): an event with `sample = true` never reaches an endpoint.
 *     The dispatcher already skips the `webhooks` listener for one; this is the SEND END, for a job that
 *     exists anyway (enqueued before the flag was honoured, or by hand). `sample` is read WITH the event and
 *     every endpoint is reported `skipped` — no attempt row, no POST. `retryDueDeliveries` and `deliverEvent`
 *     each refuse it again.
 * @returns {Promise<Array>} one result per endpoint
 */
export async function deliverEventToSubscribers({ tenantId, eventId }, { fetchImpl } = {}) {
  // ── phase 1 · read, in its own transaction ──────────────────────────────────────────────────
  const { event, endpoints } = await withTenant(tenantId, async (tx) => {
    const ev = (await run(tx, db
      .selectFrom("keystone.event")
      .select(["id", "topic", "subject_type", "subject_id", "payload", "created_at", "sample"])
      .where("id", "=", eventId))).rows[0] ?? null;
    if (!ev) return { event: null, endpoints: [] };
    return { event: await enrichEvent(tx, ev), endpoints: await subscribersFor(tx, { tenantId, topic: ev.topic }) };
  });

  if (!event) {
    // ★ Reported, not thrown. An event that is gone is a retention outcome, and throwing would make
    //   the queue retry a job that can never succeed.
    return [{ outcome: "skipped", reason: "the event no longer exists in this tenant" }];
  }
  if (endpoints.length === 0) return [];
  if (event.sample !== false) {
    return endpoints.map((e) => ({ endpointId: e.id, outcome: "skipped", reason: SAMPLE_REFUSAL }));
  }

  const body = eventBody(event);
  // ★★ ONE TRANSACTION PER STATEMENT — see the header. This is what lets `deliverEvent` record the
  //    attempt durably and then make a network call with no transaction open.
  const pool = { query: (text, params) => withTenant(tenantId, (tx) => tx.query(text, params)) };

  const results = [];
  for (const endpoint of endpoints) {
    try {
      results.push(await deliverEvent(
        { pool, tenantId, endpoint, event, body },
        fetchImpl ? { fetchImpl } : {}));
    } catch (e) {
      // ★★ ONE ENDPOINT'S FAILURE IS NOT ANOTHER'S. A tenant with three subscribers must not lose
      //    two deliveries because the first one's secret could not be opened.
      results.push({ endpointId: endpoint.id, outcome: "failed", error: `${e.name}: ${e.message}` });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 7 — RETRIES THAT ACTUALLY HAPPEN. Before this, `webhook_delivery.next_retry_at` was
//     never read or written (recon §5): a failed POST was retried zero times. `deliverEvent` now records
//     the next retry on 07's schedule; THIS reads it. It runs as the per-practice `retry_webhooks` job
//     that `sweep_tenants` enqueues every 60 s — under that practice's tenant context, one practice per job.
//   ★★ The retry goes through `deliverEvent`, the same sender as the first attempt: same https-only
//      endpoint (schema CHECK on url and request_url), same 15 s timeout, same guard against a second POST.
//   ★ Only ACTIVE endpoints still subscribed to the topic are retried. A paused endpoint's due retry stays
//     due and is sent when the owner resumes it (spec 02: "No event is ever deleted by pausing").
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ★★ Fix round 1 — two kinds of row used to sit outside the sweep forever. Before selecting, each sweep:
//   · REAPS abandoned attempts (T7 concern 2): an `attempted` row older than STALE_ATTEMPT_SECONDS belongs to
//     a worker that died mid-send (a live send is aborted at DELIVERY_TIMEOUT_MS). It becomes `failed`
//     ("worker_lost") and is scheduled from the moment it was attempted — attempted_at + the 07 wait — or
//     `dead` at the last attempt. ★ Fix round 2 — WHAT ACTUALLY BOUNDS OVERLAP: the unique attempt key does
//     NOT stop the retry (attempt n+1) while the old attempt n is still sending — they are different keys.
//     The bound is time: a live send is aborted at DELIVERY_TIMEOUT_MS (15 s) and a row is reaped only after
//     STALE_ATTEMPT_SECONDS (300 s), so a sender that is still alive has long finished its POST before its
//     row can be reaped. What the unique key does stop is two senders both claiming attempt n+1. And the
//     outcome UPDATE in deliverEvent only applies to a row still `attempted`, so a very late answer from
//     the old sender cannot overwrite the reaped outcome.
//   · CLOSES orphaned retries (T7-R2): a pending retry whose endpoint is DISABLED, or no longer subscribes to
//     the topic, gets `closed_reason` and loses its next_retry_at — visible on the row, never retried, and
//     not `dead`, so no job.gave_up: a person's decision is not a failure. PAUSED stays due.
// ★ And a time budget (T7-R3): the sweep stops STARTING sends once `deadline` has passed.
export async function retryDueDeliveries({ tenantId, limit = 50, deadline = null }, { fetchImpl } = {}) {
  const housekeeping = await withTenant(tenantId, async (tx) => {
    const reaped = (await tx.query(
      `UPDATE keystone.webhook_delivery
          SET status = 'failed', completed_at = now(),
              error = 'worker_lost: no outcome was recorded; the attempt was abandoned mid-send',
              next_retry_at = CASE WHEN attempt < $3
                                   THEN attempted_at + make_interval(secs => ($4::int[])[attempt]) END,
              dead_at = CASE WHEN attempt >= $3 THEN now() END
        WHERE tenant_id = $1 AND status = 'attempted' AND attempted_at < now() - make_interval(secs => $2)
        RETURNING id`,
      [tenantId, STALE_ATTEMPT_SECONDS, LISTENER_MAX_ATTEMPTS, [...RETRY_SCHEDULE_SECONDS]])).rowCount;
    const closed = (await tx.query(
      `UPDATE keystone.webhook_delivery d
          SET next_retry_at = NULL,
              closed_reason = CASE WHEN w.status = 'disabled' THEN 'endpoint_disabled' ELSE 'unsubscribed' END
         FROM keystone.webhook_endpoint w, keystone.event ev
        WHERE d.tenant_id = $1 AND d.next_retry_at IS NOT NULL AND d.status IN ('failed','timed_out')
          AND w.id = d.endpoint_id AND w.tenant_id = d.tenant_id
          AND ev.id = d.event_id AND ev.tenant_id = d.tenant_id
          AND (w.status = 'disabled' OR NOT (ev.topic = ANY (w.event_types)))
        RETURNING d.id`, [tenantId])).rowCount;
    return { reaped, closed };
  });

  const due = await withTenant(tenantId, async (tx) => (await tx.query(
    `SELECT d.event_id, d.endpoint_id
       FROM keystone.webhook_delivery d
       JOIN keystone.webhook_endpoint w ON w.id = d.endpoint_id AND w.tenant_id = d.tenant_id
       JOIN keystone.event ev ON ev.id = d.event_id AND ev.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.status IN ('failed','timed_out')   -- ★ 0047's webhook_delivery_retry_idx
        AND d.next_retry_at IS NOT NULL AND d.next_retry_at <= now()
        AND w.status = 'active' AND ev.topic = ANY (w.event_types)
        AND NOT ev.sample            -- ★ Task 8: a sample event's retry is never sent (02 §2.9)
      ORDER BY d.next_retry_at
      LIMIT $2`, [tenantId, limit])).rows);
  const results = [];
  results.housekeeping = housekeeping;
  results.full = due.length === limit;
  if (due.length === 0) return results;

  const pool = { query: (text, params) => withTenant(tenantId, (tx) => tx.query(text, params)) };
  for (const { event_id: eventId, endpoint_id: endpointId } of due) {
    if (deadline && Date.now() > deadline) { results.full = false; results.outOfTime = true; break; }
    try {
      const { event, endpoint } = await withTenant(tenantId, async (tx) => ({
        event: await enrichEvent(tx, (await run(tx, db
          .selectFrom("keystone.event")
          .select(["id", "topic", "subject_type", "subject_id", "payload", "created_at", "sample"])
          .where("tenant_id", "=", tenantId)
          .where("id", "=", eventId))).rows[0] ?? null),
        endpoint: (await tx.query(
          `SELECT id, url, name, event_types, secret_envelope, secret_fingerprint, kek_version, status, previous_secret_envelope, previous_secret_expires_at
             FROM keystone.webhook_endpoint WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
          [tenantId, endpointId])).rows[0] ?? null,
      }));
      if (!event || !endpoint) {
        results.push({ endpointId, eventId, outcome: "skipped", reason: "event or active endpoint no longer exists" });
        continue;
      }
      if (event.sample !== false) {
        results.push({ endpointId, eventId, outcome: "skipped", reason: SAMPLE_REFUSAL });
        continue;
      }
      // ★ The body is rebuilt from the stored event — the same bytes as every earlier attempt.
      results.push({ eventId, ...(await deliverEvent(
        { pool, tenantId, endpoint, event, body: eventBody(event) }, fetchImpl ? { fetchImpl } : {})) });
    } catch (e) {
      results.push({ endpointId, eventId, outcome: "failed", error: `${e.name}: ${e.message}` });
    }
  }
  return results;
}

/** ★ Bounded, like event_delivery's (0142): a report that always fails is tried this many times. */
export const WEBHOOK_GAVE_UP_REPORT_MAX_ATTEMPTS = 5;

/** Dead (event, endpoint) pairs whose job.gave_up has not been written yet. */
export async function unreportedDeadWebhooks(tx, { tenantId, limit = 100 }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.webhook_delivery")
    .select(["id", "event_id", "endpoint_id", "attempt"])
    .where("tenant_id", "=", tenantId)
    .where("dead_at", "is not", null)
    .where("gave_up_reported_at", "is", null)
    .where("gave_up_report_attempts", "<", WEBHOOK_GAVE_UP_REPORT_MAX_ATTEMPTS)
    .orderBy("gave_up_report_attempts", "asc")
    .orderBy("dead_at", "asc")
    .limit(limit));
  return rows;
}

export async function markWebhookGaveUpReported(tx, { tenantId, deliveryIds }) {
  if (!deliveryIds.length) return;
  await tx.query(
    `UPDATE keystone.webhook_delivery SET gave_up_reported_at = now()
      WHERE tenant_id = $1 AND id = ANY ($2::uuid[]) AND gave_up_reported_at IS NULL`, [tenantId, deliveryIds]);
}

export async function recordWebhookGaveUpReportFailures(tx, { tenantId, deliveryIds }) {
  if (!deliveryIds.length) return [];
  const { rows } = await tx.query(
    `UPDATE keystone.webhook_delivery SET gave_up_report_attempts = gave_up_report_attempts + 1
      WHERE tenant_id = $1 AND id = ANY ($2::uuid[])
      RETURNING id, event_id, endpoint_id, gave_up_report_attempts`, [tenantId, deliveryIds]);
  return rows;
}


// ══════════════════════════════════════════════════════════════
// ★★★ §25.5 — REPLAY ONE DELIVERY, BY A PERSON'S CLICK. Creates a NEW attempt row (replay_of = the original, replayed_by = who clicked) and sends the SAME event body to the SAME
//   endpoint with fresh signatures. It is the only path allowed past the "already delivered" guard; automatic sends and retries never use it. A replay never schedules a retry, never marks the pair dead and
//   never counts toward disabling the endpoint. The endpoint must be active and still subscribed to the topic, and a sample event is never sent.
// ══════════════════════════════════════════════════════════════
export async function replayDelivery({ tenantId, deliveryId, actorUserId }, { fetchImpl } = {}) {
  const found = await withTenant(tenantId, async (tx) => {
    const d = (await tx.query(`SELECT id, endpoint_id, event_id FROM keystone.webhook_delivery WHERE id = $1 AND tenant_id = $2`, [deliveryId, tenantId])).rows[0];
    if (!d) return { error: "no such delivery" };
    const endpoint = (await tx.query(`SELECT * FROM keystone.webhook_endpoint WHERE id = $1 AND tenant_id = $2`, [d.endpoint_id, tenantId])).rows[0];
    if (!endpoint) return { error: "its endpoint no longer exists" };
    if (endpoint.status !== "active") return { error: `the endpoint is ${endpoint.status} — turn it back on before replaying` };
    const event = (await tx.query(`SELECT id, topic, subject_type, subject_id, payload, created_at, sample FROM keystone.event WHERE id = $1 AND tenant_id = $2`, [d.event_id, tenantId])).rows[0];
    if (!event) return { error: "the event is no longer kept" };
    if (!endpoint.event_types.includes(event.topic)) return { error: "the endpoint no longer subscribes to this event" };
    return { d, endpoint, event: await enrichEvent(tx, event) };
  });
  if (found.error) return { outcome: "refused", reason: found.error };
  const pool = { query: (text, params) => withTenant(tenantId, (tx) => tx.query(text, params)) };
  const out = await deliverEvent(
    { pool, tenantId, endpoint: found.endpoint, event: found.event, body: eventBody(found.event), replay: { of: found.d.id, by: actorUserId ?? null } },
    fetchImpl ? { fetchImpl } : {});
  return out;
}
