// RUN 7 — FORMS OVER THE DEVELOPER API (host side; Documents is reached only through its front door). One link many people fill in: list the forms, read one, its responses,
// publish or unpublish it, open or close it, and the thirty ready-made form templates. Scopes: documents:read for reads, documents:write for changes (forms are documents).
// A response is an ordinary document: GET /api/v1/documents/{id} reads it, and its `form` field says which form it came from.
import { createRoute, z } from "@hono/zod-openapi";
import { listForms, getForm, listResponses, publishForm, setFormOpen, removeForm, starterCatalogue } from "../documents/frontDoor.mjs";

const bearerSec = [{ bearerAuth: [] }];
const Err = z.object({ error: z.object({ kind: z.string(), message: z.string(), requestId: z.string().optional(), retryable: z.boolean().optional() }) });
const Any = z.any();
const Id = z.string().uuid();
const Settings = z.object({
  verifyEmail: z.boolean().optional(), copyTo: z.string().email().nullable().optional(), expiresAt: z.string().nullable().optional(), responseLimit: z.number().int().min(1).max(100000).nullable().optional(),
  intro: z.string().max(1000).nullable().optional(), thankYou: z.string().max(300).nullable().optional(), fillAgain: z.boolean().optional(), embedSites: z.array(z.string().url()).max(20).optional(),
  notifyOwner: z.boolean().optional(), confirmRespondent: z.boolean().optional(), counterSign: z.object({ on: z.boolean(), userId: z.string().uuid().nullable().optional() }).nullable().optional(),
}).openapi("FormSettings");

export function registerFormsV1(api, { run, asOwner, errs = {}, errBody = null }) {
  const add = ({ method, path, tpl, summary, description, req, status = 200, fn }) => api.openapi(
    createRoute({ method, path, tags: ["Forms"], summary, description, security: bearerSec, request: req, responses: { [status]: { description: summary, content: { "application/json": { schema: Any } } }, ...errs, ...(errBody ? { 409: errBody("A conflict, for example the link name is already used by another form.", { kind: "conflict", message: "That link name is already used.", retryable: false }) } : {}), 404: { description: "No such form.", content: { "application/json": { schema: Err } } } } }),
    async (c) => c.json(await run(c, method.toUpperCase(), tpl, async (db) => { const ownerId = await asOwner(db); const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); return fn({ c, db, tenantId: t.t, ownerId }); }), status));
  const body = (schema) => ({ body: { content: { "application/json": { schema } }, required: true } });

  add({ method: "get", path: "/api/v1/forms", tpl: "/api/v1/forms", summary: "List forms", description: "Every form template in the workspace: its link name, whether it is open, its response count and whether it has closed (a closing date or a response limit).",
    fn: async ({ db }) => ({ forms: await listForms(db) }) });
  add({ method: "get", path: "/api/v1/forms/templates", tpl: "/api/v1/forms/templates", summary: "List form templates", description: "The built-in form templates (the thirty from the template library) and your own: name, summary, who it is for, whether a team member counter-signs, and its default Publish settings.",
    fn: async () => ({ templates: await starterCatalogue({ kind: "form" }) }) });
  add({ method: "get", path: "/api/v1/forms/{id}", tpl: "/api/v1/forms/:id", summary: "Get a form", description: "One form: its link (`/f/<workspace>/<slug>`), settings, response count and whether it is open.", req: { params: z.object({ id: Id }) },
    fn: async ({ c, db, tenantId }) => getForm(db, { templateId: c.req.valid("param").id, tenantId }) });
  add({ method: "get", path: "/api/v1/forms/{id}/responses", tpl: "/api/v1/forms/:id/responses", summary: "List a form's responses", description: "Newest first. Each response is a document: its id opens it with GET /api/v1/documents/{id}. `limit` is 1 to 500.", req: { params: z.object({ id: Id }), query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }) },
    fn: async ({ c, db }) => { const q = c.req.valid("query"); return listResponses(db, { templateId: c.req.valid("param").id, limit: q.limit, offset: q.offset }); } });
  add({ method: "post", path: "/api/v1/forms/publish", tpl: "/api/v1/forms/publish", summary: "Publish a form", description: "Gives a form template its public link and settings (or changes them). `slug` is 4 to 60 letters, numbers and dashes. The template must be approved and have one person who fills it in, plus at most one team member who counter-signs (`settings.counterSign`).",
    req: body(z.object({ templateId: Id, slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/), settings: Settings.optional(), enabled: z.boolean().optional() })),
    fn: async ({ c, db, tenantId }) => { const b = c.req.valid("json"); return publishForm(db, { tenantId, templateId: b.templateId, slug: b.slug, settings: b.settings ?? {}, enabled: b.enabled !== false }); } });
  add({ method: "post", path: "/api/v1/forms/{id}/open", tpl: "/api/v1/forms/:id/open", summary: "Open or close a form", description: "`open: false` keeps the link but says the form is not taking responses.", req: { params: z.object({ id: Id }), ...body(z.object({ open: z.boolean() })) },
    fn: async ({ c, db, tenantId }) => setFormOpen(db, { tenantId, templateId: c.req.valid("param").id, open: c.req.valid("json").open }) });
  add({ method: "post", path: "/api/v1/forms/{id}/unpublish", tpl: "/api/v1/forms/:id/unpublish", summary: "Unpublish a form", description: "The link stops working. The form template, its settings and every response are kept; publish it again at any time.", req: { params: z.object({ id: Id }) },
    fn: async ({ c, db }) => removeForm(db, { templateId: c.req.valid("param").id }) });
}
