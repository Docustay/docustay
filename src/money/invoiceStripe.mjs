// Stage 20 Task 20.60 — CREATE AND FINALIZE STRIPE INVOICES
//
// ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES.
// When our invoices are sent, we create a Stripe Invoice on the connected account.
// The mirror carries stripe_invoice_id, invoice_pdf_url, amounts, collection_method,
// effective_at, and finalization errors (stored verbatim, never reworded).
//
// OUR INVOICE NUMBER WINS: `number` is NOT sent to Stripe. Our number renders
// through custom_fields / the description header. Stripe generates its own sequence.
//
// NO CHARGE HAPPENS HERE: movesMoney: false on create and finalize. The charge path
// is off (KEYSTONE_STRIPE_CHARGES_ENABLED is false). 20.63 adds collection switching;
// 20.65 adds tax context; 20.68 adds rendering.
//
// THE PDF NEVER SHOWS stripe.com INLINE: GET /api/money/invoices/:id/pdf → 302
// to the mirrored URL. Our chrome does not embed it.
//
// A FINALIZATION ERROR IS STORED AND SURFACED VERBATIM — Stripe's own message,
// never a reworded one.

import { invalid, conflict } from "../http/errors.mjs";
import { metadataFor } from "./metadata.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { getSetting } from "../settings/writes.mjs";
import { asPracticeOwner } from "./asPracticeOwner.mjs";

const SECTION = "money";

/**
 * ★ PUSH AN INVOICE TO STRIPE: create + finalize, store the result.
 *
 * Called from invoiceSend() BEFORE the Resend email is sent.
 *
 * Steps:
 * 1. Build line items with price data snapshots from our lines
 * 2. Create Stripe Invoice (customer, currency, our lines, collection per setting,
 *    auto_advance: false, metadata via metadataFor, custom_fields with our number)
 * 3. Finalize the invoice (auto_advance: false, movesMoney: false)
 * 4. Store stripe_invoice_id, invoice_pdf_url, amounts, effective_at
 * 5. On finalization error: store error message verbatim, return it for the editor band
 *
 * @param tx the transaction
 * @param options {
 *   tenantId, invoiceId, customerId, currency, invoiceNumber, invoicePrefix,
 *   lines (array of {id, name_snapshot, unit_amount_minor, quantity, discount_minor, tax_minor}),
 *   payerUserId, accountId, actorUserId,
 *   collectionMethod (optional, 'send_invoice' | 'charge_automatically'),
 *   paymentMethodTypes (optional, array of method types for this invoice),
 *   statementDescriptor (optional, 5-22 character Stripe-charset string),
 *   memo (optional, Stripe's own "memo"/description field — F859),
 *   footer (optional, Stripe's footer field),
 *   customFields (optional, array of {name, value}, ≤4 — custom_fields[0] is always reserved for
 *     OUR invoice number; these follow it, never displacing it)
 * }
 * @param deps optional { fetchImpl, env } for testing
 * @returns { stripe_invoice_id, invoice_pdf_url, amounts: {total_minor, due_minor}, error?: string }
 */
