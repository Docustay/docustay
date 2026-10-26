// @ts-check
// the maintainer's ruling, 28 Sep 2026 — "no embedded Stripe screens, build in React on the Stripe API."
// Real tax settings + registrations, read directly from Stripe's Tax API.
//
// ★ Creating a NEW registration is NOT built here. Stripe's own words on the write endpoint:
//   "This API can affect how much tax the merchant collects" — a real, consequential object, with
//   a per-jurisdiction body shape that differs by country and even by US state (some states need
//   sub-elections for county-level use tax). Getting that wrong against this account's real,
//   live tax collection would be a genuine business risk, not a UI bug. Registration creation
//   routes to Stripe's own hosted wizard instead — the same "no embed, but a real Stripe-hosted
//   redirect" exception the maintainer carved out for new-account onboarding.

import { stripeConnectedRequest } from "./stripeConnected.mjs";

/**
 * Read tax settings and registrations, live.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId
 */
export async function taxRead(tx, { tenantId }) {
  const [settingsRes, registrationsRes] = await Promise.all([
    stripeConnectedRequest(tx, { tenantId, method: "GET", path: "/tax/settings", movesMoney: false, purpose: "tax_settings_read" }),
    stripeConnectedRequest(tx, { tenantId, method: "GET", path: "/tax/registrations", query: { limit: 100 }, movesMoney: false, purpose: "tax_registrations_read" }),
  ]);

  const s = settingsRes.body;
  return {
    settings: {
      status: s.status,
      taxCode: s.defaults?.tax_code ?? null,
      taxBehavior: s.defaults?.tax_behavior ?? null,
      headOfficeAddress: s.head_office?.address ?? null,
    },
    registrations: (registrationsRes.body.data ?? []).map((r) => ({
      id: r.id,
      country: r.country,
      status: r.status,
      activeFrom: r.active_from ? new Date(r.active_from * 1000).toISOString() : null,
      expiresAt: r.expires_at ? new Date(r.expires_at * 1000).toISOString() : null,
    })),
  };
}
