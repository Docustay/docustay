// QUEUE §23.5.7 — THE PUBLIC SELF-SERVE LINK (`/s/<slug>` on a practice's own site). Host-side, because it needs the host's tenant lookup, feature flags, Turnstile and rate limiter; it reaches Documents only
// through the front door. Every refusal (unknown practice, unknown or switched-off link, a template that is not usable) is the SAME 404, so the page cannot be used to find out what exists.
import { invalid, notFound } from "../http/errors.mjs";
import { withTenant } from "../db/index.mjs";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { resolvePublicTenantId } from "../booking/publicBooking.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { verifyTurnstile } from "../http/turnstile.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { tenantForCustomHost } from "../http/customHost.mjs";
import { readSelfServe, selfServeOwner, startSelfServe } from "../documents/frontDoor.mjs";

export function registerSelfServeRoutes(app) {
  // ★ §23.5.7 — the public self-serve link. Every refusal (unknown practice, unknown or switched-off link, a template that is not usable) is the SAME 404, so the page cannot be used to find out what exists.
  const GONE = "That page does not exist.";
  const selfServeTenant = async (c) => { const id = (await resolvePublicTenantId(subdomainFromRequest(c))) ?? (await tenantForCustomHost(c.req.header("host"))); if (!id) throw notFound(GONE); return id; };   // a workspace subdomain, else the workspace's own live domain
  app.get("/api/public/documents/self-serve", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await selfServeTenant(c);
    const out = await withTenant(tenantId, (tx) => readSelfServe(tx, { tenantId, slug: c.req.query("slug") }), { userId: null });
    if (!out) throw notFound(GONE);
    return c.json(out);
  });
  app.post("/api/public/documents/self-serve/start", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await selfServeTenant(c);
    let body; try { body = await c.req.json(); } catch { throw invalid("the request body is not JSON"); }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");
    const ip = c.get("clientIp") ?? null;
    formSubmitLimiter("self_serve", ip, { limit: 10 });                       // at most 10 starts an hour from one address; over that, 429
    if (typeof body.website === "string" && body.website.trim() !== "") throw notFound(GONE);   // the hidden field only a script fills in
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), { userId: null });
    if (turnstileOn) {
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") throw invalid("We could not verify you are not a robot. Try again.");
      if (outcome.reason === "unreachable") formSubmitLimiter("self_serve_unverified", ip, { limit: 3 });   // no proof it is a person: a tighter allowance
    }
    const ownerId = await withTenant(tenantId, (tx) => selfServeOwner(tx), { userId: null });
    const out = await withTenant(tenantId, (tx) => startSelfServe(tx, { tenantId, ownerId, slug: body.slug, name: body.name, email: body.email }), { userId: ownerId });
    return c.json(out, 201);
  });
}
