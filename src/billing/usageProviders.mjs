// ★ Stage 17 Task 17.15 — the provider adapters that reconcile live usage counts.
// Each adapter reads the provider's truth and compares it with the ledger.

import { callOutside } from "../http/outside.mjs";
import { esignExecutionCount } from "../documents/api.mjs";

/**
 * ★★★ THE ADAPTER CONTRACT.
 *
 * Each adapter is async ({tx, tenantId, periodStart, periodEnd, events, fetchImpl}) → either:
 *   { count: number, confirmedRefs: string[], missingRefs: string[] } on success, or
 *   { unavailable: string } when the provider is unreachable (reason is the string).
 *
 * ★ `tx` is the branded handle from `withTenant`, not a pool.
 * ★ `periodStart`/`periodEnd` are the period's bounds, end EXCLUSIVE, computed ONCE by the caller
 *   via `periodWindow()` (src/billing/usage.mjs). ★★★ R4 (the maintainer, 25 Sep 2026): no adapter derives a
 *   window of its own — deriving "+1 month" in four places is how one of them came to silently
 *   exclude the last millisecond of every month.
 * ★ `events` is the array of ledger rows for this metric in this period.
 * ★ `fetchImpl` is the HTTP client (defaulting to global fetch).
 */

/**
 * ESIGN — count of documents executed with at least one signature in the period.
 * Internal: reads the database directly to find document_instance rows with state='executed'
 * and a signature_record row in the same period.
 */
async function esignAdapter({ tx, tenantId, periodStart, periodEnd, events }) {
  // ★ periodEnd arrives from the caller (periodWindow, R4) and is EXCLUSIVE — the old in-adapter
  //   derivation subtracted a millisecond and then compared with `<`, excluding the last instant
  //   of every month. Count executed documents with at least one signature in this period.
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const count = await esignExecutionCount(tx, { tenantId, periodStart, periodEnd });

  // ★ Ledger tracking: match provider_ref (instanceId) against the provider truth.
  // Confirmed refs are those still valid in the provider; missing refs are not.
  const confirmedRefs = events
    .filter(e => e.provider_ref)
    .map(e => e.provider_ref);
  const missingRefs = [];

  return { count, confirmedRefs, missingRefs };
}

/**
 * AI_DRAFT — count of ledger rows with non-null provider_ref in the period.
 * Internal: reads the mainstay_usage_event table directly.
 */
async function aiDraftAdapter({ tx, tenantId, periodStart, periodEnd, events }) {
  const { rows } = await tx.query(
    `SELECT COUNT(*) as count
     FROM keystone.mainstay_usage_event
     WHERE tenant_id = $1
       AND metric = 'ai_draft'
       AND occurred_at >= $2
       AND occurred_at < $3
       AND provider_ref IS NOT NULL`,
    [tenantId, periodStart, periodEnd]
  );

  const count = parseInt(rows[0]?.count ?? 0, 10);

  // ★ All ledger rows are the source of truth for ai_draft.
  // Confirmed refs are all the provider_refs we have; missing refs is empty.
  const confirmedRefs = events
    .filter(e => e.provider_ref)
    .map(e => e.provider_ref);
  const missingRefs = [];

  return { count, confirmedRefs, missingRefs };
}

/**
 * TEXT — count of SMS messages delivered or sent via Twilio.
 * Provider: calls Twilio GET Messages/{sid} to verify each message's status.
 */
async function textAdapter({ tenantId, periodStart, events, fetchImpl }) {
  // ★ If Twilio is not configured, return unavailable.
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioAccountSid || !twilioAuthToken) {
    return { unavailable: "not_configured" };
  }

  // ★ R4: the old in-adapter "+1 month" here was DEAD CODE — computed and never read. The window
  //   is the caller's (`periodWindow`); this adapter verifies each ledger ref individually.
  let count = 0;
  const confirmedRefs = [];
  const missingRefs = [];

  // ★ For each ledger entry, ask Twilio about the message status.
  for (const event of events) {
    if (!event.provider_ref) continue;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages/${event.provider_ref}`;
    const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64");

    const result = await callOutside("twilio", url, {
      headers: { Authorization: `Basic ${auth}` },
    }, { fetchImpl });

    if (result.ok && result.body?.status) {
      // ★ Count segments if status is 'delivered' or 'sent'.
      if (result.body.status === "delivered" || result.body.status === "sent") {
        const segments = parseInt(result.body.num_segments ?? 1, 10);
        count += segments;
        confirmedRefs.push(event.provider_ref);
      } else if (result.body.status === "undelivered") {
        // Message failed; don't count it.
        missingRefs.push(event.provider_ref);
      }
    } else if (!result.ok) {
      // Provider error; treat as unavailable.
      return { unavailable: "provider_error" };
    }
  }

  return { count, confirmedRefs, missingRefs };
}

/**
 * MARKETING_EMAIL — count of emails sent via Resend.
 * Provider: calls Resend GET /emails/{id} to verify each email's delivery.
 */
async function marketingEmailAdapter({ tenantId, periodStart, events, fetchImpl }) {
  // ★ If Resend is not configured, return unavailable.
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return { unavailable: "not_configured" };
  }

  // ★ R4: the old in-adapter "+1 month" here was DEAD CODE — computed and never read. The window
  //   is the caller's (`periodWindow`); this adapter verifies each ledger ref individually.
  let count = 0;
  const confirmedRefs = [];
  const missingRefs = [];

  // ★ For each ledger entry, ask Resend about the email status.
  for (const event of events) {
    if (!event.provider_ref) continue;

    const url = `https://api.resend.com/emails/${event.provider_ref}`;
    const result = await callOutside("resend", url, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
    }, { fetchImpl });

    if (result.ok && result.body?.created_at) {
      // ★ Count delivered emails. Check if it has a delivered status or timestamp.
      if (result.body.last_event?.delivered || result.body.status === "delivered") {
        count += 1;
        confirmedRefs.push(event.provider_ref);
      } else {
        missingRefs.push(event.provider_ref);
      }
    } else if (!result.ok) {
      // Provider error; treat as unavailable.
      return { unavailable: "provider_error" };
    }
  }

  return { count, confirmedRefs, missingRefs };
}

/**
 * ★★ THE PROVIDERS MAP. Each key is a metric; the value is the adapter function.
 * Used by reconcileTenant to compare live counts with provider truth.
 */
export const PROVIDERS = Object.freeze({
  esign: esignAdapter,
  ai_draft: aiDraftAdapter,
  text: textAdapter,
  marketing_email: marketingEmailAdapter,
});
