// FINAL PUSH Stage 6 (FP-D1/D4/F5) — WEBHOOK ENDPOINTS OVER THE DEVELOPER API. Scopes `webhooks:read` / `webhooks:write`. A key can list, add, remove, test and rotate the endpoints that receive events about its own documents,
// and `docustay listen` reads the stored deliveries of a RELAY endpoint here (an address no server can reach: a laptop). Only `documents.*` events can be subscribed to from a key.
import { createRoute, z } from "@hono/zod-openapi";
import { randomBytes } from "node:crypto";
import { emit, apiKeyActor, ALL_TOPICS } from "../events/outbox.mjs";
import { createWebhookEndpoint, rotateEndpointSecret, sendTestEvent, recordTestSend, RELAY_HOST, isRelayUrl } from "../webhooks/outbound.mjs";
import { currentKeyId } from "../documents/frontDoor.mjs";
import { invalid, notFound } from "../http/errors.mjs";
import { DOCUSTAY_WEBHOOK_TOPICS } from "../developer/webhookTopics.mjs";

const bearerSec = [{ bearerAuth: [] }];
const Id = z.string().uuid();
const Endpoint = z.object({ id: Id, name: z.string(), url: z.string().nullable().openapi({ description: "null for a relay endpoint" }), relay: z.boolean(), eventTypes: z.array(z.string()), status: z.enum(["active", "paused", "disabled"]), disabledReason: z.string().nullable(), consecutiveFailures: z.number().int(), fingerprint: z.string(), createdAt: z.string() }).openapi("WebhookEndpoint");
const TOPICS_FOR_KEYS = DOCUSTAY_WEBHOOK_TOPICS;   // R13-D230: only events the product really sends

const shape = (r) => ({ id: r.id, name: r.name, url: isRelayUrl(r.url) ? null : r.url, relay: isRelayUrl(r.url), eventTypes: r.event_types, status: r.status, disabledReason: r.disabled_reason ?? null, consecutiveFailures: r.consecutive_failures, fingerprint: r.secret_fingerprint, createdAt: r.created_at?.toISOString?.() ?? r.created_at });
const COLS = "id, name, url, event_types, status, disabled_reason, consecutive_failures, secret_fingerprint, created_at";

