// FINAL PUSH STAGE 2 — THE PUBLIC FORM ROUTES (host side: it needs the host's tenant lookup, feature flags, Turnstile and the rate limiter; it reaches Documents only through the front door).
// ★ The workspace comes from the address (…/forms/<workspace>/<form>, or "-" on a customer's own signing hostname) and every refusal (unknown workspace, unknown or switched-off form) is the SAME 404.
import { invalid, notFound } from "../http/errors.mjs";
import { withTenant } from "../db/index.mjs";
import { resolvePublicTenantId } from "../booking/publicBooking.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { verifyTurnstile } from "../http/turnstile.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { tenantForCustomHost } from "../http/customHost.mjs";
import { readForm, startForm, formOwner } from "../documents/frontDoor.mjs";

export function registerPublicFormRoutes(app) {
  const GONE = "That page does not exist.";
  const tenantOf = async (c) => { const org = c.req.param("org"); const id = org === "-" ? await tenantForCustomHost(c.req.header("host")) : await resolvePublicTenantId(org); if (!id) throw notFound(GONE); return id; };
  app.get("/api/public/forms/:org/:slug", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await tenantOf(c);
    // P10-A-6: read as the form's owner, like the start does — a document is visible only to a viewer, so with nobody the signed-response count was always 0 and a FULL form looked open
    const ownerId = await withTenant(tenantId, (tx) => formOwner(tx), { userId: null }).catch(() => null);
    const out = await withTenant(tenantId, (tx) => readForm(tx, { tenantId, slug: c.req.param("slug") }), { userId: ownerId });
    if (!out) throw notFound(GONE);
    return c.json(out);
  });
  app.post("/api/public/forms/:org/:slug/start", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await tenantOf(c);
    let body; try { body = await c.req.json(); } catch { throw invalid("the request body is not JSON"); }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");
    const ip = c.get("clientIp") ?? null;
    formSubmitLimiter("form_start", ip, { limit: 10 });                       // at most 10 starts an hour from one address
    if (typeof body.website === "string" && body.website.trim() !== "") throw notFound(GONE);   // the hidden field only a script fills in
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), { userId: null });
    if (turnstileOn) {
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") throw invalid("We could not verify you are not a robot. Try again.");
      if (outcome.reason === "unreachable") formSubmitLimiter("form_unverified", ip, { limit: 3 });
    }
    const ownerId = await withTenant(tenantId, (tx) => formOwner(tx), { userId: null });
    const out = await withTenant(tenantId, (tx) => startForm(tx, { tenantId, ownerId, slug: c.req.param("slug"), name: body.name, email: body.email, answers: body.answers && typeof body.answers === "object" ? body.answers : null }), { userId: ownerId });
    return c.json(out, 201);
  });
}
