// P3.S14 — WAYS TO PAY (PAYMENT METHOD CONFIGURATION).
//
// ★★★ A Stripe `payment_method_configuration` is a PRACTICE-WIDE SWITCHBOARD — one object per
//     connected account, controlling which payment method types (card, us_bank_account, klarna, …)
//     show on that practice's Stripe-hosted pay pages. No local table, no migration: this module
//     stores only the object's id (so a second save updates the SAME object rather than creating a
//     duplicate) and the last-saved `enabled` list, in `tenant_setting`.
//
// ★★ FIELD 8(c): THE READ NEVER THROWS. A practice with no reachable Stripe account still gets its
//    last SAVED choice back, with `unavailable: true` — the same discipline `invoiceLayouts.mjs`
//    uses for its list, so a Stripe outage does not blank the Money settings screen. The WRITE is a
//    real write attempt and DOES throw (as `dependency(...)`) on a Stripe refusal.
//
// WIRING-MAP row W11 — GET/POST /v1/payment_method_configurations(/{configuration}).

import { invalid, dependency } from "../http/errors.mjs";
import { stripeConnectedRequest } from "../money/stripeConnected.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { getSetting, setSetting } from "./writes.mjs";

const SECTION = "settings";

// ── the two tenant_setting keys this module owns (registered in `./keys.mjs`) ──────────────────
const CONFIGURATION_ID_KEY = "money.payment_method_configuration_id";
const ENABLED_KEY = "money.payment_methods";

// ★ Every top-level key on a Stripe `payment_method_configuration` response IS a payment method
//   type EXCEPT these — Stripe's own object/id/name/livemode/parent/application/active/is_default.
const NON_TYPE_KEYS = new Set([
  "id", "object", "name", "livemode", "application", "active", "is_default", "parent",
]);

/**
 * ★ Read a Stripe `payment_method_configuration` body into `{ enabled, available }` — `available`
 *   is every type Stripe marked `available: true` for this account; `enabled` is the subset of
 *   those Stripe also has switched `display_preference.value === "on"`.
 */
function parseConfiguration(body) {
  const available = [];
  const enabled = [];
  for (const [key, value] of Object.entries(body ?? {})) {
    if (NON_TYPE_KEYS.has(key)) continue;
    if (!value || typeof value !== "object") continue;
    if (value.available === true) {
      available.push(key);
      if (value.display_preference?.value === "on") enabled.push(key);
    }
  }
  return { enabled, available };
}

/**
 * ★ READ — never throws.
 *
 * @param tx a tenant transaction
 * @param {tenantId} tenantId the practice's id
 * @param deps optional {fetchImpl, env} — same shape `stripeConnectedRequest` takes
 * @returns {Promise<{enabled: string[], available: string[], unavailable?: true}>}
 */
export async function paymentMethodSettings(tx, { tenantId } = {}, deps = {}) {
  if (!tenantId) {
    throw invalid("tenantId is required");
  }

  const savedEnabled = await getSetting(tx, ENABLED_KEY, []);
  const configurationId = await getSetting(tx, CONFIGURATION_ID_KEY, null);

  // ★ Nothing has ever been saved — there is no configuration id to ask Stripe about yet.
  if (!configurationId) {
    return { enabled: savedEnabled, available: [] };
  }

  try {
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "GET",
      path: `/payment_method_configurations/${configurationId}`,
      sdk: (s, o, form, query) => s.paymentMethodConfigurations.retrieve(configurationId, {}, o),
      movesMoney: false,
      purpose: "read_payment_method_configuration",
      actorUserId: null,
    }, deps);

    return parseConfiguration(body);
  } catch {
    // ★ Field 8(c) — a Stripe failure on THIS read is a read gone wrong, never a refused write.
    return { enabled: savedEnabled, available: [], unavailable: true };
  }
}

/**
 * ★ Which types this account is eligible for, before any of them are chosen — read from the
 *   practice's OWN configuration if one already exists, else from the connected account's own
 *   default configuration (every Stripe account has one, whether or not it has been customised).
 *   Unlike `paymentMethodSettings` above, this NEVER SOFTENS A FAILURE: it feeds a real write.
 */
