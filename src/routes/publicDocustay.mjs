// Part 29 step 3 (A6) — the two public doors a self-hosted Docustay install talks to: the licence check and the anonymous usage ping. Both live in the platform organisation. The request address is used for the rate limit
// only and is never written anywhere (the ping stores a random install id, a version and five counts).
import { PRICES } from "../product/docustayPrices.mjs";
import { invalid, configurationStatement } from "../http/errors.mjs";
import { withTenant } from "../db/index.mjs";
import { resolvePublicTenantId } from "../booking/publicBooking.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { docustayPlans, annualEnabled } from "../product/docustayPlans.mjs";
import { checkLicense, recordPing } from "../product/docustayLicense.mjs";
import { deliverAddon } from "../product/docustayAddonDelivery.mjs";
import { startSelfhostCheckout } from "../product/docustay.mjs";
import { cleanUsageReport } from "../product/docustaySelfhost.mjs";

/** The platform organisation (the one the licence check and the usage ping live in). When this deployment has none, the answer is a plain 503 configuration statement, never a bare 500 (D-020). `resolve` is injectable for the test. */
export async function requirePlatformTenant(resolve, slug) {
  const id = await resolve(slug);
  if (!id) throw configurationStatement("This deployment has no platform organisation set up, so the licence check and the usage report are not available here.");
  return id;
}

export function registerPublicDocustayRoutes(app) {
  const platformTenant = () => requirePlatformTenant(resolvePublicTenantId, process.env.KEYSTONE_PLATFORM_SLUG || "foundry");
  const body = async (c) => { let b; try { b = await c.req.json(); } catch { throw invalid("the request body is not JSON"); } if (!b || typeof b !== "object") throw invalid("the request body is not an object"); return b; };

  // B5 — the pricing page reads this, so page and product cannot disagree. Cached; no emails-per-day (not shown).
  app.get("/api/public/docustay/plans", (c) => {
    c.header("cache-control", "public, max-age=300");
    const byKey = (k) => { const x = docustayPlans().find((q) => q.key === k); if (!x) throw new Error(`plans: ${k} missing`); return x; };   // by KEY, never by position (17 Oct 2026: a positional read swapped Pay as you go and Pro)
    const free = byKey("docustay_free"), payg = byKey("docustay_payg"), pro = byKey("docustay_pro"), life = byKey("docustay_lifetime");
    return c.json({ currency: "usd",
      free: { key: free.key, name: free.name, docsPerMonth: free.docsPerMonth, templatesPerMonth: free.templatesPerMonth, draftsPerMonth: free.aiDraftsPerMonth, feeBps: free.feeBps, bulkCap: free.bulkCap },
      payg: { key: payg.key, name: payg.name, personMonthlyMinor: payg.personMonthlyMinor, docsIncluded: payg.docsPerMonth, docOverMinor: payg.docOverMinor, draftsIncluded: payg.aiDraftsPerMonth, draftOverMinor: payg.draftOverMinor, feeBps: payg.feeBps },
      pro: { key: pro.key, name: pro.name, monthlyMinor: pro.priceMinor, ...(annualEnabled() ? { yearlyMinor: pro.yearlyPriceMinor } : {}), docsPerMonth: pro.docsPerMonth, draftsIncluded: pro.aiDraftsPerMonth, draftOverMinor: pro.draftOverMinor, feeBps: pro.feeBps, items: ["unlimited documents", "unlimited templates", "unlimited team members", "unlimited signers", "your own plays and playbooks", "the Plays API", "100 MB uploads"] },
      lifetime: { key: life.key, name: life.name, oneTimeMinor: life.oneTimeMinor, draftsIncluded: life.aiDraftsPerMonth, draftOverMinor: life.draftOverMinor, feeBps: life.feeBps },
      budget: { defaultMinor: PRICES.budget.defaultMinor, alertPercents: PRICES.budget.alertPercents, earlyInvoiceMinor: PRICES.budget.earlyInvoiceMinor },
    });
  });
  app.post("/api/public/docustay/license", async (c) => {
    c.header("cache-control", "no-store");
    formSubmitLimiter("docustay_license", c.get("clientIp") ?? null, { limit: 60 });
    const b = await body(c); const tenantId = await platformTenant();
    return c.json(await withTenant(tenantId, (tx) => checkLicense(tx, { tenantId, key: b.key, installId: b.installId, role: b.role, version: b.version }), { userId: null }));
  });
  // Operation Live 5.1.4 — the closed Pro add-on: a valid key for this install gets the bundle; every other key gets the licence route's plain refusal
  app.post("/api/public/docustay/addon", async (c) => {
    c.header("cache-control", "no-store");
    formSubmitLimiter("docustay_addon", c.get("clientIp") ?? null, { limit: 20 });
    const b = await body(c); const tenantId = await platformTenant();
    const r = await withTenant(tenantId, (tx) => deliverAddon(tx, { tenantId, key: b.key, installId: b.installId, version: b.version ?? null, role: b.role }), { userId: null });
    c.header("content-type", "application/gzip"); c.header("x-addon-sha256", r.sha256);
    return c.body(r.body);
  });
  app.post("/api/public/docustay/ping", async (c) => {
    c.header("cache-control", "no-store");
    formSubmitLimiter("docustay_ping", c.get("clientIp") ?? null, { limit: 60 });
    const b = await body(c); const tenantId = await platformTenant();
    return c.json(await withTenant(tenantId, (tx) => recordPing(tx, { tenantId, installId: b.installId, version: b.version, counts: b.counts }), { userId: null }));
  });
  // item 5 — buy the self-hosted licence (Stripe Checkout, TEST mode in the sandbox); the key arrives by email once the payment goes through
  app.post("/api/public/docustay/selfhost/checkout", async (c) => {
    c.header("cache-control", "no-store");
    formSubmitLimiter("docustay_selfhost_checkout", c.get("clientIp") ?? null, { limit: 20 });
    const b = await body(c); const tenantId = await platformTenant();
    return c.json(await startSelfhostCheckout({ platformTenantId: tenantId, email: b.email }));
  });
  // item 5 — an offline install sends the report it downloaded in Settings (same five numbers as the daily ping, same whitelist)
  app.post("/api/public/docustay/usage-report", async (c) => {
    c.header("cache-control", "no-store");
    formSubmitLimiter("docustay_usage_report", c.get("clientIp") ?? null, { limit: 30 });
    const b = await body(c); const tenantId = await platformTenant();
    const r = cleanUsageReport(b.report ?? b);
    return c.json(await withTenant(tenantId, (tx) => recordPing(tx, { tenantId, installId: r.installId, version: r.version, counts: r.counts }), { userId: null }));
  });
}
