// Task 20.17 — POST /api/automations/callback: n8n automation callback endpoint.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE STANDING RULING — TENANT TOGGLE IS ENFORCED HERE, SERVER-SIDE.
//     An n8n outage or a bypassed workflow must NEVER be able to send for a switched-off practice.
//     This endpoint checks tenant_setting BEFORE any notification is sent.
//
// Task 20.18 — RESERVED KEY: `platform.n8n_error` is INTERNAL — NO TENANT TOGGLE.
//     An n8n failure alert carries NO TENANT DATA: workflow name, run id, TRUNCATED error message only.
//     A body with no tenantId SUCCEEDS for this key alone. The positive control is that any NORMAL key
//     with no tenantId returns 400. Operator notification + one loud log line; never silent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from "node:crypto";
import { withTenant, withCredentialLookup } from "../db/index.mjs";
import { runCallbackAutomation } from "../automations/engine.mjs";
import { emit } from "../events/outbox.mjs";
import { invalid, forbidden, dependency } from "../http/errors.mjs";
import { requireIdempotencyKey, withIdempotency } from "../http/idempotency.mjs";
import { getSetting } from "../settings/writes.mjs";

// ★ R2 report item (26 Sep 2026) — the payload shape `assertSafePayload` (src/events/outbox.mjs)
//   enforces for an enum-shaped string: letters, digits, underscore, dot, colon, hyphen, 1-64 chars.
//   `run_id` is dropped from the payload rather than reshaped/truncated when it does not match —
//   never smuggled through as free text.
const RUN_ID_ENUM_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Verify n8n service credential using constant-time comparison.
 * ★ NEVER PRINT THE SECRET VALUE. Names and paths only.
 */
function verifyServiceCredential(presented, expected) {
  if (!presented || !expected) return false;
  const pBuf = Buffer.from(String(presented));
  const eBuf = Buffer.from(String(expected));
  return pBuf.length === eBuf.length && timingSafeEqual(pBuf, eBuf);
}

/**
 * Get the n8n service secret. Fetched from process.env.KEYSTONE_N8N_SERVICE_SECRET.
 * ★ NEVER PRINT THE SECRET VALUE. Names and paths only.
 */
function getN8nServiceSecret() {
  const secret = process.env.KEYSTONE_N8N_SERVICE_SECRET;
  if (!secret) {
    throw new Error("KEYSTONE_N8N_SERVICE_SECRET is not configured");
  }
  return secret;
}

/**
 * Validate the callback request body shape.
 * ★★★ For the reserved key `platform.n8n_error`, tenantId is OPTIONAL (internal, no tenant).
 *     For normal keys, tenantId is REQUIRED.
 */
function validateCallbackBody(body, isReservedKey = false) {
  if (!body || typeof body !== "object") {
    throw invalid("body must be a JSON object");
  }

  const { key, topic, tenantId, recipient, context, step } = body;

  if (typeof key !== "string" || !key) {
    throw invalid("key is required and must be a non-empty string");
  }

  if (typeof topic !== "string" || !topic) {
    throw invalid("topic is required and must be a non-empty string");
  }

  // ★ tenantId is optional ONLY for the reserved key; required for normal keys
  if (!isReservedKey && (typeof tenantId !== "string" || !tenantId)) {
    throw invalid("tenantId is required and must be a non-empty string");
  }

  // For reserved key, recipient is optional; for normal key, it's required
  if (!isReservedKey) {
    if (!recipient || typeof recipient !== "object") {
      throw invalid("recipient is required and must be an object");
    }

    const { personId, role } = recipient;
    const hasPersonId = personId !== undefined && personId !== null;
    const hasRole = role !== undefined && role !== null;

    if (!hasPersonId && !hasRole) {
      throw invalid("recipient must have either personId or role");
    }

    if (hasPersonId && typeof personId !== "string") {
      throw invalid("recipient.personId must be a string when provided");
    }

    if (hasRole && typeof role !== "string") {
      throw invalid("recipient.role must be a string when provided");
    }
  }

  if (context === undefined || context === null) {
    throw invalid("context is required");
  }

  // step is optional; no validation needed

  return {
    key,
    topic,
    tenantId: tenantId || null,
    recipient: recipient
      ? {
          personId: recipient.personId !== undefined && recipient.personId !== null ? recipient.personId : undefined,
          role: recipient.role !== undefined && recipient.role !== null ? recipient.role : undefined,
        }
      : null,
    context,
    step,
  };
}

