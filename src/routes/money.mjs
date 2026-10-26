// Stage 15 Task 15.33 — MONEY ROUTES: the read surface for staff money screens

import { forbidden, notFound, invalid } from "../http/errors.mjs";
import { authoriseSection, atLeastRank } from "../nav/authorise.mjs";
import {
  invoicesSummary, invoiceRecord, paymentsList, paymentDetail, creditsSummary,
  subscriptionsSummary, subscriptionRecord, estimatesList,
} from "../money/reads.mjs";
import { estimateEditor } from "../money/estimates.mjs";
// ★ P3.S3 — preview a credit note before issuing (no Stripe write, no local mutation).
import { previewCreditNote, listInvoiceCreditNotes } from "../money/creditNotes.mjs";
import { listPayouts, payoutDetail, payoutReconcile, balancesModel, listDisputes, listPayoutsLive, balancesLive, listDisputesLive } from "../money/payouts.mjs";
import { accountManagementRead, accountManagementUpdate } from "../money/accountManagement.mjs";
import { taxRead } from "../money/tax.mjs";
import { paymentLinksList, paymentLinksCreate, paymentLinksDeactivate } from "../money/paymentLinksApi.mjs";
import { subscriptionsListLive, createMultiItemSubscription } from "../money/subscriptions.mjs";
import { disputeDetail } from "../money/disputes.mjs";
import { listDevices, deviceStatus } from "../money/devices.mjs";
import { stripeConnectedRequest } from "../money/stripeConnected.mjs";
import { listStatements, requestStatement, downloadStatement } from "../money/statements.mjs";
// ★ P3.S11 — list open Stripe Radar reviews; dispute.view is asked here, not by `read`'s coarse
//   section gate (same shape P3.S3's `previewCreditNote` uses for `invoice.view`).
import { listFraudReviews } from "../money/fraud.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { applyPersonCoupon, removePersonCoupon } from "../money/discountApply.mjs";
// ★ P3.S6 — preview a subscription's next invoice (no Stripe write, no local mutation).
import { previewSubscriptionInvoice } from "../money/subscriptions.mjs";
// NOTE: payment-links list read function does not exist yet; that route is skipped
// NOTE: estimate record/detail read function does not exist yet; that route is skipped

/**
 * Register money staff read routes.
 * Every route is staff-only (rank floor admin), guarded by /money/* or /settings/money nav paths.
 */
