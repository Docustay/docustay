// LAUNCH step 8 — the public demo. POST /api/demo/start makes a throw-away workspace with sample documents and signs the visitor in to it;
// GET /api/demo/inbox lists what the demo "sent" (every send in a demo is held, never delivered). Switched on by KEYSTONE_DEMO_ENABLED (src/product/demoConfig.mjs).
import { withCredentialLookup } from "../db/index.mjs";
import { invalid, forbidden, internal } from "../http/errors.mjs";
import { verifyTurnstile, assertBotCheckConfigured } from "../http/turnstile.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { startDemo, listHeldMail } from "../product/demo.mjs";
import { demoEnabled } from "../product/demoConfig.mjs";
import { seedDemo } from "../product/demoSeed.mjs";
import { requestKeepCode, keepDemo } from "../product/demoKeep.mjs";

async function turnstileOn() {
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(`SELECT default_on FROM keystone.feature_flag WHERE key = $1`, ["turnstile_enabled"]);
    if (rows.length === 0) throw internal(`demo: "turnstile_enabled" is not a known feature flag — seed it first`);
    return rows[0].default_on === true;
  });
}

export function registerDemoRoutes(app, { runTenantScoped } = {}) {
  app.post("/api/demo/start", async (c) => {
    if (!demoEnabled()) throw forbidden("The demo is not available here.", { code: "demo_off" });
    let body = {};
    try { body = (await c.req.json()) ?? {}; } catch { body = {}; }
    if (typeof body !== "object") throw invalid("the request body is not an object");
    const ip = c.get("clientIp") ?? null;
    formSubmitLimiter("demo", ip);
    if (await turnstileOn()) {
      assertBotCheckConfigured();
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") throw forbidden("We could not verify you are not a robot. Try again.");
    }
    const out = await startDemo({ ip, userAgent: c.req.header("user-agent") ?? null, seed: seedDemo });
    const secure = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT ? "; Secure" : "";
    c.header("set-cookie", `ks_session=${encodeURIComponent(out.token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${out.expiresInHours * 3600}`);
    return c.json({ ok: true, seeded: out.seeded, expiresInHours: out.expiresInHours });
  });

  app.get("/api/demo/inbox", (c) =>
    runTenantScoped(c, async ({ db }) => ({ messages: await listHeldMail(db) }), { bucket: "settings" }).then((r) => c.json(r)));

  // Step 9 — "Keep my work": an email, a code, and this workspace becomes the visitor's real Free account.
  const bodyOf = async (c) => { try { const b = await c.req.json(); return b && typeof b === "object" ? b : {}; } catch { throw invalid("the request body is not JSON"); } };
  app.post("/api/demo/keep/request", async (c) => {
    const body = await bodyOf(c), ip = c.get("clientIp") ?? null;
    formSubmitLimiter("demo-keep", ip);
    return runTenantScoped(c, async ({ db }) => requestKeepCode({ tx: db, email: body.email, ip, lang: typeof body.lang === "string" ? body.lang : null }), { bucket: "settings" }).then((r) => c.json(r));
  });
  app.post("/api/demo/keep/confirm", async (c) => {
    const body = await bodyOf(c), ip = c.get("clientIp") ?? null;
    formSubmitLimiter("demo-keep", ip);
    const out = await runTenantScoped(c, async ({ principal, tenantId }) => keepDemo({ tenantId, ownerId: principal.appUserId, email: body.email, code: body.code, policy: body.policy === true, ip, userAgent: c.req.header("user-agent") ?? null, lang: typeof body.lang === "string" ? body.lang : "en" }), { bucket: "settings" });
    const secure = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT ? "; Secure" : "";
    c.header("set-cookie", `ks_session=${encodeURIComponent(out.token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${out.ttlHours * 3600}`);
    return c.json({ ok: true });
  });
}
