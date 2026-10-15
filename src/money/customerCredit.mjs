// Stage 20 Task 20.66 — CUSTOMER CREDIT LEDGER
//
// ★★★ BALANCE IS `SUM(amount_minor)`. There is no balance column anywhere.
// A counter drifts; a ledger cannot. The append-only table is enforced by grants,
// not convention — app_rw gets SELECT, INSERT only (no UPDATE, no DELETE).
//
// ★★★ COACH NEVER SEES THE MONEY BLOCK. It is absent from the payload — not hidden
// client-side. The server decides what a role may read.

import crypto from "node:crypto";
import { emit, userActor } from "../events/outbox.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { invalid, conflict, dependency } from "../http/errors.mjs";
import { ensureCustomer } from "./customers.mjs";

class CreditNoteInvalid extends Error {
  constructor(message) {
    super(message);
    this.name = "CreditNoteInvalid";
  }
}

/**
 * Adjust a customer's credit balance: signed amount + required note → Stripe CBT create (adjustment) + our row.
 * @param {object} tx a tenant transaction
 * @param {object} params { tenantId, subjectType, subjectId, amountMinor, note, actorUserId }
 * @returns {Promise<{entryId, stripeId}>}
 */
export async function adjustCredit(tx, {
  tenantId, subjectType, subjectId, amountMinor, note, actorUserId,
} = {}) {
  if (!['person', 'account'].includes(subjectType)) {
    throw invalid(`subjectType must be 'person' or 'account', got '${subjectType}'`);
  }
  if (!Number.isInteger(amountMinor)) {
    throw invalid("amountMinor must be an integer");
  }
  if (!note || typeof note !== "string" || note.trim().length === 0) {
    throw invalid("note is required and must be a non-empty string");
  }
  if (note.length > 500) {
    throw invalid("note must be 500 characters or less");
  }

  const entryId = crypto.randomUUID();
  const { customerId } = await ensureCustomer(tx, subjectType === "person"
    ? { tenantId, personId: subjectId }
    : { tenantId, accountId: subjectId });
  if (!customerId) {
    throw conflict("Connect Stripe first — Settings › Money.");
  }

  // Create the adjustment in Stripe first, then record it in our ledger
  // (so if Stripe fails, we don't record the local row).
  let stripeId = null;
  try {
    const resp = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/customers/${customerId}/balance_transactions`,
      sdk: (s, o, form, query) => s.customers.createBalanceTransaction(customerId, form, o),
      form: {
        // Stripe: a negative balance transaction is credit the customer can spend;
        // our positive amountMinor means "give credit".
        amount: -amountMinor,
        currency: "usd",
        description: `Adjustment: ${note}`,
      },
      idempotencyKey: `credit-adjust:${entryId}`,
      movesMoney: false,
      purpose: "adjust_credit",
      actorUserId,
    });
    stripeId = resp.body?.id;
    if (!stripeId) {
      throw new Error("Stripe CBT create returned no id");
    }
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`);
  }

  // Now record it in our ledger
  const result = await tx.query(
    `INSERT INTO keystone.customer_credit_entry
       (id, tenant_id, subject_type, subject_id, amount_minor, type, stripe_balance_txn_id, note, created_by)
     VALUES ($8, $1, $2, $3, $4, 'adjustment', $5, $6, $7)
     RETURNING id`,
    [tenantId, subjectType, subjectId, amountMinor, stripeId, note, actorUserId, entryId]
  );

  if (result.rowCount === 0) {
    throw new Error("Failed to record credit adjustment");
  }

  // Emit the event in the same transaction
  await emit(tx, {
    tenantId,
    topic: "money.credit.adjusted",
    emittedBy: "money",
    subjectType,
    subjectId,
    actor: userActor(actorUserId),
    // ★ `note` dropped from the payload (§2.4 — no text keys). Already on the record
    //   (`keystone.customer_credit_entry.note`, INSERTed above); no consumer of
    //   `money.credit.adjusted` reads `payload.note` (grepped src/, n8n/workflows/) — a listener
    //   reads the note from the current ledger row by `entryId`.
    payload: {
      subject_type: subjectType,
      subject_id: subjectId,
      amount_minor: amountMinor,
      stripe_balance_txn_id: stripeId,
    },
  });

  return { entryId, stripeId };
}

/**
 * Get the credit balance for a subject as SUM(amount_minor) from the ledger.
 * @param {object} tx a tenant transaction
 * @param {string} tenantId
 * @param {string} subjectType 'person' or 'account'
 * @param {string} subjectId
 * @returns {Promise<number>} balance in minor units (signed)
 */
export async function getCreditBalance(tx, tenantId, subjectType, subjectId) {
  const result = await tx.query(
    `SELECT COALESCE(SUM(amount_minor), 0) as balance
       FROM keystone.customer_credit_entry
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3`,
    [tenantId, subjectType, subjectId]
  );
  return result.rows[0]?.balance ?? 0;
}

/**
 * List credit entries for a subject (person or account).
 * @param {object} tx a tenant transaction
 * @param {string} tenantId
 * @param {string} subjectType 'person' or 'account'
 * @param {string} subjectId
 * @param {object} options { limit, offset }
 * @returns {Promise<Array>} array of entries with running balance
 */
export async function listCreditEntries(tx, tenantId, subjectType, subjectId, {
  limit = 50, offset = 0,
} = {}) {
  const rows = await tx.query(
    `SELECT id, created_at, amount_minor, type, stripe_balance_txn_id, invoice_id, credit_note_id, note, created_by
       FROM keystone.customer_credit_entry
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, subjectType, subjectId, limit, offset]
  );

  return rows.rows.map((r) => Object.freeze({
    id: r.id,
    createdAt: r.created_at,
    amountMinor: r.amount_minor,
    type: r.type,
    stripeBalanceTxnId: r.stripe_balance_txn_id,
    invoiceId: r.invoice_id,
    creditNoteId: r.credit_note_id,
    note: r.note,
    createdBy: r.created_by,
  }));
}

/**
 * Record a balance delta from a Stripe webhook (invoice finalize/paid, etc.).
 * Idempotent by stripe_balance_txn_id — a replay inserts nothing.
 * @param {object} tx a tenant transaction
 * @param {object} params {
 *   tenantId, subjectType, subjectId, amountMinor, type,
 *   stripeBalanceTxnId, invoiceId, creditNoteId
 * }
 * @returns {Promise<boolean>} true if a row was inserted, false if it was a replay
 */
export async function recordWebhookCreditDelta(tx, {
  tenantId, subjectType, subjectId, amountMinor, type, stripeBalanceTxnId, invoiceId, creditNoteId,
} = {}) {
  if (!['applied_to_invoice', 'unapplied_from_invoice', 'credit_note'].includes(type)) {
    throw invalid(`type must be a webhook type, got '${type}'`);
  }
  if (!stripeBalanceTxnId) {
    throw invalid("stripeBalanceTxnId is required for webhook entries");
  }

  const result = await tx.query(
    `INSERT INTO keystone.customer_credit_entry
       (tenant_id, subject_type, subject_id, amount_minor, type, stripe_balance_txn_id, invoice_id, credit_note_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, stripe_balance_txn_id) WHERE stripe_balance_txn_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [tenantId, subjectType, subjectId, amountMinor, type, stripeBalanceTxnId, invoiceId, creditNoteId]
  );

  return result.rowCount === 1;
}
