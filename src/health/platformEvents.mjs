// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 6 — PLATFORM EVENTS (spec 02 §2 rule 11, §5 platform). Facts about the platform
//     itself — a health check failing or recovering, a backup verified or failed, a job giving up —
//     belong to NO practice, and `keystone.event.tenant_id` is NOT NULL (0016:22), so they had nowhere
//     to live. Migration 0138 gives them `keystone_meta.platform_event`.
//
//   ★★ WRITTEN ONLY THROUGH `keystone_meta.record_platform_event()` — a SECURITY DEFINER function with
//      EXECUTE to app_worker alone. app_worker keeps ZERO table rights (p21a_role_matrix); app_rw can
//      neither write nor read the table (a practice's staff must never see platform facts).
//   ★★ READ ONLY THROUGH `keystone.platform_list_platform_events()`, gated in SQL on
//      `keystone.caller_is_platform()` exactly like `platform_list_tenants()` (0018): any other tenant
//      context gets zero rows.
//   ★★ FACTS OBEY THE EVENT PAYLOAD RULE (§2.4/§12) — the SAME validator `emit()` uses, IMPORTED, not
//      copied: two copies of a privacy rule are two opinions that drift.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { assertSafePayload, safeFacts, TopicViolation } from "../events/outbox.mjs";

/** ★ The fixed list — identical to `platform_event_kind_check` (0138; 'job.reaper_stopped' added by 0149, R61b). */
export const PLATFORM_EVENT_KINDS = Object.freeze([
  "health.check_failed", "health.check_recovered", "backup.verified", "backup.failed", "job.gave_up",
  "job.reaper_stopped",
]);

// ★ A subject is an enum-shaped token (`check:outbox`, `backup_run:42`, `listener:notifications`) —
//   the same shape 0138's `platform_event_subject_check` enforces. Never free text.
const SUBJECT_SHAPE = /^[A-Za-z0-9_.:-]{1,100}$/;

/**
 * Record one platform fact. `query` is `(sql, args) => Promise<{rows}>` on an app_worker connection
 * (or any connection holding EXECUTE on the writer). Validates BEFORE the round trip so a caller gets
 * a message naming what is wrong rather than a bare constraint violation.
 * @returns {Promise<string>} the new row's id
 */
export async function recordPlatformEvent(query, { kind, subject, facts = {} }) {
  if (!PLATFORM_EVENT_KINDS.includes(kind)) {
    throw new TopicViolation(`platform_event kind "${kind}" is not one of ${PLATFORM_EVENT_KINDS.join(", ")}`);
  }
  if (typeof subject !== "string" || !SUBJECT_SHAPE.test(subject)) {
    throw new TopicViolation(
      `platform_event subject ${JSON.stringify(subject)} must be an enum-shaped token like "check:outbox" — never free text`);
  }
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) {
    throw new TopicViolation("platform_event facts must be an object");
  }
  assertSafePayload(facts, "facts");
  const { rows } = await query(
    "SELECT keystone_meta.record_platform_event($1, $2, $3::jsonb) AS id",
    [kind, subject, JSON.stringify(facts)]);
  return String(rows[0].id);
}

/**
 * ★ `job.gave_up` — a listener has reached `dead` (spec 02 §2 rule 8). Written by the outbox
 *   dispatcher (Stage 3 Task 5); exported here so that task calls ONE writer, not its own INSERT.
 *   Ids and counts only: the tenant and event the listener gave up on, and how many attempts it made.
 */
export function recordJobGaveUp(query, { tenantId, eventId, listener, attempts }) {
  return recordPlatformEvent(query, {
    kind: "job.gave_up",
    subject: `listener:${listener}`,
    facts: { tenant_id: tenantId, event_id: eventId, listener, attempts },
  });
}

/**
 * ★ `job.gave_up` for an OUTBOUND WEBHOOK — one (event, endpoint) pair failed its sixth attempt (Stage 3
 *   Task 7; spec 02 §2 rule 8, 07 §3). The subject is the ENDPOINT, not the `webhooks` listener: one event
 *   can die at two endpoints, and 0142's once-only index is on (subject, event_id), so this is what makes
 *   it once per pair. Ids and counts only — never the endpoint's URL.
 */
export function recordWebhookGaveUp(query, { tenantId, eventId, endpointId, attempts }) {
  return recordPlatformEvent(query, {
    kind: "job.gave_up",
    subject: `webhook_endpoint:${endpointId}`,
    facts: { tenant_id: tenantId, event_id: eventId, endpoint_id: endpointId, listener: "webhooks", attempts },
  });
}

/** ★ R61b — the reasons reap_orphan_jobs' circuit breaker can trip for (enum; the queue check words them). */
export const REAPER_STOP_REASONS = Object.freeze({
  lister_empty: "the active-practice lister returned no practices at all",
  exists_disagrees: "the existence read disagrees with the active-practice lister",
  activity_disagrees: "the activity read disagrees with the active-practice lister",
});

/**
 * ★★ R61b (Stage 4 Task 1 fix round 2, 0149) — the orphan-job reaper's circuit breaker tripped: it removed
 *   nothing and closed nothing. The queue check reads these back (keystone_meta.reaper_stop_health) and is
 *   'problem' while one is under 5 minutes old. Reason as an enum and counts only — never a practice id.
 */
export function recordReaperStopped(query, { reason, wouldRemove, wouldClose, disagreeing }) {
  if (!Object.hasOwn(REAPER_STOP_REASONS, reason)) {
    throw new TopicViolation(`reaper stop reason "${reason}" is not one of ${Object.keys(REAPER_STOP_REASONS).join(", ")}`);
  }
  return recordPlatformEvent(query, {
    kind: "job.reaper_stopped",
    subject: "job:reap_orphan_jobs",
    facts: { reason, would_remove: wouldRemove, would_close: wouldClose, disagreeing },
  });
}

/**
 * ★ Health transitions → platform facts. `transition` is what `keystone_meta.alert_transition()`
 *   returned: only a NEW problem (`alert`) and a recovery (`recovered`) are facts; a reminder
 *   (`repeat`) and `quiet` are not — a problem that is still a problem did not happen again.
 * @returns {Promise<string|null>} the new row's id, or null when this transition is not a fact
 */
export function recordHealthTransition(query, check, transition) {
  const kind = transition === "alert" ? "health.check_failed"
    : transition === "recovered" ? "health.check_recovered" : null;
  if (!kind) return Promise.resolve(null);
  return recordPlatformEvent(query, { kind, subject: `check:${check.key}`, facts: { check: check.key, state: check.state } });
}

/**
 * The operator's list, newest first. `db.query` on app_rw INSIDE a tenant context — the lister
 * returns rows only when that context is the platform tenant (the gate is in SQL, not here).
 * ★ `safeFacts` on the way out as well: belt and braces over whatever wrote the row.
 */
export async function listPlatformEvents(db, { limit = 50 } = {}) {
  const { rows } = await db.query(
    "SELECT id, kind, subject, facts, created_at FROM keystone.platform_list_platform_events($1)",
    [Math.max(1, Math.min(500, Number(limit) || 50))]);
  return rows.map((r) => ({ ...r, id: String(r.id), facts: safeFacts(r.facts) }));
}
