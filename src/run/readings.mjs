// @ts-check

/**
 * RUN READINGS — P20.6 (ingest + retention) and P20.6a (the metric series).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THE ONE RULE THIS MODULE EXISTS TO HOLD: **A MISSING ROW AND A FAILED ROW ARE DIFFERENT FACTS.**
 *     Same rule as `notification_delivery`. So `ok = false` rows are WRITTEN and KEPT, never skipped,
 *     and `run_reading` rows are NEVER DELETED — only their payload bytes are released.
 *   ★★ If a failed pull wrote nothing, then "we have no data for Tuesday" and "we tried on Tuesday and
 *      Google returned 403" would be the same state on the screen. They require different human
 *      actions — wait, versus go and fix a permission — so they must be different rows.
 *
 * ★★★ AND `ok` ALONE CANNOT CARRY IT (P20.9a): one bit collapses two independent probes — did the
 *     REQUEST succeed, and did it RETURN ANYTHING. A brand-new GA4 property answers 200 with zero rows
 *     and renders identically to a broken pull. Hence `failure_class`, `http_status` and `row_count`
 *     are all recorded, always, and `row_count` is recorded even on success.
 */

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ The closed set from 0057's CHECK, restated here so the caller gets a named error instead of a
 *    constraint violation at 3am. The DATABASE is still the authority; this is the courtesy. */
export const FAILURE_CLASSES = Object.freeze([
  "grant_unusable", "resource_forbidden", "rate_limited", "quota_exhausted",
  "provider_error", "malformed_response", "internal",
]);

const RUN_SERVICES = Object.freeze([
  "search_console", "google_ads", "analytics", "business_profile", "monitoring",
]);

/**
 * ★★ THE RETENTION WINDOW, IN ONE PLACE. 90 days, per P20.6: *"NULL the payload at 90 days and KEEP
 *    THE ROW FOREVER."* Exported so the prune task and the gate read the SAME number — a threshold
 *    written twice is a threshold that will disagree with itself.
 */
export const PAYLOAD_RETENTION_DAYS = 90;

/**
 * RECORD one pull — success or failure. This is the only writer of `run_reading`.
 *
 * ★★★ IT REFUSES TO WRITE A FAILURE WITH NO CLASS, and the database agrees (`run_reading_ok_shape`).
 *     An `ok=false` row whose reason is null is worse than no row: it occupies the screen saying
 *     "something went wrong" and cannot be acted on. The error message names the seven classes so the
 *     caller does not have to go and find them.
 *
 * ★★ AND IT REFUSES A SUCCESS WITH A NULL `row_count`. The constraint permits it (row_count is
 *    nullable) because a `monitoring` probe legitimately has no rows to count — but for the four
 *    Google services a success with no count is the exact ambiguity `row_count` was added to remove,
 *    so the caller must say `0` on purpose rather than by omission.
 */