async function fetchAvailableTypes(tx, tenantId, configurationId, deps) {
  if (configurationId) {
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "GET",
      path: `/payment_method_configurations/${configurationId}`,
      sdk: (s, o, form, query) => s.paymentMethodConfigurations.retrieve(configurationId, {}, o),
      movesMoney: false,
      purpose: "read_payment_method_configuration",
      actorUserId: null,
    }, deps);
    return parseConfiguration(body).available;
  }

  const { body } = await stripeConnectedRequest(tx, {
    tenantId,
    method: "GET",
    path: "/payment_method_configurations",
    sdk: (s, o, form, query) => s.paymentMethodConfigurations.list(query, o),
    query: { limit: 100 },
    movesMoney: false,
    purpose: "list_payment_method_configurations",
    actorUserId: null,
  }, deps);
  const list = body?.data ?? [];
  const defaultConfig = list.find((cfg) => cfg.is_default) ?? list[0] ?? {};
  return parseConfiguration(defaultConfig).available;
}

/**
 * ★ WRITE — `enabled` must be a subset of what Stripe says this account is eligible for, or this
 *   refuses with `invalid(...)` before any Stripe write is attempted. Creates the practice's
 *   configuration the first time (no stored id yet); updates it after. `settings.payment_methods.
 *   changed` fires on a successful save. Every Stripe refusal becomes `dependency(...)`.
 *
 * @param tx a tenant transaction
 * @param {tenantId, enabled, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns {Promise<{id, enabled, available}>}
 */
export async function setPaymentMethodSettings(tx, { tenantId, enabled, actorUserId = null } = {}, deps = {}) {
  if (!tenantId) {
    throw invalid("tenantId is required");
  }
  if (!Array.isArray(enabled) || !enabled.every((t) => typeof t === "string")) {
    throw invalid("enabled must be a list of payment method type strings");
  }

  const configurationId = await getSetting(tx, CONFIGURATION_ID_KEY, null);

  let available;
  try {
    available = await fetchAvailableTypes(tx, tenantId, configurationId, deps);
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  const unknown = enabled.filter((t) => !available.includes(t));
  if (unknown.length > 0) {
    throw invalid(
      `"${unknown[0]}" is not an available payment method type for this practice — available: ${available.join(", ")}`);
  }

  const form = {};
  for (const type of available) {
    form[type] = { display_preference: { value: enabled.includes(type) ? "on" : "off" } };
  }

  let body;
  try {
    if (configurationId) {
      ({ body } = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/payment_method_configurations/${configurationId}`,
        sdk: (s, o, form, query) => s.paymentMethodConfigurations.update(configurationId, form, o),
        form,
        movesMoney: false,
        purpose: "update_payment_method_configuration",
        actorUserId,
      }, deps));
    } else {
      ({ body } = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: "/payment_method_configurations",
        sdk: (s, o, form, query) => s.paymentMethodConfigurations.create(form, o),
        form,
        movesMoney: false,
        purpose: "create_payment_method_configuration",
        actorUserId,
      }, deps));
    }
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  await setSetting(tx, { tenantId, key: CONFIGURATION_ID_KEY, value: body.id, updatedBy: actorUserId });
  await setSetting(tx, { tenantId, key: ENABLED_KEY, value: enabled, updatedBy: actorUserId });

  await emit(tx, {
    tenantId,
    topic: "settings.payment_methods.changed",
    emittedBy: SECTION,
    actor: userActor(actorUserId),
    payload: { enabled },
  });

  return { id: body.id, enabled, available };
}

/**
 * ★ P3.S15 — READ — never throws. Wallet domains registered on this practice's connected account
 *   for Apple Pay / Google Pay on Stripe-hosted pay pages — a Stripe `payment_method_domain` list.
 *   No local table, no migration: this reads Stripe live and stores nothing.
 *
 * @param tx a tenant transaction
 * @param {tenantId} tenantId the practice's id
 * @param deps optional {fetchImpl, env} — same shape `stripeConnectedRequest` takes
 * @returns {Promise<{domains: {domain: string, status: string|undefined}[], unavailable?: true}>}
 */
export async function walletDomains(tx, { tenantId } = {}, deps = {}) {
  if (!tenantId) {
    throw invalid("tenantId is required");
  }

  try {
    const { body } = await stripeConnectedRequest(tx, {
      tenantId,
      method: "GET",
      path: "/payment_method_domains",
      sdk: (s, o, form, query) => s.paymentMethodDomains.list(query, o),
      query: { limit: 100 },
      movesMoney: false,
      purpose: "list_payment_method_domains",
      actorUserId: null,
    }, deps);

    const list = body?.data ?? [];
    return { domains: list.map((d) => ({ domain: d.domain_name, status: d.apple_pay?.status })) };
  } catch {
    // ★ Field 8(b) — a Stripe failure on THIS read is a read gone wrong, never a refused write.
    return { domains: [], unavailable: true };
  }
}