export function registerAutomationsCallbackRoutes(app) {
  app.post("/api/automations/callback", async (c) => {
    // ★ Read body as text ONCE for idempotency fingerprint
    const bodyText = await c.req.text();

    // Parse the body for processing
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw invalid("body must be valid JSON");
    }

    // ★★★ Auth: n8n service credential ONLY — constant-time compare (BEFORE validation, always)
    const headerKey = c.req.header("x-n8n-key");
    if (!headerKey) {
      throw forbidden("missing x-n8n-key header");
    }

    // Verify the credential in constant time
    const serviceSecret = getN8nServiceSecret();
    if (!verifyServiceCredential(headerKey, serviceSecret)) {
      throw forbidden("invalid service credential");
    }

    // ★ Check if this is the reserved INTERNAL key (for n8n error alerts)
    const isReservedKey = body && body.key === "platform.n8n_error";

    // Validate body shape (reserved key has different rules)
    const validated = validateCallbackBody(body, isReservedKey);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ RESERVED KEY: `platform.n8n_error` — INTERNAL, NO TENANT CONTEXT
    // An n8n failure carries: workflow name, run id, truncated error message (NO CLIENT DATA).
    // Emits a platform event + loud log line. Never silent. Event listeners process and notify.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (isReservedKey) {
      // ★ R2 report item (26 Sep 2026) — `requireIdempotencyKey` reads a plain headers object
      //   (`headers["idempotency-key"]`), never the Hono context itself; `c.get("headers")` is the
      //   lowercase-keyed object every request already carries (src/http/app.mjs:220-223, set on
      //   `"*"` before this route ever runs).
      const idempotencyKey = requireIdempotencyKey(c.get("headers"));

      const workflowName = validated.context?.workflowName || "unknown";
      const runId = validated.context?.runId || "unknown";
      const errorMsg = validated.context?.errorMessage || "no message";

      // ★★★ EMIT LOUD LOG LINE FIRST — never silent. Fires once per unique key: a replay of the
      //     SAME key returns the stored outcome below without re-running this branch.
      console.error(
        `[PLATFORM N8N ERROR] Workflow: ${workflowName} | Run: ${runId} | Error: ${errorMsg}`
      );

      // ★★★ THE FOUR DEFECTS THIS FIXES (measured, R2 report item):
      //   1. `tenantId` is now a REAL uuid — the one tenant with `is_platform = true`
      //      (`keystone.platform_tenant_id()`, migration 0505), resolved through
      //      `withCredentialLookup` exactly the way `resolvePublicTenantId` resolves a slug
      //      (src/booking/publicBooking.mjs:75-80) — no tenant context exists yet, so this is the
      //      one place allowed not to have one.
      //   2. the topic is `platform.automation.workflow_failed` — 3 segments, no digits, passes
      //      `event_topic_check` (0016:26) and is catalogued in TOPICS.platform (topics.mjs).
      //   3. NO subjectType/subjectId — there is no `workflow_error` row to point at; `runId` is
      //      not a uuid and was never a valid subject_id.
      //   4. actor is `"n8n"` — ACTOR_SHAPE and the DB's own `actor` CHECK (0200) both accept it
      //      literally; the caller here really is n8n, not the platform system itself.
      const { rows: platformRows } = await withCredentialLookup((db) =>
        db.query(`SELECT keystone.platform_tenant_id() AS id`));
      const platformTenantId = platformRows[0]?.id ?? null;

      if (!platformTenantId) {
        console.error(
          "[PLATFORM N8N ERROR] no tenant is marked is_platform — the workflow-failure event cannot be recorded"
        );
        throw dependency("no platform tenant is configured; the n8n workflow-error event could not be recorded");
      }

      // ★ Enum-shaped only (assertSafePayload, src/events/outbox.mjs) — dropped, never
      //   truncated/reshaped, when the run id does not fit that shape.
      const safeRunId = typeof runId === "string" && RUN_ID_ENUM_SHAPE.test(runId) ? runId : undefined;

      // ★★★ THE SAME "FAILURE RETURNED, RETHROWN AFTER COMMIT" PATTERN `runTenantScoped` documents
      //     (src/http/app.mjs:1084-1125) — a throw from inside `withTenant`'s callback would roll
      //     back the very claim/failed-marker row `withIdempotency` just wrote.
      let deferredFailure = null;
      const outcome = await withTenant(
        platformTenantId,
        async (tx) => {
          const result = await withIdempotency(
            tx,
            platformTenantId,
            idempotencyKey,
            bodyText,
            async () => {
              // ★ `workflow_name` and `error_message` are NOT in the payload (§2.4 — no text
              //   keys). There is no `workflow_error` record to store them on — the full text is
              //   already in the loud log line above, before this emit. `error_code` is a fixed
              //   token; no consumer of this topic reads `payload.workflow_name` or
              //   `payload.error_message` (grepped src/, n8n/workflows/ — no listener today).
              const emitted = await emit(tx, {
                tenantId: platformTenantId,
                topic: "platform.automation.workflow_failed",
                emittedBy: "platform",
                actor: "n8n",
                payload: {
                  error_code: "n8n_error",
                  ...(safeRunId !== undefined ? { run_id: safeRunId } : {}),
                },
              });
              return { status: 200, body: { eventId: emitted.id } };
            }
          );
          if (result.failed) { deferredFailure = result.error; return null; }
          return result.body;
        },
        { userId: null }
      );
      if (deferredFailure) throw deferredFailure;

      return c.json({ ran: true, runId: outcome.eventId });
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // NORMAL KEY FLOW — TENANT TOGGLE ENFORCED
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    // ★ Require and validate idempotency key
    const idempotencyKey = requireIdempotencyKey(c);

    // Process the callback inside idempotency guard and tenant transaction
    const result = await withIdempotency(
      { idempotencyKey, fingerprint: bodyText },
      async (recorded) => {
        // If we have a recorded outcome, replay it
        if (recorded && recorded.ran !== undefined) {
          return { ran: recorded.ran, runId: recorded.runId, reason: recorded.reason };
        }

        // Otherwise, process the callback
        const processResult = await withTenant(
          validated.tenantId,
          (tx) =>
            runCallbackAutomation(tx, {
              key: validated.key,
              topic: validated.topic,
              tenantId: validated.tenantId,
              recipient: validated.recipient,
              context: validated.context,
              step: validated.step,
            }),
          { userId: null }
        );

        return processResult;
      }
    );

    // ★ Response shape: {ran:true, runId} or {ran:false, reason}
    if (result.ran) {
      return c.json({ ran: true, runId: result.runId });
    } else {
      return c.json({ ran: false, reason: result.reason });
    }
  });
}