export async function recordReading(tx, {
  tenantId, accountId, resourceId, service, item,
  ok, failureClass = null, httpStatus = null, error = null, providerResponse = null,
  durationMs = null, payload = null, rowCount = null,
}) {
  if (!tenantId) throw new Error("recordReading needs a tenantId");
  if (!accountId || !resourceId) throw new Error("recordReading needs an accountId and a resourceId");
  if (!RUN_SERVICES.includes(service)) {
    throw new Error(`recordReading: "${service}" is not one of ${RUN_SERVICES.join(", ")}`);
  }
  if (!item || !/^[a-z][a-z0-9_]*$/.test(item)) {
    throw new Error(
      `recordReading: item must match ^[a-z][a-z0-9_]*$ — got ${JSON.stringify(item)}. ★ The item is ` +
      `what separates "queries" from "pages" (both Search Console) and "reviews" from "posts" from ` +
      `"hours" (three different hosts at two API versions); without it "the newest row for this ` +
      `service" returns whichever ran last.`);
  }
  if (typeof ok !== "boolean") throw new Error("recordReading: ok must be a boolean");

  if (!ok) {
    if (!FAILURE_CLASSES.includes(failureClass)) {
      throw new Error(
        `recordReading: a FAILED reading needs a failureClass from ${FAILURE_CLASSES.join(" · ")} — ` +
        `got ${JSON.stringify(failureClass)}. ★ An ok=false row with no reason is worse than no row: ` +
        `it occupies the screen saying "something went wrong" and cannot be acted on.`);
    }
    // ★ 0057's run_reading_ok_shape requires payload IS NULL on a failure. Dropping it here rather
    //   than letting the constraint reject the insert means the CALLER is told, by name, that a
    //   partial body from a failed request is not evidence of anything.
    payload = null;
  } else {
    if (failureClass !== null) {
      throw new Error("recordReading: a SUCCESSFUL reading must not carry a failureClass");
    }
    if (service !== "monitoring" && (rowCount === null || rowCount === undefined)) {
      throw new Error(
        `recordReading: a successful ${service} reading must state rowCount, even when it is 0. ` +
        `★ ok=true with zero rows is NOT a failure and a chart cannot tell the difference — a ` +
        `brand-new GA4 property renders identically to a broken pull. Say 0 on purpose.`);
    }
  }

  const payloadBytes = payload === null ? null : Buffer.byteLength(JSON.stringify(payload), "utf8");

  const { rows } = await run(tx, db
    .insertInto("keystone.run_reading")
    .values({
      tenant_id: tenantId ?? null,
      account_id: accountId ?? null,
      resource_id: resourceId ?? null,
      service: service ?? null,
      item: item ?? null,
      fetched_at: sql`now()`,
      ok: ok ?? null,
      failure_class: failureClass ?? null,
      http_status: httpStatus ?? null,
      error: error ?? null,
      provider_response: providerResponse ?? null,
      duration_ms: durationMs ?? null,
      payload: payload ?? null,
      payload_bytes: payloadBytes ?? null,
      row_count: rowCount ?? null,
    })
    .returning(["id", "fetched_at", "ok"]));

  return Object.freeze({ id: rows[0].id, fetchedAt: rows[0].fetched_at, ok: rows[0].ok });
}

/**
 * UPSERT the metric series for one reading. P20.6a.
 *
 * ★★★ UPSERT, NOT INSERT, AND THE REASON IS GOOGLE'S BEHAVIOUR, NOT OUR CONVENIENCE. Google RESTATES
 *     the last 2–4 days: Search Console serves preliminary figures then finalises them, GA4 has a
 *     24–48h processing window, and Ads conversions arrive late. So the SAME (metric, day) is pulled
 *     again with a DIFFERENT value, legitimately. An insert-only table would keep both and every chart
 *     would be quietly 2× — and a chart that is silently doubled is worse than one that is blank,
 *     because nobody checks a number that looks plausible.
 *
 * ★★ `reading_id` IS UPDATED TOO, so the row always names the pull that produced its CURRENT value.
 *    Leaving the original would make a corrected number traceable to the response that carried the
 *    WRONG one, which is worse than no traceability at all.
 */
export async function upsertMetrics(tx, { tenantId, accountId, service, readingId, metrics }) {
  if (!tenantId) throw new Error("upsertMetrics needs a tenantId");
  if (!readingId) {
    throw new Error(
      "upsertMetrics needs a readingId. ★ 0057 makes it a RESTRICT FK on purpose: a metric with no " +
      "reading to point at is exactly the untraceable number the table exists to prevent.");
  }
  if (!Array.isArray(metrics)) throw new Error("upsertMetrics needs a metrics array");

  let inserted = 0, corrected = 0;
  for (const m of metrics) {
    if (!/^[a-z][a-z0-9_]*$/.test(m.metric ?? "")) {
      throw new Error(`upsertMetrics: metric must match ^[a-z][a-z0-9_]*$ — got ${JSON.stringify(m.metric)}`);
    }
    const { rows } = await tx.query(
      `INSERT INTO keystone.run_metric
         (tenant_id, account_id, service, metric, day, value, reading_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, account_id, service, metric, day) DO UPDATE
          SET value = EXCLUDED.value, reading_id = EXCLUDED.reading_id
       RETURNING (xmax = 0) AS was_insert`,
      [tenantId, accountId, service, m.metric, m.day, m.value, readingId]);
    // ★ `xmax = 0` distinguishes an INSERT from an UPDATE in an upsert's RETURNING. Reported
    //   separately because "we ingested 30 new days" and "Google restated 3 days we already had" are
    //   different facts, and a single count would hide the restatement entirely.
    rows[0].was_insert ? inserted++ : corrected++;
  }
  return Object.freeze({ inserted, corrected });
}