export function registerMoneyRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  const read = (section, fn) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden("money routes are for staff only.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, section, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, "admin");
      return fn({ ...ctx, req: c.req });
    }, { bucket: "settings" }).then((r) => c.json(r, 200));

  // ─────────────────────────────────────────────────────────────────────────
  // Payouts and balances
  // ─────────────────────────────────────────────────────────────────────────
  // ★ the maintainer's ruling, 28 Sep 2026 — "no embedded Stripe screens, build in React on the Stripe API."
  //   These now call Stripe live (payouts.mjs's *Live variants) instead of our webhook-fed mirror,
  //   which was empty for Docustay (the webhook that would fill it was never wired to us until tonight).
  app.get("/api/money/payouts", read("/money/payouts", async ({ db, tenantId }) =>
    ({ payouts: await listPayoutsLive(db, { tenantId }) })));

  app.get("/api/money/payouts/:id", read("/money/payouts", async ({ db, tenantId, req }) =>
    payoutDetail(db, { tenantId, payoutId: req.param("id") })));

  app.get("/api/money/payouts/:id/reconcile", read("/money/payouts", async ({ db, tenantId, req }) =>
    payoutReconcile(db, { tenantId, payoutId: req.param("id") })));

  app.get("/api/money/balances", read("/money/payouts", async ({ db, tenantId }) =>
    balancesLive(db, { tenantId })));

  // ─────────────────────────────────────────────────────────────────────────
  // Disputes
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/disputes", read("/money/disputes", async ({ db, tenantId }) =>
    ({ disputes: await listDisputesLive(db, { tenantId }) })));

  app.get("/api/money/disputes/:id", read("/money/disputes", async ({ db, tenantId, req }) =>
    disputeDetail(db, { tenantId, disputeId: req.param("id") })));

  // ─────────────────────────────────────────────────────────────────────────
  // Invoices
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/invoices/summary", read("/money/invoices", async ({ db, tenantId }) =>
    invoicesSummary(db, { tenantId })));

  // ★ Registered BEFORE `/invoices/:id` — after it, "templates" was taken as an invoice id.
  app.get("/api/money/invoices/templates", read("/money/invoices", async () => {
    // ★ Rendering templates are listed when present and never required.
    // An empty list is a valid, ordinary answer, not an error.
    return { templates: [] };
  }));

  app.get("/api/money/invoices/:id", read("/money/invoices", async ({ db, tenantId, req }) =>
    invoiceRecord(db, { tenantId, invoiceId: req.param("id") })));

  // ★ PDF PROXY: 302 redirect to Stripe Invoice PDF (never embed stripe.com inline)
  app.get("/api/money/invoices/:id/pdf", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden("money routes are for staff only.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/money/invoices", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, "admin");

      const invoice = await invoiceRecord(ctx.db, { tenantId: ctx.tenantId, invoiceId: c.req.param("id") });
      if (!invoice?.invoice_pdf_url) {
        throw notFound("Invoice PDF not available");
      }

      return c.redirect(invoice.invoice_pdf_url, 302);
    }, { bucket: "settings" }));

  // ★★★ the maintainer, 29 Sep 2026 — F: REWRITTEN. InvoiceEditor.jsx (863 lines, R6.035) had no route until
  //   today (SLIDEUP-AUDIT.md's headline finding) — nothing had ever exercised this connection.
  //   MEASURED against the frontend's own fetchInvoice(): it reads `res.invoice` (a NESTED object,
  //   snake_case field names — invoice.payer_user_id, invoice.due_at, invoice.custom_fields,
  //   invoice.payer_display_name, invoice.issued_at, invoice.reminders_disabled) and separately
  //   `res.lineItems` / `res.reminders` / `res.templates`. This route returned a FLAT, camelCase
  //   object with no `lineItems` key at all — `inv = res?.invoice` was always undefined, so opening
  //   ANY existing invoice in this editor always hit "Invoice not found", and even past that,
  //   lineItems always fell back to `[]` regardless of what the invoice actually had. Rewritten to
  //   the shape the frontend already expects, rather than rewrite 863 lines of already-consistent
  //   frontend state handling to match a route nothing had ever proven out.
  app.get("/api/money/invoices/:id/editor", read("/money/invoices", async ({ db, tenantId, req }) => {
    const { rows: invoiceRows } = await db.query(
      `SELECT i.id, i.status, i.updated_at, i.payer_user_id, u.display_name AS payer_display_name,
              u.email AS payer_email,
              i.title, i.message, i.due_at, i.issued_at,
              i.custom_fields, i.rendering, i.collection_method, i.payment_method_types,
              i.statement_descriptor, i.stripe_invoice_id, i.hosted_invoice_url, i.tip_minor,
              i.reminders_enabled
         FROM keystone.invoice i
         JOIN keystone.app_user u ON u.tenant_id = i.tenant_id AND u.id = i.payer_user_id
        WHERE i.tenant_id = $1 AND i.id = $2`,
      [tenantId, req.param("id")]);

    if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

    const invoice = invoiceRows[0];

    // ★ Get reminders (unsent only) — {id, offsetDays}, so removing one has an id to key off.
    const { rows: reminderRows } = await db.query(
      `SELECT id, offset_days FROM keystone.invoice_reminder
        WHERE tenant_id = $1 AND invoice_id = $2 AND sent_at IS NULL AND deleted_at IS NULL
        ORDER BY offset_days`,
      [tenantId, req.param("id")]);

    // ★ Same query shape as invoiceSend.mjs's own proven, already-used line-item read (tenant_id +
    //   invoice_id + status='active', ordered by position) — camelCase to match
    //   LineItemTableTable1Table.jsx's own field reads (line.name/.unitAmount/.quantity).
    const { rows: lineItemRows } = await db.query(
      `SELECT id, name_snapshot, unit_amount_minor, quantity, discount_minor, tax_minor
         FROM keystone.line_item
        WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'active'
        ORDER BY position ASC NULLS LAST, created_at ASC`,
      [tenantId, req.param("id")]);

    // ★ the maintainer, 1 Oct 2026 — card audit: InvoiceEditor showed no card at all, for an invoice whose
    //   `collection_method`/`payment_method_types` exist specifically to decide whether it can
    //   charge a card automatically. Same shape `invoiceRecord`/`previewSettlement` already use.
    // ★ STRIPE-MIRROR: the card is read from keystone.person_card_effective (Stripe's payment methods;
    //   detached ones already excluded), not the platform's payment_method cache.
    const { rows: cardRows } = await db.query(
      `SELECT brand, last_four FROM keystone.person_card_effective
        WHERE tenant_id = $1 AND app_user_id = $2 AND is_default = true
        LIMIT 1`,
      [tenantId, invoice.payer_user_id]);
    const payerCard = cardRows[0] ? { brand: cardRows[0].brand, lastFour: cardRows[0].last_four } : null;

    return {
      invoice: {
        id: invoice.id,
        status: invoice.status,
        updated_at: invoice.updated_at,
        payer_user_id: invoice.payer_user_id,
        payer_display_name: invoice.payer_display_name,
        payer_email: invoice.payer_email,
        title: invoice.title,
        message: invoice.message,
        due_at: invoice.due_at,
        issued_at: invoice.issued_at,
        custom_fields: invoice.custom_fields,
        rendering: invoice.rendering,
        collection_method: invoice.collection_method,
        payment_method_types: invoice.payment_method_types,
        statement_descriptor: invoice.statement_descriptor,
        stripe_invoice_id: invoice.stripe_invoice_id,
        hosted_invoice_url: invoice.hosted_invoice_url,
        tip_minor: invoice.tip_minor,
        reminders_enabled: invoice.reminders_enabled,
      },
      payerCard,
      lineItems: lineItemRows.map(r => ({
        id: r.id,
        name: r.name_snapshot,
        unitAmount: r.unit_amount_minor,
        quantity: r.quantity,
        discount: r.discount_minor,
        tax: r.tax_minor,
      })),
      reminders: reminderRows.map(r => ({ id: r.id, offsetDays: r.offset_days })),
      // ★ Presentation templates are a separate, not-yet-built system (no keystone.invoice_template
      //   table exists) — an empty list here means the template picker has nothing but the practice
      //   default, which is correct today, not a bug this route can fix on its own.
      templates: [],
    };
  }));

  // ★ P3.S3 — preview a credit note before issuing it. Query params: invoiceId, lines (JSON).
  app.get("/api/money/credit-notes/preview", read("/money/invoices", async ({ db, tenantId, req, principal }) => {
    const invoiceId = req.query("invoiceId");
    if (!invoiceId) throw invalid("invoiceId is required");
    let lines;
    try {
      lines = JSON.parse(req.query("lines") ?? "[]");
    } catch {
      throw invalid("lines must be valid JSON");
    }
    return previewCreditNote(db, { tenantId, invoiceId, lines, principal });
  }));

  // ★ P3.S4 — list an invoice's credit notes (read: mirror table only, no Stripe call).
  app.get("/api/money/invoices/:id/credit-notes", read("/money/invoices", async ({ db, tenantId, req }) =>
    ({ creditNotes: await listInvoiceCreditNotes(db, { tenantId, invoiceId: req.param("id") }) })));


  // ─────────────────────────────────────────────────────────────────────────
  // Estimates
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/estimates", read("/money/estimates", async ({ db, tenantId, req }) =>
    ({ estimates: await estimatesList(db, { tenantId, status: req.query("status") }) })));

  // ★ PDF PROXY: 302 redirect to Stripe Quote PDF (never embed stripe.com inline)
  app.get("/api/money/estimates/:id/pdf", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden("money routes are for staff only.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/money/estimates", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, "admin");

      const { rows } = await ctx.db.query(
        `SELECT quote_pdf_url FROM keystone.estimate WHERE tenant_id = $1 AND id = $2`,
        [ctx.tenantId, c.req.param("id")]);

      if (rows.length === 0 || !rows[0].quote_pdf_url) {
        throw notFound("Estimate PDF not available");
      }

      return c.redirect(rows[0].quote_pdf_url, 302);
    }, { bucket: "settings" }));

  // NOTE: GET /api/money/estimates/:id is skipped because estimateRecord does not exist

  // ★ T1.23 (F804) — EstimateEditor.svelte's own read, wired to the new estimateEditor() above.
  app.get("/api/money/estimates/:id/editor", read("/money/estimates", async ({ db, tenantId, req }) =>
    estimateEditor(db, { tenantId, id: req.param("id") })));

  // ─────────────────────────────────────────────────────────────────────────
  // Payments
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/payments", read("/money/payments", async ({ db, tenantId, req }) =>
    ({ payments: await paymentsList(db, {
      tenantId,
      range: req.query("range"),
      method: req.query("method"),
      state: req.query("state"),
    }) })));

  app.get("/api/money/payments/:id", read("/money/payments", async ({ db, tenantId, req }) =>
    paymentDetail(db, { tenantId, paymentId: req.param("id") })));

  app.get("/api/money/credits", read("/money/payments", async ({ db, tenantId }) =>
    creditsSummary(db, { tenantId })));

  // ─────────────────────────────────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────────────────────────────────
  // ★ the maintainer's ruling, 28 Sep 2026 — live from Stripe (see subscriptions.mjs's subscriptionsListLive
  //   header for why: keystone.subscription is single-plan-only by schema, and the OLD
  //   subscriptionsSummary never returned a `rows` field at all — MoneySubs.jsx always got an
  //   empty array back, regardless of what actually existed. Both bugs, same fix.
  app.get("/api/money/subscriptions/summary", read("/money/subscriptions", async ({ db, tenantId }) =>
    subscriptionsListLive(db, { tenantId })));

  // ★ P3.S6 — registered BEFORE `/subscriptions/:id` (same fix as `/invoices/templates` above):
  //   after it, "preview" would be taken as a subscription id.
  app.get("/api/money/subscriptions/preview", read("/money/subscriptions", async ({ db, tenantId, req }) => {
    const subscriptionId = req.query("subscriptionId");
    if (!subscriptionId) throw invalid("subscriptionId is required");
    return previewSubscriptionInvoice(db, { tenantId, subscriptionId });
  }));

  app.get("/api/money/subscriptions/:id", read("/money/subscriptions", async ({ db, tenantId, req }) =>
    subscriptionRecord(db, { tenantId, subscriptionId: req.param("id") })));

  // ─────────────────────────────────────────────────────────────────────────
  // Payment links
  // ─────────────────────────────────────────────────────────────────────────
  // ★ T1.23 STOP: the section's own quoted SQL (`SELECT id, title, variant, amount_minor, slug,
  //   stripe_url, active, uses, taken_minor, last_used_at FROM keystone.payment_link …`) names a
  //   column `active` that does not exist on `keystone.payment_link` — the table has `state text
  //   CHECK (state IN ('active','inactive'))` instead (migration 0431, confirmed no later ALTER adds
  //   `active`). Reported per-instructions rather than guessed: this route and `listPaymentLinks`
  //   are left unwritten. See the handoff report for the fix this needs.
  // NOTE: GET /api/money/payment-links is skipped because list function does not exist

  // ─────────────────────────────────────────────────────────────────────────
  // Stripe — publishable key
  // ─────────────────────────────────────────────────────────────────────────
  // ★ T1.23 (F804) — CheckoutAndElements.svelte's own read. Never logs the value; the env var is
  //   read only at request time, same variable name already read elsewhere in src/.
  app.get("/api/money/stripe/keys", read("/money/payments", async () =>
    ({ publishableKey: process.env.KEYSTONE_STRIPE_PUBLISHABLE_KEY ?? null })));

  // ★ P3.S11 — list open Stripe Radar reviews. `read`'s own gate is section-only (staff, admin
  //   rank); `dispute.view` is the finer-grained question, asked here the same way P3.S3's
  //   `previewCreditNote` asks `invoice.view` — an explicit `assertMay` call before the read.
  app.get("/api/money/fraud/reviews", read("/money/payments", async ({ db, tenantId, principal }) => {
    await assertMay(db, principal, { object: "dispute", action: "view" }, {});
    return listFraudReviews(db, { tenantId });
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Devices
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/devices", read("/settings/money", async ({ db, tenantId, deps = {} }) =>
    ({ devices: await listDevices(db, { tenantId }, deps) })));

  // ★ P3.S12 — read a reader's live status from Stripe. `read`'s own gate is section-only
  //   (staff, admin rank); `invoice.view` is the finer-grained question, asked here the same way
  //   P3.S11's fraud/reviews route asks `dispute.view`. Two segments after /devices (":id/status"),
  //   so it is never shadowed by the plain "/api/money/devices" list route above.
  app.get("/api/money/devices/:id/status", read("/settings/money", async ({ db, tenantId, principal, req, deps = {} }) => {
    await assertMay(db, principal, { object: "invoice", action: "view" }, {});
    return deviceStatus(db, { tenantId, deviceId: req.param("id") }, deps);
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Fraud and Radar
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/fraud", read("/money/disputes", async ({ db, tenantId }) => {
    // Fetch early fraud warnings and reviews from Stripe Radar
    // Map only documented fields; never return raw Stripe object or personal fields
    const result = await stripeConnectedRequest(db, {
      tenantId,
      method: "GET",
      path: "/radar/early_fraud_warnings",
      sdk: (s, o, form, query) => s.radar.earlyFraudWarnings.list({}, o),
      movesMoney: false,
      purpose: "read_fraud_warnings",
    });

    // Map warnings to safe fields only
    const warnings = (result.body.data || []).map((w) => ({
      id: w.id,
      status: w.status,
      severity: w.severity,
      created: w.created,
    }));

    // Stub: reviews list (would come from a separate Radar API call in production)
    const reviews = [];

    return { warnings, reviews };
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Account management — real business details/bank/payout-schedule, on the Stripe API
  // (replaces the embedded StripeSurface surface="account_management")
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/account", read("/money/account", async ({ db, tenantId }) =>
    accountManagementRead(db, { tenantId })));

  // ─────────────────────────────────────────────────────────────────────────
  // Tax settings and registrations — real, on the Stripe API
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/tax", read("/money/settings/tax", async ({ db, tenantId }) =>
    taxRead(db, { tenantId })));

  // ─────────────────────────────────────────────────────────────────────────
  // Payment links — real, on Stripe's own Payment Links API (never had a route before tonight —
  // src/routes/money.mjs's own pre-existing comment said as much: "there is no read route for
  // payment links... Screen.svelte called api.moneyPaymentLinks, which does not exist")
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/money/payment-links", read("/money/payment-links", async ({ db, tenantId }) =>
    paymentLinksList(db, { tenantId })));

  // ─────────────────────────────────────────────────────────────────────────
  // Coupons — apply to person
  // ─────────────────────────────────────────────────────────────────────────
  // ★ Write route helper: same auth as read, but returns status 200 and the operation result
  const write = (section, fn) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden("money routes are for staff only.");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, section, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, "admin");
      return fn({ ...ctx, req: c.req });
    }, { bucket: "settings" }).then((r) => c.json(r, 200));

  // ─────────────────────────────────────────────────────────────────
  // Statements — Stripe Reporting API report runs, not the embedded "documents" component (src/money/statements.mjs)
  // ─────────────────────────────────────────────────────────────────
  app.get("/api/money/statements", read("/money/statements", async ({ db, tenantId }) => listStatements(db, { tenantId })));

  app.post("/api/money/statements", write("/money/statements", async ({ db, tenantId, req }) => {
    const body = await req.json().catch(() => ({}));
    return requestStatement(db, { tenantId, month: body?.month, kind: body?.kind });
  }));

  app.get("/api/money/statements/:id/download", async (c) => {
    let file = null;
    await runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") throw forbidden("money routes are for staff only.");
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/money/statements", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      atLeastRank(ctx.principal.user, "admin");
      file = await downloadStatement(ctx.db, { tenantId: ctx.tenantId, runId: c.req.param("id") });
      return null;
    }, { bucket: "settings" });
    return c.body(file.bytes, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
    });
  });

  app.post("/api/money/subscriptions", write("/money/subscriptions", async ({ db, tenantId, req }) => {
    const body = await req.json().catch(() => ({}));
    return createMultiItemSubscription(db, {
      tenantId, personId: body.personId, items: body.items,
      trialDays: body.trialDays ?? 0, collectionMethod: body.collectionMethod ?? "send_invoice",
      description: body.description ?? null,
    });
  }));

  app.post("/api/money/payment-links", write("/money/payment-links", async ({ db, tenantId, req }) => {
    const body = await req.json().catch(() => ({}));
    return paymentLinksCreate(db, {
      tenantId, title: body.title, variant: body.variant,
      amountMinor: body.amountMinor, minAmountMinor: body.minAmountMinor,
    });
  }));

  app.post("/api/money/payment-links/deactivate", write("/money/payment-links", async ({ db, tenantId, req }) => {
    const body = await req.json().catch(() => ({}));
    return paymentLinksDeactivate(db, { tenantId, paymentLinkId: body.paymentLinkId });
  }));

  app.post("/api/money/account", write("/money/account", async ({ db, tenantId, req }) => {
    const body = await req.json().catch(() => ({}));
    return accountManagementUpdate(db, {
      tenantId,
      supportEmail: body.supportEmail,
      supportPhone: body.supportPhone,
      supportUrl: body.supportUrl,
      statementDescriptor: body.statementDescriptor,
    });
  }));

  // ★ Task 20.64 routes moved to WRITE_ROUTES (src/routes/writes.mjs) for consistency.
  //   Both apply and remove now go through registerWriteRoutes, not registered here.
}
