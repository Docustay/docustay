// FINAL PUSH Stage 6 (FP-D) — THE EMBEDDABLE TEMPLATE BUILDER. `POST /api/v1/embedded/builder-session` (scope `embedded:write`) makes a one-hour link to a builder page that a customer shows in an iframe or the `<docustay-builder>` element on a website they listed under Settings → Developers → Embedding.
// The link carries a short-lived key of its own (templates:read, templates:write only, member rank, gone in an hour) in the #fragment: it never reaches a log, and it can do nothing the caller's own key could not.
// `POST /api/public/builder/frame-origin` is the one public route: the web server asks it whether a builder page may be framed by the website named in the link (see builderFrame.mjs).
import { createRoute, z } from "@hono/zod-openapi";
import { createApiToken } from "../auth/apiToken.mjs";
import { assertEmbedOrigin, currentKeyId, saveKeyPolicy } from "../documents/frontDoor.mjs";
import { signFrame, openFrame } from "../developer/builderFrame.mjs";
import { emit, apiKeyActor } from "../events/outbox.mjs";
import { invalid } from "../http/errors.mjs";

const bearerSec = [{ bearerAuth: [] }];
const Session = z.object({ url: z.string().url(), expiresAt: z.string() }).openapi("BuilderSession");

export function registerBuilderV1(api, { run, errs }) {
  api.openapi(createRoute({ method: "post", path: "/api/v1/embedded/builder-session", tags: ["Embedding"], summary: "Start an embedded template builder session", security: bearerSec,
    description: "Returns a link that works for one hour and is meant for an iframe or the `<docustay-builder>` element on one of your allowed websites. The builder lets the person write a document, drop signature and other fields on it, and save it as a template; the saved template's id comes back to your page in a `saved` event. The link holds a key of its own that can only read and write templates and stops working after an hour. Needs an `Idempotency-Key` header.",
    request: { body: { content: { "application/json": { schema: z.object({ origin: z.string().openapi({ example: "https://app.example.com", description: "The website that will show the builder; must be on your allowed list." }), name: z.string().max(120).optional().openapi({ description: "A name to start the template with." }) }) } }, required: true } },
    responses: { 200: { description: "The session.", content: { "application/json": { schema: Session } } }, ...errs, 409: { ...errs[400], description: "Embedding is off, or that website is not on your allowed list (Developers → Embedding)." } } }),
  sessionHandler({ run, purpose: "embedded_builder", name: "Embedded builder session", scopes: ["templates:read", "templates:write"], page: "builder", path: "/api/v1/embedded/builder-session" }));
  api.openapi(createRoute({ method: "post", path: "/api/v1/embedded/scribe-session", tags: ["Embedding"], summary: "Start an embedded Scribe session", security: bearerSec,
    description: "Returns a link that works for one hour and is meant for an iframe or the `<docustay-scribe>` element on one of your allowed websites. The person picks a play, names who signs, answers a few clickable questions and gets a DRAFT; the draft's id comes back to your page in a `drafted` event. The link holds a key of its own that is draft-only (it cannot send: asking to send files an approval a person decides in Docustay), allows 50 drafts a day and stops working after an hour. Needs an `Idempotency-Key` header.",
    request: { body: { content: { "application/json": { schema: z.object({ origin: z.string().openapi({ example: "https://app.example.com", description: "The website that will show Scribe; must be on your allowed list." }), name: z.string().max(120).optional() }) } }, required: true } },
    responses: { 200: { description: "The session.", content: { "application/json": { schema: Session } } }, ...errs, 409: { ...errs[400], description: "Embedding is off, or that website is not on your allowed list (Developers → Embedding)." } } }),
  sessionHandler({ run, purpose: "embedded_scribe", name: "Embedded Scribe session", scopes: ["plays:read", "drafts:write", "documents:read", "documents:write", "templates:read"], page: "scribe", path: "/api/v1/embedded/scribe-session", draftOnly: true }));
}

function sessionHandler({ run, purpose, name, scopes, page, path, draftOnly = false }) {
  return async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const presented = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const environment = /^(?:gl|dsk)_live_/.test(presented) ? "live" : "test";
    return c.json(await run(c, "POST", path, async (db) => {
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
      const origin = await assertEmbedOrigin(db, b?.origin);
      const expiresAt = new Date(Date.now() + 3600_000);
      const { rows: [prod] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [t.t]);
      const made = await createApiToken(db, { environment, tokenClass: "secret", name, scopes, createdBy: null, rankCeiling: "member", expiresAt: expiresAt.toISOString(), brand: prod?.product === "docustay" ? "dsk" : "gl" });
      if (draftOnly) await saveKeyPolicy(db, { tenantId: t.t, tokenId: made.tokenId, draftOnly: true, maxDraftsPerDay: 50, maxSendsPerDay: null });
      const k = await currentKeyId(db);
      await emit(db, { tenantId: t.t, topic: "developer.api_key.created", emittedBy: "developer", subjectType: "api_token", subjectId: made.id, actor: k ? apiKeyActor(k) : "system", payload: { purpose } });
      const f = signFrame(origin);
      const web = (process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://app.docustay.app").replace(/\/+$/, "");
      const q = new URLSearchParams({ o: f.o, e: String(f.e), s: f.s, ...(typeof b?.name === "string" && b.name.trim() ? { n: b.name.trim().slice(0, 120) } : {}) });
      return { url: `${web}/embed/${page}?${q}#k=${encodeURIComponent(made.presented)}`, expiresAt: expiresAt.toISOString() };
    }), 200);
  };
}

export function registerBuilderPublic(app) {
  app.post("/api/public/builder/frame-origin", async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object") throw invalid("send { o, e, s }");
    return c.json({ origin: openFrame(b) });
  });
}
