// @ts-check
// the maintainer's ruling, 28 Sep 2026 — "no embedded Stripe screens, build in React on the Stripe API."
// Real account management: business details, bank account, payout schedule — read and write,
// directly against Stripe's own Account object. Replaces StripeSurface surface="account_management".

import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { getConnectAccountState } from "./connect.mjs";
import { invalid } from "../http/errors.mjs";

/**
 * Read business details, bank account, and payout schedule for the practice's Stripe account.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId
 */
export async function accountManagementRead(tx, { tenantId }) {
  const connectState = await getConnectAccountState(tx, tenantId);
  const acct = connectState.stripeAccountId;
  const { body } = await stripeConnectedRequest(tx, {
    tenantId, method: "GET", path: `/accounts/${acct}`,
    movesMoney: false, purpose: "account_management_read", onAccount: false,
  });

  const bank = (body.external_accounts?.data ?? []).find((a) => a.object === "bank_account") ?? null;

  return {
    businessName: body.business_profile?.name ?? body.company?.name ?? null,
    supportEmail: body.business_profile?.support_email ?? body.email ?? null,
    supportPhone: body.business_profile?.support_phone ?? null,
    supportUrl: body.business_profile?.url ?? null,
    address: body.company?.address ?? body.business_profile?.support_address ?? null,
    statementDescriptor: body.settings?.payments?.statement_descriptor ?? null,
    payoutSchedule: body.settings?.payouts?.schedule ?? null,
    chargesEnabled: !!body.charges_enabled,
    payoutsEnabled: !!body.payouts_enabled,
    detailsSubmitted: !!body.details_submitted,
    bank: bank
      ? { name: bank.bank_name ?? "Unknown", last4: bank.last4 ?? "", routingNumber: bank.routing_number ?? "" }
      : null,
    accountType: body.type ?? null,
    requirementsDue: body.requirements?.currently_due ?? [],
    capabilities: body.capabilities ?? {},
  };
}

/**
 * Update business profile fields — the ones a practice owner may safely change themselves
 * without re-running Stripe's own identity verification (name/support contact/statement
 * descriptor). Bank account changes and legal-entity changes are NOT here — those need Stripe's
 * own verification flow, same exception the maintainer carved out for new-account onboarding.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId, supportEmail, supportPhone, supportUrl, statementDescriptor
 */
export async function accountManagementUpdate(tx, { tenantId, supportEmail, supportPhone, supportUrl, statementDescriptor }) {
  const connectState = await getConnectAccountState(tx, tenantId);
  const acct = connectState.stripeAccountId;

  const form = {};
  if (supportEmail !== undefined) form["business_profile[support_email]"] = supportEmail || "";
  if (supportPhone !== undefined) form["business_profile[support_phone]"] = supportPhone || "";
  if (supportUrl !== undefined) form["business_profile[url]"] = supportUrl || "";
  if (statementDescriptor !== undefined) {
    if (statementDescriptor && statementDescriptor.length > 22) {
      throw invalid("Statement descriptor must be 22 characters or fewer — Stripe's own limit.");
    }
    form["settings[payments][statement_descriptor]"] = statementDescriptor || "";
  }
  if (Object.keys(form).length === 0) throw invalid("Nothing to update.");

  await stripeConnectedRequest(tx, {
    tenantId, method: "POST", path: `/accounts/${acct}`, form,
    movesMoney: false, purpose: "account_management_update", onAccount: false,
  });

  return accountManagementRead(tx, { tenantId });
}
