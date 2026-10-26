// Stage 20 Task 20.11 — INSTANT BANK VERIFICATION SESSIONS
//
// Financial Connections sessions for instant account verification.
// Stripe Financial Connections allows customers to verify bank accounts
// by connecting to their bank account directly.

import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { metadataFor } from "./metadata.mjs";

/**
 * Create a Financial Connections session for a person to verify their bank account.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice's id
 *   personId: the person's id (will be the customer)
 * @returns {Promise<{clientSecret: string}>}
 */
export async function createFinancialConnectionsSession(tx, { tenantId, personId }) {
  // Get the person's Stripe customer ID (lookup required)
  // For now, stub: pass the personId as the customer filter
  const form = {
    account_holder: {
      type: "customer",
      customer: personId, // In a real implementation, this would be the Stripe Customer ID
    },
    permissions: ["balances", "ownership", "payment_method", "transactions"],
    filters: {
      countries: ["US"],
    },
  };

  // Metadata composition is optional for Financial Connections, but if included:
  const metadata = metadataFor("customer", {
    person_id: personId,
    practice_id: tenantId,
    portal_status: "verified",
  });

  if (Object.keys(metadata).length > 0) {
    form.metadata = metadata;
  }

  const result = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/financial_connections/sessions",
    sdk: (s, o, form, query) => s.financialConnections.sessions.create(form, o),
    form,
    movesMoney: false,
    purpose: "create_financial_connections_session",
  });

  // Return the client secret from the session
  return { clientSecret: result.body.client_secret };
}