export async function pushInvoiceToStripe(tx, {
  tenantId, invoiceId, customerId, currency, invoiceNumber, invoicePrefix,
  lines, payerUserId, accountId, actorUserId, dueAt = null,
  collectionMethod, paymentMethodTypes, statementDescriptor,
  memo = null, footer = null, customFields = [],
  // ★ The local row's own `stripe_invoice_id` — set when an EARLIER Send attempt reached Stripe's
  //   finalize call before its own transaction committed (specs/INVOICE-SEND-FIX.md §2.3).
  existingStripeInvoiceId = null,
} = {}, deps = {}) {
  if (!tenantId || !invoiceId || !customerId) {
    throw invalid("tenantId, invoiceId, customerId are required");
  }

  // ── Step 1: Build line items with price data snapshots ────────────────────────────────────────
  // ★ F858/pushInvoiceToStripe follow-up (the maintainer, 1 Oct 2026 — "fix it as part of Part 3, don't
  //   defer it") — MEASURED directly against the real Stripe test account:
  //   · Invoice Items reject `amount` and `quantity` together ("You may only specify one of
  //     these parameters") — the real working pair is `unit_amount_decimal` (a STRING, in the
  //     SAME minor units as `amount` — i.e. "5000" means $50.00, NOT "50.00") + `quantity`.
  //   · A listed/retrieved item's own price lives at `item.pricing.unit_amount_decimal`, not
  //     nested under `pricing.price_details`.
  //   The PRE-FIX code here computed `unit_amount_decimal` as DOLLARS (`/100), which — had it ever
  //   actually been sent, rather than discarded below — would have been 100× too small; it also
  //   sent `amount` alone regardless, so every finalized invoice has shown quantity=1 on Stripe's
  //   own hosted page/PDF with the full line total standing in for the unit price (F858's SCOPE
  //   note, now closed here). Same fallback as the draft-sync path: a line with a nonzero
  //   discount/tax has no clean per-unit translation without wiring Stripe's own discount/tax_rate
  //   objects (SPEC-GAP, out of scope) — it falls back to the old flat-`amount`-only shape, correct
  //   in total, not in the displayed quantity breakdown for that one line.
  const stripeLineItems = lines.map((line) => {
    const hasAdjustment = line.discount_minor !== 0 || line.tax_minor !== 0;
    const amount = Math.round(line.unit_amount_minor * line.quantity - line.discount_minor + line.tax_minor);
    return {
      description: line.name_snapshot,
      currency: currency.toLowerCase(),
      discountable: true, // Allow further discounts in Stripe if needed
      ...(hasAdjustment
        ? { amount }
        : { unit_amount_decimal: String(line.unit_amount_minor), quantity: line.quantity }),
    };
  });

  // ── Step 2: Create Stripe Invoice ──────────────────────────────────────────────────────────────
  const fullInvoiceNumber = invoicePrefix ? invoicePrefix + invoiceNumber : invoiceNumber;

  // ★ Per-invoice collectionMethod overrides the practice default; if neither is set, default is send_invoice.
  //   Statement descriptor is validated (5-22 chars, Stripe charset [A-Za-z0-9 .\-]*), then passed to Stripe.
  //   Payment method types are sent as payment_settings[payment_method_types].
  // ★ auto_advance: While KEYSTONE_STRIPE_CHARGES_ENABLED is false, auto_advance stays false even if
  //   collection_method is charge_automatically — Stripe cannot advance while the platform blocks charges.
  let finalCollectionMethod = collectionMethod;
  if (!finalCollectionMethod) {
    finalCollectionMethod = await getSetting(
      tx, 'invoices.collection_default', 'send_invoice'
    );
  }

  // ★ the maintainer, 1 Oct 2026 — Stripe REQUIRES one of `due_date`/`days_until_due` on a `send_invoice`
  //   invoice (the OTHER real bug this QA access found — see this function's own header). `dueAt`
  //   is our own computed due date when one exists; when the practice has no payment-terms setting
  //   at all (`dueAt` null), 30 days is the same fallback Stripe's own dashboard defaults to, not
  //   an invented number.
  let dueDateFields = {};
  if (finalCollectionMethod === "send_invoice") {
    dueDateFields = dueAt
      ? { due_date: Math.floor(new Date(dueAt).getTime() / 1000) }
      : { days_until_due: 30 };
  }

  // Validate statement_descriptor if provided (Stripe rule: 5-22 chars, charset [A-Za-z0-9 .\-]*)
  if (statementDescriptor) {
    if (typeof statementDescriptor !== 'string' || statementDescriptor.length < 5 || statementDescriptor.length > 22) {
      throw invalid('statement_descriptor must be 5 to 22 characters');
    }
    if (!/^[A-Za-z0-9 .\-]*$/.test(statementDescriptor)) {
      throw invalid('statement_descriptor must contain only letters, numbers, spaces, periods and hyphens');
    }
  }

  // ★ R6 (RECONCILE, the maintainer 27 Sep) — `validDescriptor` was read below but never declared, so every push threw a
  //   ReferenceError. Ruling: the practice's `money.statement_descriptor` setting, trimmed to Stripe's 22-char
  //   limit, or none. A per-invoice `statementDescriptor` (validated just above) still wins when a caller passes one.
  const practiceDescriptor = await getSetting(tx, 'money.statement_descriptor', null);
  const validDescriptor = statementDescriptor
    || (typeof practiceDescriptor === 'string' && practiceDescriptor.trim()
      ? practiceDescriptor.trim().slice(0, 22)
      : null);

  // ★★★ the maintainer, 1 Oct 2026 — FOUND LIVE, the FIRST real invoice send this QA access made possible:
  //     Stripe refused `POST /v1/invoices` with "Received unknown parameter: line_items" — that
  //     endpoint has never accepted line items inline (unlike Checkout Sessions or Payment Links,
  //     which do). Stripe's actual, documented shape is: create the (empty) draft invoice, create
  //     each line as its own Invoice Item with `invoice: <the draft's id>`, THEN finalize — finalize
  //     is what pulls the attached items onto the invoice and computes totals. Every real invoice
  //     with more than zero lines has hit this exact error since this function shipped; nothing
  //     caught it earlier because HELD kept charges off and nobody had sent a real multi-line
  //     invoice through to a live Stripe account and checked the response until now.
  // ★ F859 (FINDINGS-OPEN.md) — `description` is Stripe's real "memo" field (Dashboard-labeled
  //   "memo"; STRIPE-ENUMERATION.md:96), not a slot for our own number — that's already shown via
  //   `custom_fields[0]` below.
  const createForm = {
    customer: customerId,
    currency: currency.toLowerCase(),
    collection_method: finalCollectionMethod,
    auto_advance: false, // We control state, not Stripe
    ...dueDateFields,
  };
  if (memo) createForm.description = memo;
  if (footer) createForm.footer = footer;

  // Convert metadata back to flat keys for form encoding
  const metaObj = metadataFor("invoice", {
    person_id: payerUserId,
    practice_id: tenantId,
    invoice_id: invoiceId,
    account_id: accountId,
  });
  for (const [k, v] of Object.entries(metaObj)) {
    createForm[`metadata[${k}]`] = v;
  }

  // ★ custom_fields[0] is always OUR number (same reservation the editor/preview already makes);
  //   the practice's own ≤4 custom fields follow, never displacing it.
  createForm["custom_fields[0][name]"] = "Invoice #";
  createForm["custom_fields[0][value]"] = fullInvoiceNumber;
  (Array.isArray(customFields) ? customFields : []).filter((f) => f && f.name).slice(0, 3).forEach((f, i) => {
    createForm[`custom_fields[${i + 1}][name]`] = f.name;
    createForm[`custom_fields[${i + 1}][value]`] = f.value ?? "";
  });

  // Add payment_settings if payment_method_types are specified
  if (paymentMethodTypes && Array.isArray(paymentMethodTypes) && paymentMethodTypes.length > 0) {
    paymentMethodTypes.forEach((method, idx) => {
      createForm[`payment_settings[payment_method_types][${idx}]`] = method;
    });
  }

  // Add statement_descriptor if provided
  if (validDescriptor) {
    createForm.statement_descriptor = validDescriptor;
  }

  // ◆ 20.65 TAX CONTEXT — Add practice tax IDs to invoice header and customer tax context
  const practiceTaxIds = await getSetting(tx, 'practice.tax_ids', null);
  if (practiceTaxIds && typeof practiceTaxIds === 'object') {
    // account_tax_ids is a key-value map sent to Stripe for invoice header
    Object.entries(practiceTaxIds).forEach(([key, value], idx) => {
      createForm[`account_tax_ids[${idx}][type]`] = key;
      createForm[`account_tax_ids[${idx}][value]`] = value;
    });
  }

  // Get customer's tax_exempt status if this is an account payer
  if (payerUserId) {
    const taxRes = await tx.query(
      `SELECT tax_exempt FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
      [tenantId, payerUserId]
    );
    if (taxRes.rows.length > 0 && taxRes.rows[0].tax_exempt) {
      createForm.tax_exempt = taxRes.rows[0].tax_exempt;
    }
  }

  let stripeInvoiceId = null;
  let invoicePdfUrl = null;
  let amountTotal = 0;
  let amountDue = 0;
  let finalizationError = null;
  let alreadyFinalized = false;
  let hostedInvoiceUrl = null;

  // ★★★ specs/INVOICE-SEND-FIX.md §2.3 — REUSE ONLY A PREVIOUS SEND'S OWN FINALIZED INVOICE.
  //   `existingStripeInvoiceId` is the local row's own `stripe_invoice_id`. With editing now
  //   the platform-only (no live Stripe draft created while typing), the only way this field is ever
  //   non-null going into a Send is a PRIOR Send that reached Stripe's finalize call before this
  //   same transaction failed to commit (a retry) — in which case Stripe's object is `open`/`paid`
  //   and reusing it (not re-finalizing, not creating a second one) is exactly correct. Anything
  //   else found at this id — still `draft`, `void`, `uncollectible`, or gone entirely — is NOT a
  //   safe thing to finalize or build on (a draft here is leftover data, e.g. from before this
  //   fix; a void/uncollectible one is a dead end): fall through to a genuinely fresh create below,
  //   the same as if `existingStripeInvoiceId` had never been set.
  let reused = false;
  let staleIdDetected = false;
  if (existingStripeInvoiceId) {
    try {
      const existingRetrieved = await stripeConnectedRequest(tx, {
        tenantId,
        method: "GET",
        path: `/invoices/${existingStripeInvoiceId}`,
        sdk: (s, o) => s.invoices.retrieve(existingStripeInvoiceId, {}, o),
        movesMoney: false,
        purpose: "retrieve_invoice_before_send",
        actorUserId,
      }, deps);
      if (existingRetrieved.body.status === "open" || existingRetrieved.body.status === "paid") {
        // ★ Already finalized by an earlier Send attempt whose own transaction rolled back AFTER
        //   the Stripe side effect went through (e.g. a throw in this same function's Step 4, or
        //   anywhere later in sendInvoice's transaction) — the retry that got us here must not
        //   create or finalize a second time. Stripe already has the real, final numbers; use them.
        stripeInvoiceId = existingRetrieved.body.id;
        reused = true;
        alreadyFinalized = true;
        invoicePdfUrl = existingRetrieved.body.pdf || existingRetrieved.body.invoice_pdf;
        amountTotal = existingRetrieved.body.total || 0;
        amountDue = existingRetrieved.body.amount_due || 0;
        hostedInvoiceUrl = existingRetrieved.body.hosted_invoice_url || null;
      } else {
        // draft / void / uncollectible — not something a Send may build on. Treated as stale so
        // the create below uses a nonce'd idempotency key rather than replaying Stripe's cache.
        staleIdDetected = true;
      }
    } catch (retrieveErr) {
      // ★ The existing id is stale (e.g. deleted directly in Stripe, or belongs to a disconnected
      //   account) — fall through to the normal create path below exactly as if no
      //   existingStripeInvoiceId had ever been passed. Never block a real Send over a dead
      //   reference nobody can reach anymore.
      staleIdDetected = true;
    }
  }

  try {
    if (!reused) {
      // Create the invoice
      const createResult = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: "/invoices",
        sdk: (s, o, form, query) => s.invoices.create(form, o),
        form: createForm,
        // ★ Same nonce-on-stale fix as ensureStripeDraft's own (invoiceDraftSync.mjs) — the plain
        //   deterministic key stays for genuine retry-safety (a legitimate retry after a local
        //   rollback replays the SAME still-valid Stripe object, no duplicate). It is ONLY varied
        //   when `existingStripeInvoiceId` was provided but turned out stale (deleted on Stripe's
        //   side): without a nonce there, Stripe's idempotency cache would hand back whatever
        //   THIS exact key last created — which, in the stale case, risks being a dead reference
        //   if this same create path was ever reached before for this invoice and later deleted.
        idempotencyKey: staleIdDetected
          ? `invoice:${tenantId}:${invoiceId}:restale:${Date.now()}`
          : `invoice:${tenantId}:${invoiceId}`,
        movesMoney: false, // No charge here
        purpose: "create_invoice",
        actorUserId,
      }, deps);

      stripeInvoiceId = createResult.body.id;
      amountTotal = createResult.body.total || 0;
      amountDue = createResult.body.amount_due || 0;

      // ── Step 2b: Attach each line as its own Invoice Item, BEFORE finalizing ───────────────────
      // ★ One `POST /invoiceitems` per line, `invoice: stripeInvoiceId` pins it to THIS draft rather
      //   than leaving it "pending" (which would attach to whatever invoice Stripe creates next for
      //   this customer — wrong, since that invoice already exists). Sends `unit_amount_decimal` +
      //   `quantity` (the real pair, F858) so Stripe's own hosted page/PDF shows the actual per-unit
      //   price and quantity, not a flattened total at quantity 1 — see Step 1's own header comment.
      for (const line of stripeLineItems) {
        await stripeConnectedRequest(tx, {
          tenantId,
          method: "POST",
          path: "/invoiceitems",
          sdk: (s, o, form) => s.invoiceItems.create(form, o),
          form: {
            customer: customerId,
            invoice: stripeInvoiceId,
            currency: line.currency,
            description: line.description,
            ...(line.discountable !== undefined ? { discountable: line.discountable } : {}),
            ...("unit_amount_decimal" in line ? { unit_amount_decimal: line.unit_amount_decimal, quantity: line.quantity } : { amount: line.amount }),
          },
          movesMoney: false,
          purpose: "invoice_line_item",
          actorUserId,
        }, deps);
      }
    }

    // ── Step 3: Finalize the invoice ──────────────────────────────────────────────────────────
    //   Skipped entirely when `alreadyFinalized` — a retry whose earlier attempt's Stripe call
    //   already landed; re-finalizing an already-finalized invoice is itself a Stripe error
    //   ("already finalized"), so Step 4 below runs directly off the values the GET retrieve
    //   (above) already captured.
    try {
      if (!alreadyFinalized) {
        const finalizeResult = await stripeConnectedRequest(tx, {
          tenantId,
          method: "POST",
          path: `/invoices/${stripeInvoiceId}/finalize`,
          sdk: (s, o, form, query) => s.invoices.finalizeInvoice(stripeInvoiceId, form, o),
          form: {
            auto_advance: false, // Do not auto-advance
          },
          movesMoney: false, // No charge here; charging happens in 20.65
          purpose: "finalize_invoice",
          actorUserId,
        }, deps);

        // Extract PDF URL from finalized invoice
        invoicePdfUrl = finalizeResult.body.pdf || finalizeResult.body.invoice_pdf;
        amountTotal = finalizeResult.body.total || amountTotal;
        amountDue = finalizeResult.body.amount_due || amountDue;
        hostedInvoiceUrl = finalizeResult.body.hosted_invoice_url || null;

        // ─ Saved-card brief, Part 3 — "belt and braces": Stripe has no create-time
        //   setup_future_usage field on an Invoice; the documented way is to update the PaymentIntent
        //   the finalize step just created (confirmed via Stripe's own docs, 1 Oct 2026 — an invoice
        //   whose amount_due is 0 has no payment_intent at all, hence the guard). Best-effort: the
        //   invoice itself is already finalized and real; failing to also mark its PI for future use
        //   must never undo that or block the caller — the payment_method.attached webhook still
        //   saves the card once the client actually pays, this only makes that more reliable.
        if (finalizeResult.body.payment_intent) {
          const piId = typeof finalizeResult.body.payment_intent === "string"
            ? finalizeResult.body.payment_intent : finalizeResult.body.payment_intent.id;
          try {
            await stripeConnectedRequest(tx, {
              tenantId,
              method: "POST",
              path: `/payment_intents/${piId}`,
              sdk: (s, o, form) => s.paymentIntents.update(piId, form, o),
              form: { setup_future_usage: "off_session" },
              movesMoney: false,
              purpose: "invoice_pi_setup_future_usage",
              actorUserId,
            }, deps);
          } catch (sfuErr) {
            // Logged, never thrown — see the note above.
            console.error(`invoiceStripe: could not set setup_future_usage on PaymentIntent ${piId}: ${sfuErr.message}`);
          }
        }
      }

      // ── Step 4: Store the Stripe mirror columns ───────────────────────────────────────────────
      // ★ F857/F856 (FINDINGS-OPEN.md) — this UPDATE is reachable from a no-viewer tx (confirmed:
      //   src/routes/publicMoney.mjs → acceptEstimate → runEstimateAcceptanceSteps → sendInvoice →
      //   HERE, with no asPracticeOwner anywhere in that chain) and, per F857's own measured root
      //   cause, a no-viewer UPDATE against keystone.invoice silently affects 0 rows — so this is
      //   wrapped the same way invoiceDraftSync.mjs's own writes now are. Also closes F856 (a real
      //   reader of `hosted_invoice_url` already existed in invoicePublic.mjs; nothing ever wrote
      //   it) — now stored at the same finalize step everything else lands at.
      const mirrorUpdate = await asPracticeOwner(tx, tenantId, () => tx.query(
        `UPDATE keystone.invoice
         SET stripe_invoice_id = $1,
             invoice_pdf_url = $2,
             collection_method = $3,
             amount_remaining_minor = $4,
             amount_overpaid_minor = 0,
             statement_descriptor = $5,
             payment_method_types = $6,
             hosted_invoice_url = $7,
             effective_at = now(),
             updated_at = now()
         WHERE tenant_id = $8 AND id = $9`,
        [stripeInvoiceId, invoicePdfUrl, finalCollectionMethod, amountDue, validDescriptor || null,
         paymentMethodTypes ? JSON.stringify(paymentMethodTypes) : null, hostedInvoiceUrl, tenantId, invoiceId]
      ));
      if (mirrorUpdate.rowCount === 0) {
        throw new Error(`pushInvoiceToStripe: mirror UPDATE affected 0 rows for invoice ${invoiceId} — the Stripe invoice ${stripeInvoiceId} was created and finalized but the local mirror was not saved`);
      }

      await emit(tx, {
        tenantId,
        topic: "money.invoice.stripe_created",
        emittedBy: SECTION,
        subjectType: "invoice",
        subjectId: invoiceId,
        actor: userActor(actorUserId),
        // ★ `invoice_pdf_url` dropped from the payload (§2.4 — no text keys). Already on the
        //   record (`keystone.invoice.invoice_pdf_url`, UPDATEd above); `src/routes/money.mjs`
        //   reads `invoice.invoice_pdf_url` fresh from the row rather than from any event, and
        //   grepping src/ and n8n/workflows/ found no reader of `payload.invoice_pdf_url`.
        payload: {
          stripe_invoice_id: stripeInvoiceId,
          amount_total_minor: amountTotal,
          amount_due_minor: amountDue,
        },
      });

      return {
        stripe_invoice_id: stripeInvoiceId,
        invoice_pdf_url: invoicePdfUrl,
        amounts: {
          total_minor: amountTotal,
          due_minor: amountDue,
        },
      };
    } catch (finalizeErr) {
      // ── Step 5: Store finalization error verbatim ──────────────────────────────────────────
      finalizationError = finalizeErr.message || String(finalizeErr);

      // ★ F855 FIX, 1 Oct 2026 (Part 3 rebuild) — this used to write the error message into
      //   `statement_descriptor`, a real card-statement label column, not an error scratchpad.
      //   `last_finalization_error` (migration 0558) is the correct, dedicated column.
      // ★ F857 — same no-viewer-UPDATE gap as Step 4's own mirror UPDATE above; wrapped the same
      //   way. ★ Deliberately swallowed if THIS write itself fails (e.g. asPracticeOwner finds no
      //   owner) — we are already inside a catch block handling a REAL finalization error; letting
      //   a secondary failure here replace it would hide the actual cause from whoever reads the
      //   thrown/returned error next. Best-effort persistence, never a second point of failure.
      try {
        await asPracticeOwner(tx, tenantId, () => tx.query(
          `UPDATE keystone.invoice
           SET stripe_invoice_id = $1,
               last_finalization_error = $2,
               effective_at = now(),
               updated_at = now()
           WHERE tenant_id = $3 AND id = $4`,
          [stripeInvoiceId, finalizationError, tenantId, invoiceId]
        ));
      } catch (persistErr) {
        console.error(`pushInvoiceToStripe: could not persist the finalization error for invoice ${invoiceId}: ${persistErr.message}`);
      }

      // ★ Full message already on the record (`statement_descriptor`, UPDATEd above, "shown in
      //   editor band"). The event carries only an enum-shaped `error_code` (§2.4); no consumer
      //   of `money.invoice.stripe_error` reads `payload.error_message` (grepped src/,
      //   n8n/workflows/).
      await emit(tx, {
        tenantId,
        topic: "money.invoice.stripe_error",
        emittedBy: SECTION,
        subjectType: "invoice",
        subjectId: invoiceId,
        actor: userActor(actorUserId),
        payload: {
          stripe_invoice_id: stripeInvoiceId,
          error_code: "stripe_error",
        },
      });

      return {
        stripe_invoice_id: stripeInvoiceId,
        error: finalizationError,
      };
    }
  } catch (createErr) {
    // Error during create; don't store anything
    throw createErr;
  }
}

/**
 * ★ VOID A STRIPE INVOICE WHEN PRESENT.
 *
 * Called from voidInvoice() in invoices.mjs after the Keystone void succeeds.
 * If stripe_invoice_id is present, sends a void request to Stripe.
 * If not present, completes silently (no error).
 *
 * @param tx the transaction
 * @param options { tenantId, invoiceId, actorUserId }
 * @param deps optional { fetchImpl, env } for testing
 */
export async function voidStripeInvoice(tx, {
  tenantId, invoiceId, actorUserId,
} = {}, deps = {}) {
  if (!tenantId || !invoiceId) {
    throw invalid("tenantId and invoiceId are required");
  }

  // Load the invoice to check for stripe_invoice_id
  const { rows } = await tx.query(
    `SELECT stripe_invoice_id FROM keystone.invoice
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, invoiceId]
  );

  if (rows.length === 0) {
    throw new Error("Invoice not found");
  }

  const stripeInvoiceId = rows[0].stripe_invoice_id;

  // If no Stripe ID, skip silently
  if (!stripeInvoiceId) {
    return { voided: false, reason: "no_stripe_invoice" };
  }

  // Send void request to Stripe
  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/invoices/${stripeInvoiceId}/void`,
      sdk: (s, o, form, query) => s.invoices.voidInvoice(stripeInvoiceId, {}, o),
      form: {},
      movesMoney: false,
      purpose: "void_invoice",
      actorUserId,
    }, deps);

    return { voided: true, stripe_invoice_id: stripeInvoiceId };
  } catch (err) {
    // Log the error but don't fail the void — the Keystone void succeeded
    // ★ Full message kept in the logger and in the returned `error` (caller-visible), never in
    //   the event. `error_code` is a fixed token (err has no enum-shaped `.code` here). No
    //   consumer of `money.invoice.stripe_void_error` reads `payload.error_message` (grepped
    //   src/, n8n/workflows/; `src/audit/queries.mjs` only maps the topic to a fixed label).
    console.error(`invoice ${invoiceId} void: Stripe void failed: ${err.message}`);
    await emit(tx, {
      tenantId,
      topic: "money.invoice.stripe_void_error",
      emittedBy: SECTION,
      subjectType: "invoice",
      subjectId: invoiceId,
      actor: userActor(actorUserId),
      payload: {
        stripe_invoice_id: stripeInvoiceId,
        error_code: "stripe_error",
      },
    });

    return { voided: false, error: err.message };
  }
}

// ◆ 20.63 COLLECTION

/**
 * ★ APPLY RENDERING OVERRIDES TO STRIPE INVOICE (Task 20.68)
 *
 * Called from invoiceSend() AFTER stripe is created and finalized.
 * Applies stored rendering params: page_size, footer, custom_fields (≤4),
 * and template-id metadata.
 *
 * @param tx the transaction
 * @param options { tenantId, invoiceId, stripeInvoiceId, rendering, actorUserId }
 * @param deps optional for testing
 * @returns { applied: boolean, fields?: number }
 */
export async function applyRenderingOverrides(tx, {
  tenantId, invoiceId, stripeInvoiceId, rendering = {}, actorUserId,
} = {}, deps = {}) {
  if (!tenantId || !invoiceId || !stripeInvoiceId) return { applied: false };
  if (!rendering || typeof rendering !== 'object') return { applied: false };

  const { page_size, footer, custom_fields, template_id } = rendering;
  if (!page_size && !footer && !custom_fields && !template_id) {
    return { applied: false };
  }

  // ★ Validate custom_fields: max 4, enforce the limit
  if (custom_fields && Array.isArray(custom_fields)) {
    if (custom_fields.length > 4) {
      throw invalid('custom fields limited to 4');
    }
  }

  // ★ Store the rendering overrides on the invoice row (already migrated 0490)
  const renderingJson = { page_size, footer, custom_fields, template_id };
  await tx.query(
    `UPDATE keystone.invoice
     SET rendering = $1, updated_at = now()
     WHERE tenant_id = $2 AND id = $3`,
    [JSON.stringify(renderingJson), tenantId, invoiceId]
  );

  await emit(tx, {
    tenantId,
    topic: "money.invoice.rendering_updated",
    emittedBy: "money",
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: renderingJson,
  });

  return { applied: true, fields: custom_fields ? custom_fields.length : 0 };
}
