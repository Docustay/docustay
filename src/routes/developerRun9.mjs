// RUN 9 — WHAT RUN 9 ADDED, OVER THE DEVELOPER API (host side; Documents is reached only through its front door). Each operation calls the same function the screen calls, so the API and the
// app cannot disagree: search (⌘K), the Payments page (list and refund).
// Scopes: documents:read / documents:write (payments are taken on documents, as GET /api/v1/payments/status already is; a refund moves money and needs an Idempotency-Key);
// Stripe stays the record: every amount, fee and
// refund here is what Stripe said; disputes are answered in Stripe.
import { createRoute, z } from "@hono/zod-openapi";
import { searchWorkspace, listWorkspacePayments, refundPayment } from "../documents/frontDoor.mjs";

const bearerSec = [{ bearerAuth: [] }];
const Any = z.any();
const Id = z.string().uuid();

export function registerRun9V1(api, { run, asOwner, idem, errs = {}, errBody = null }) {
  const add = ({ method, path, tpl, tag, summary, description, req, status = 200, fn, write = null, conflict = null }) => api.openapi(
    createRoute({ method, path, tags: [tag], summary, description, security: bearerSec, request: req, responses: { [status]: { description: summary, content: { "application/json": { schema: Any } } }, ...errs, ...(conflict && errBody ? { 409: errBody(conflict, { kind: "conflict", message: conflict, retryable: false }) } : {}) } }),
    async (c) => {
      if (write) {   // an idempotent write keeps a refusal as its stored answer: it is thrown again here, so a refused refund answers 404/409, never "201 Created" (as `done` does for the documents routes)
        const out = await idem(c, tpl, write(c), (db, tenantId, ownerId) => fn({ c, db, tenantId, ownerId }), tpl.replace(":id", c.req.param("id") ?? ""));
        if (out?.failed) throw out.failed;
        return c.json(out, status);
      }
      return c.json(await run(c, method.toUpperCase(), tpl, async (db) => { const ownerId = await asOwner(db); const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); return fn({ c, db, tenantId: t.t, ownerId }); }), status);
    });
  const body = (schema) => ({ body: { content: { "application/json": { schema } }, required: true } });

  // ── search
  add({ method: "get", path: "/api/v1/search", tpl: "/api/v1/search", tag: "Documents", summary: "Search documents, templates and people",
    description: "The same search as ⌘K in the app: documents by title or signer, templates and people, best first, grouped. `per` is how many of each kind (1 to 20, default 6).",
    req: { query: z.object({ q: z.string().max(120), per: z.coerce.number().int().min(1).max(20).optional() }) },
    fn: async ({ c, db }) => { const q = c.req.valid("query"); return searchWorkspace(db, { q: q.q, per: q.per ?? 6 }); } });

  // ── payments taken while signing
  add({ method: "get", path: "/api/v1/payments", tpl: "/api/v1/payments", tag: "Payments", summary: "List payments taken through documents",
    description: "Newest first: who paid, for which document, the amount, status (`paid`, `waiting` — signed, the signature kept while they pay — `started`, `refunded`, `partially_refunded`, `disputed`), and this month's figures (`month.stripeFee` is Stripe's own fees, `month.stripeFeePending` the payments Stripe has not settled yet). Page with `before` (the `next` of the previous page).",
    req: { query: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }) },
    fn: async ({ c, db, tenantId }) => { const q = c.req.valid("query"); return listWorkspacePayments(db, { tenantId, before: q.before ?? null, limit: q.limit ?? 50 }); } });
  add({ method: "post", path: "/api/v1/payments/{id}/refund", tpl: "/api/v1/payments/:id/refund", tag: "Payments", summary: "Refund a payment, in full or in part",
    description: "Refunds through Stripe on the workspace's own account. Leave out `amountMinor` for the rest of the payment. `reason` is required: it shows on the payer's Stripe receipt and goes in the document's audit trail. The signed document stays signed. Needs an `Idempotency-Key`.",
    status: 201, conflict: "The payment was never completed, or has already been refunded, so there is nothing (more) to refund.", req: { params: z.object({ id: Id }), ...body(z.object({ amountMinor: z.number().int().min(1).optional(), reason: z.string().min(1).max(500) })) },
    write: (c) => c.req.valid("json"),
    fn: async ({ c, db, tenantId, ownerId }) => { const b = c.req.valid("json"); return refundPayment(db, { tenantId, paymentId: c.req.valid("param").id, amountMinor: b.amountMinor ?? null, reason: b.reason, actorUserId: ownerId }); } });
}