export function registerWebhooksV1(api, { run, errs }) {
  const tenantOf = async (db) => (await db.query(`SELECT keystone.current_tenant_id() AS t`)).rows[0].t;
  const actorOf = async (db) => { const k = await currentKeyId(db); return k ? apiKeyActor(k) : "system"; };
  // R13-D318: a removed webhook is gone for every call (the list already hides it), so removing it again answers 404 like an id that never existed; its past deliveries stay readable
  const one = async (db, tenantId, id, { removedToo = false } = {}) => { const { rows: [r] } = await db.query(`SELECT * FROM keystone.webhook_endpoint WHERE id = $1 AND tenant_id = $2`, [id, tenantId]); if (!r || (!removedToo && r.status === "disabled" && r.disabled_reason === "removed")) throw notFound("no such webhook"); return r; };
  const json = (description, schema) => ({ 200: { description, content: { "application/json": { schema } } }, ...errs });

  api.openapi(createRoute({ method: "get", path: "/api/v1/webhooks/topics", tags: ["Webhooks"], summary: "The events a webhook can subscribe to", security: bearerSec,
    responses: json("The event names.", z.object({ topics: z.array(z.string()) })) }),
  async (c) => c.json(await run(c, "GET", "/api/v1/webhooks/topics", async () => ({ topics: TOPICS_FOR_KEYS })), 200));

  api.openapi(createRoute({ method: "get", path: "/api/v1/webhooks", tags: ["Webhooks"], summary: "List webhooks", security: bearerSec,
    responses: json("Your webhook endpoints, newest first.", z.object({ webhooks: z.array(Endpoint) })) }),
  async (c) => c.json(await run(c, "GET", "/api/v1/webhooks", async (db) => ({ webhooks: (await db.query(`SELECT ${COLS} FROM keystone.webhook_endpoint WHERE status <> 'disabled' OR disabled_reason <> 'removed' ORDER BY created_at DESC`)).rows.map(shape) })), 200));

  api.openapi(createRoute({ method: "post", path: "/api/v1/webhooks", tags: ["Webhooks"], summary: "Add a webhook", security: bearerSec,
    description: "Give an `https` `url` that can be reached from the internet, or `relay: true` for an endpoint that keeps its signed deliveries for `docustay listen` to fetch to your own computer. The signing secret is in the answer **once**. Events are signed with HMAC-SHA256 (Standard Webhooks headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; also `keystone-signature`).",
    request: { body: { content: { "application/json": { schema: z.object({ url: z.string().url().optional(), relay: z.boolean().optional(), name: z.string().min(1).max(120).optional(), eventTypes: z.array(z.string()).min(1).max(Math.max(40, TOPICS_FOR_KEYS.length)).openapi({ description: "From `GET /api/v1/webhooks/topics`." }) }) } }, required: true } },
    responses: { 201: { description: "Added. `secret` is shown once.", content: { "application/json": { schema: Endpoint.extend({ secret: z.string() }) } } }, ...errs } }),
  async (c) => { const b = c.req.valid("json");
    const out = await run(c, "POST", "/api/v1/webhooks", async (db) => {
      const tenantId = await tenantOf(db);
      if (!!b.url === !!b.relay) throw invalid("give either url or relay: true", { field: "url" });
      const unknown = b.eventTypes.filter((t) => !TOPICS_FOR_KEYS.includes(t));
      if (unknown.length) throw invalid(`these events cannot be subscribed to from a key: ${unknown.join(", ")}`, { field: "eventTypes" });
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      const url = b.relay ? `https://${RELAY_HOST}/${randomBytes(12).toString("hex")}` : b.url;
      const made = await createWebhookEndpoint(db, { tenantId, url, name: b.name ?? (b.relay ? "docustay listen" : "Webhook"), eventTypes: b.eventTypes, secret });
      await emit(db, { tenantId, topic: "developer.webhook_endpoint.created", emittedBy: "developer", subjectType: "webhook_endpoint", subjectId: made.id, actor: await actorOf(db), payload: { event_types: b.eventTypes, fingerprint: made.fingerprint } });
      return { ...shape(await one(db, tenantId, made.id)), secret };
    });
    return c.json(out, 201); });

  api.openapi(createRoute({ method: "delete", path: "/api/v1/webhooks/{id}", tags: ["Webhooks"], summary: "Remove a webhook", security: bearerSec,
    request: { params: z.object({ id: Id }) }, responses: json("Removed: it receives nothing more. Its past deliveries stay in the record.", z.object({ ok: z.literal(true) })) }),
  async (c) => c.json(await run(c, "DELETE", "/api/v1/webhooks/:id", async (db) => {
    const tenantId = await tenantOf(db), id = c.req.valid("param").id; await one(db, tenantId, id);
    await db.query(`UPDATE keystone.webhook_endpoint SET status = 'disabled', disabled_reason = 'removed' WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return { ok: true };
  }), 200));

  api.openapi(createRoute({ method: "post", path: "/api/v1/webhooks/{id}/test", tags: ["Webhooks"], summary: "Send a test event", security: bearerSec,
    description: "Sends a sample signed event (`test: true` in its payload) to the webhook now and returns the receiver's answer. The send is listed under the webhook's deliveries with `test: true`; failures here never count toward disabling the webhook and are never retried. Nothing is created, so no Idempotency-Key is needed: repeating the call just sends another test.",
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ topic: z.string().optional() }) } } } },
    responses: json("What the receiver answered.", z.object({ outcome: z.string(), status: z.number().nullable(), durationMs: z.number(), responseExcerpt: z.string().nullable(), error: z.string().nullable(), topic: z.string() }).passthrough()) }),
  async (c) => { const b = await c.req.json().catch(() => ({}));
    return c.json(await run(c, "POST", "/api/v1/webhooks/:id/test", async (db) => {
      const tenantId = await tenantOf(db), endpoint = await one(db, tenantId, c.req.valid("param").id);
      const out = await sendTestEvent({ tenantId, endpoint, topic: typeof b?.topic === "string" ? b.topic : null, tx: db });
      return recordTestSend(db, { tenantId, endpointId: endpoint.id, out });
    }), 200); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/webhooks/{id}/rotate", tags: ["Webhooks"], summary: "Rotate the signing secret", security: bearerSec,
    description: "Makes a new secret (shown once). For `windowHours` (default 24) every event is signed with both the new and the old secret, so your receiver can switch without a gap.",
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ windowHours: z.number().int().min(1).max(168).optional() }) } } } },
    responses: json("The new secret.", z.object({ secret: z.string(), fingerprint: z.string(), previousValidUntil: z.string() })) }),
  async (c) => { const b = await c.req.json().catch(() => ({}));
    return c.json(await run(c, "POST", "/api/v1/webhooks/:id/rotate", async (db) => {
      const tenantId = await tenantOf(db), id = c.req.valid("param").id; await one(db, tenantId, id);
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      const out = await rotateEndpointSecret(db, { tenantId, id, secret, windowHours: b?.windowHours });
      await emit(db, { tenantId, topic: "developer.webhook_endpoint.secret_rotated", emittedBy: "developer", subjectType: "webhook_endpoint", subjectId: id, actor: await actorOf(db), payload: { fingerprint: out.fingerprint } });
      return { secret, fingerprint: out.fingerprint, previousValidUntil: out.previousValidUntil };
    }), 200); });

  api.openapi(createRoute({ method: "get", path: "/api/v1/webhooks/{id}/deliveries", tags: ["Webhooks"], summary: "Recent deliveries", security: bearerSec,
    description: "Real deliveries and test sends (`test: true`, from `POST /webhooks/{id}/test`) together.",
    request: { params: z.object({ id: Id }) }, responses: json("The last 50 delivery attempts, newest first.", z.object({ deliveries: z.array(z.object({ id: Id, event: z.string(), attempt: z.number().int(), status: z.string(), responseStatus: z.number().nullable(), error: z.string().nullable(), attemptedAt: z.string(), test: z.boolean() })) })) }),
  async (c) => c.json(await run(c, "GET", "/api/v1/webhooks/:id/deliveries", async (db) => {
    const tenantId = await tenantOf(db), id = c.req.valid("param").id; await one(db, tenantId, id, { removedToo: true });
    const { rows } = await db.query(`SELECT * FROM (
        SELECT d.id, ev.topic, d.attempt, d.status, d.response_status, d.error, d.attempted_at, false AS test FROM keystone.webhook_delivery d JOIN keystone.event ev ON ev.id = d.event_id AND ev.tenant_id = d.tenant_id WHERE d.endpoint_id = $1
        UNION ALL
        SELECT t.id, t.topic, 1, t.status, t.response_status, t.error, t.attempted_at, true FROM keystone.webhook_test_send t WHERE t.endpoint_id = $1
      ) x ORDER BY attempted_at DESC LIMIT 50`, [id]);
    return { deliveries: rows.map((r) => ({ id: r.id, event: r.topic, attempt: r.attempt, status: r.status, responseStatus: r.response_status, error: r.error, attemptedAt: r.attempted_at?.toISOString?.() ?? r.attempted_at, test: r.test })) };
  }), 200));

  api.openapi(createRoute({ method: "get", path: "/api/v1/webhooks/{id}/relay", tags: ["Webhooks"], summary: "Fetch stored deliveries of a relay webhook", security: bearerSec,
    description: "For `docustay listen`. Returns deliveries stored since `after` (an id from a previous answer; leave out for the newest few), oldest first, each with the exact headers to forward so the signature checks out. Waits up to `wait` seconds (max 25) when there is nothing yet. Kept 24 hours.",
    request: { params: z.object({ id: Id }), query: z.object({ after: z.string().uuid().optional(), wait: z.coerce.number().int().min(0).max(25).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) },
    responses: json("Stored deliveries.", z.object({ events: z.array(z.object({ id: Id, topic: z.string().nullable(), headers: z.record(z.string(), z.string()), body: z.string(), at: z.string() })), cursor: z.string().nullable() })) }),
  async (c) => c.json(await run(c, "GET", "/api/v1/webhooks/:id/relay", async (db) => {
    const tenantId = await tenantOf(db), { id } = c.req.valid("param"), q = c.req.valid("query"); const ep = await one(db, tenantId, id);
    if (!isRelayUrl(ep.url)) throw invalid("this webhook is not a relay webhook", { field: "id" });
    const deadline = Date.now() + (q.wait ?? 0) * 1000, limit = q.limit ?? 50;
    for (;;) {
      const { rows } = q.after
        ? await db.query(`SELECT id, topic, headers, body, created_at FROM keystone.webhook_relay_event WHERE endpoint_id = $1 AND id > $2 ORDER BY id LIMIT $3`, [id, q.after, limit])
        : await db.query(`SELECT * FROM (SELECT id, topic, headers, body, created_at FROM keystone.webhook_relay_event WHERE endpoint_id = $1 ORDER BY id DESC LIMIT 5) t ORDER BY id`, [id]);
      if (rows.length || Date.now() >= deadline) return { events: rows.map((r) => ({ id: r.id, topic: r.topic, headers: r.headers, body: r.body, at: r.created_at?.toISOString?.() ?? r.created_at })), cursor: rows.length ? rows[rows.length - 1].id : (q.after ?? null) };
      await new Promise((r) => setTimeout(r, 1000));
    }
  }), 200));
}