/**
 * PRUNE payload bytes. P20.6's retention rule.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ IT NULLS THE PAYLOAD. IT NEVER DELETES A ROW. P20.6, verbatim: *"NULL the payload at 90 days
 *     and KEEP THE ROW FOREVER. The row IS the 'did it actually read' fact and survives deleting the
 *     bytes. NEVER DELETE a run_reading row — deleting it destroys the very distinction the table
 *     exists for."*
 *   ★★ AND IT ONLY TOUCHES SUCCESSES, which 0057's `run_reading_prune_shape` also enforces
 *      (`payload_pruned_at IS NULL OR (payload IS NULL AND ok = true)`). A failure has no payload to
 *      prune anyway — but more importantly, `provider_response` on a failure is the provider's own
 *      words about what went wrong, and that is the whole value of the row. Pruning a failure would
 *      destroy the only record of why.
 *   ★ `payload_pruned_at` is what makes retention a FACT rather than an inference: without it, a NULL
 *     payload on an old success and a NULL payload on a fresh failure are indistinguishable.
 */
export async function prunePayloads(tx, { tenantId, olderThanDays = PAYLOAD_RETENTION_DAYS } = {}) {
  if (!tenantId) throw new Error("prunePayloads needs a tenantId");
  const { rows } = await tx.query(
    `UPDATE keystone.run_reading
        SET payload = NULL, payload_pruned_at = now()
      WHERE tenant_id = $1
        AND ok = true
        AND payload IS NOT NULL
        AND fetched_at < now() - ($2 || ' days')::interval
      RETURNING id, payload_bytes`,
    [tenantId, String(olderThanDays)]);
  // ★ `payload_bytes` SURVIVES the prune — the row still knows how big the body was, which is how
  //   "we read 40 MB that month" stays answerable after the bytes are gone.
  const bytesReleased = rows.reduce((n, r) => n + (r.payload_bytes ?? 0), 0);
  return Object.freeze({ pruned: rows.length, bytesReleased });
}

/**
 * THE NEWEST READING for one (account, service, item) — what the Run screen shows.
 *
 * ★★★ IT RETURNS THE NEWEST **SUCCESS** AND THE NEWEST **ATTEMPT** SEPARATELY, and that is P20.8's
 *     whole requirement: *"Degrade to the last good reading WITH ITS AGE SHOWN."* A single "newest
 *     row" would show a failure and the screen would have nothing to display; a single "newest
 *     success" would hide that the last three attempts failed. The screen needs both to say
 *     "here is Tuesday's data, and we have not managed to read since".
 */
export async function newestReading(tx, { tenantId, accountId, service, item }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT ON (ok) id, ok, fetched_at, failure_class, http_status, error,
            row_count, payload, payload_pruned_at
       FROM keystone.run_reading
      WHERE tenant_id = $1 AND account_id = $2 AND service = $3 AND item = $4
      ORDER BY ok, fetched_at DESC`,
    [tenantId, accountId, service, item]);
  const lastSuccess = rows.find((r) => r.ok === true) ?? null;
  const lastFailure = rows.find((r) => r.ok === false) ?? null;
  return Object.freeze({
    lastSuccess, lastFailure,
    // ★ The age is computed HERE, from the row, rather than left to the component — P20.8 requires the
    //   age to be SHOWN, and a screen that has to compute it is a screen that can forget to.
    lastSuccessAgeMs: lastSuccess ? Date.now() - new Date(lastSuccess.fetched_at).getTime() : null,
    isDegraded: Boolean(lastFailure && lastSuccess &&
      new Date(lastFailure.fetched_at) > new Date(lastSuccess.fetched_at)),
    hasNeverSucceeded: lastSuccess === null,
  });
}
