// RUN 9 — WHAT RUN 9 ADDED, OVER THE DEVELOPER API (host side; Documents is reached only through its front door). Each operation calls the same function the screen calls, so the API and the
// app cannot disagree: search (⌘K), the contract repository and its key dates, the Payments page (list and refund), and the automations (list, switch on or off — Pro).
// Scopes: documents:read / documents:write (payments are taken on documents, as GET /api/v1/payments/status already is; a refund moves money and needs an Idempotency-Key);
// the automations ride plays:read / plays:write, as GET /api/v1/playbooks does. Stripe stays the record: every amount, fee and
// refund here is what Stripe said; disputes are answered in Stripe.
import { createRoute, z } from "@hono/zod-openapi";
import { searchWorkspace, listContracts, correctKeyDate, listWorkspacePayments, refundPayment, listFlows, setFlowEnabled } from "../documents/frontDoor.mjs";

const bearerSec = [{ bearerAuth: [] }];
const Any = z.any();
const Id = z.string().uuid();
const KIND = z.enum(["start", "end", "notice", "renewal", "value"]);

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
  add({ method: "get", path: "/api/v1/search", tpl: "/api/v1/search", tag: "Documents", summary: "Search documents, templates, forms and people",
    description: "The same search as ⌘K in the app: documents by title or signer, templates, forms and people, best first, grouped. `per` is how many of each kind (1 to 20, default 6).",
    req: { query: z.object({ q: z.string().max(120), per: z.coerce.number().int().min(1).max(20).optional() }) },
    fn: async ({ c, db }) => { const q = c.req.valid("query"); return searchWorkspace(db, { q: q.q, per: q.per ?? 6 }); } });

  // ── the contract repository and key dates
  add({ method: "get", path: "/api/v1/contracts", tpl: "/api/v1/contracts", tag: "Contracts", summary: "List signed contracts with their key dates",
    description: "Every signed document with the dates read from its boxes at signing — start, end, notice, renewal — and its value, with where each came from (`source`: a box, or a person's correction). Filter with `q` (title or person).",
    req: { query: z.object({ q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) },
    fn: async ({ c, db }) => { const q = c.req.valid("query"); return listContracts(db, { q: q.q ?? null, limit: q.limit ?? 200 }); } });
  add({ method: "post", path: "/api/v1/contracts/{id}/dates", tpl: "/api/v1/contracts/:id/dates", tag: "Contracts", summary: "Correct a contract's key date",
    description: "Sets one key date (or the value) on a signed document by hand. The signed PDF never changes; the correction is kept as the person's, and renewal reminders follow it. `date` is YYYY-MM-DD; `null` clears it.",
    req: { params: z.object({ id: Id }), ...body(z.object({ kind: KIND, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), amountMinor: z.number().int().min(0).nullable().optional(), currency: z.string().length(3).nullable().optional() })) },
    fn: async ({ c, db, tenantId, ownerId }) => { const b = c.req.valid("json"); return correctKeyDate(db, { tenantId, instanceId: c.req.valid("param").id, kind: b.kind, date: b.date ?? null, amountMinor: b.amountMinor ?? null, currency: b.currency ?? null, actorUserId: ownerId }); } });

  // ── payments taken while signing
  add({ method: "get", path: "/api/v1/payments", tpl: "/api/v1/payments", tag: "Payments", summary: "List payments taken through documents and forms",
    description: "Newest first: who paid, for which document, the amount, status (`paid`, `waiting` — signed, the signature kept while they pay — `started`, `refunded`, `partially_refunded`, `disputed`), and this month's figures (`month.stripeFee` is Stripe's own fees, `month.stripeFeePending` the payments Stripe has not settled yet). Page with `before` (the `next` of the previous page).",
    req: { query: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }) },
    fn: async ({ c, db, tenantId }) => { const q = c.req.valid("query"); return listWorkspacePayments(db, { tenantId, before: q.before ?? null, limit: q.limit ?? 50 }); } });
  add({ method: "post", path: "/api/v1/payments/{id}/refund", tpl: "/api/v1/payments/:id/refund", tag: "Payments", summary: "Refund a payment, in full or in part",
    description: "Refunds through Stripe on the workspace's own account. Leave out `amountMinor` for the rest of the payment. `reason` is required: it shows on the payer's Stripe receipt and goes in the document's audit trail. The signed document stays signed. Needs an `Idempotency-Key`.",
    status: 201, conflict: "The payment was never completed, or has already been refunded, so there is nothing (more) to refund.", req: { params: z.object({ id: Id }), ...body(z.object({ amountMinor: z.number().int().min(1).optional(), reason: z.string().min(1).max(500) })) },
    write: (c) => c.req.valid("json"),
    fn: async ({ c, db, tenantId, ownerId }) => { const b = c.req.valid("json"); return refundPayment(db, { tenantId, paymentId: c.req.valid("param").id, amountMinor: b.amountMinor ?? null, reason: b.reason, actorUserId: ownerId }); } });

  // ── automations (Pro to switch on; Run 9 Part 4R: the "playbooks that run", renamed)
  add({ method: "get", path: "/api/v1/automations", tpl: "/api/v1/automations", tag: "Automations", summary: "List automations",
    description: "Each automation built on the canvas: when it starts (a signed document from a template or form), its steps, whether it is on, how many times it ran and its recent runs. (`GET /api/v1/playbooks` lists packs: bundles of skills and templates.)",
    fn: async ({ db }) => listFlows(db) });
  add({ method: "post", path: "/api/v1/automations/{id}/enable", tpl: "/api/v1/automations/:id/enable", tag: "Automations", summary: "Switch an automation on or off",
    description: "`on: true` switches it on (Pro): from then on, each matching signed document starts a run. `on: false` stops new runs, and a run that is waiting stops when its wait ends, without sending its reminder.",
    req: { params: z.object({ id: Id }), ...body(z.object({ on: z.boolean() })) },
    fn: async ({ c, db, tenantId }) => setFlowEnabled(db, { tenantId, id: c.req.valid("param").id, on: c.req.valid("json").on }) });
}
