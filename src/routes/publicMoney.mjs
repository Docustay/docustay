// Stage 15 Task 15.34 — PUBLIC MONEY ROUTES: logged-out pages for invoices, estimates, cards, payments
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ REGISTERED OUTSIDE THE TENANT MACHINERY. Same reasoning as src/routes/public.mjs (booking)
//     and registerSignupRoutes / registerWebhookRoutes: there is no session and no tenant yet
//     when a request arrives. These routes must resolve the tenant first (via token or Host header),
//     THEN open a tenant transaction.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { asViewer } from "../db/viewer.mjs";
import { peekLinkToken, redeemLinkToken } from "../auth/linkToken.mjs";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { resolvePublicTenantId } from "../booking/publicBooking.mjs";
import { notFound, invalid, forbidden } from "../http/errors.mjs";

import { recordInvoiceView, publicInvoiceView } from "../money/invoicePublic.mjs";
import { buildInvoiceView } from "../money/invoiceView.mjs";
import { renderInvoicePdfBuffer } from "../money/invoicePdfServer.mjs";
import { recordEstimateView, publicEstimateView, acceptEstimate, declineEstimate } from "../money/estimates.mjs";
import { startCardUpdateSession } from "../money/cardUpdate.mjs";
import { publicPaymentLinkView, createLinkIntent } from "../money/paymentLinks.mjs";
import { createClientPayment, ADOLESCENT_PAYMENT_REFUSAL } from "../money/clientPayments.mjs";
import { stripeConnectedRequest } from "../money/stripeConnected.mjs";
import { metadataFor } from "../money/metadata.mjs";
import { getSetting } from "../settings/writes.mjs";

/** ★ Generic 404 for every refusal (copied from src/routes/public.mjs's pattern). */
function notFoundResponse() {
  return notFound("This page isn't available.");
}

/**
 * Register all public money routes.
 * Routes are all registered outside tenant machinery since they resolve the tenant themselves.
 */
export function registerPublicMoneyRoutes(app) {
  // GET /api/public/money/invoice?t=<token>
  // Invoice view (peek, record view, return invoice data)
  app.get("/api/public/money/invoice", async (c) => {
    const token = c.req.query("t");

    // Peek the token to discover tenant
    let peek;
    try {
      peek = await peekLinkToken(token, ["invoice_view"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    const { tenantId, subjectId: invoiceId } = peek;

    return await withTenant(tenantId, async (tx) => {
      // Find the invoice to get payer_user_id for viewer context
      const { rows: invoiceRows } = await tx.query(
        `SELECT payer_user_id FROM keystone.invoice WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceId]
      );

      if (invoiceRows.length === 0) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      const payerUserId = invoiceRows[0].payer_user_id;

      // Record view and return invoice data as the payer
      await asViewer(tx, payerUserId, async () => {
        await recordInvoiceView(tx, { tenantId, invoiceId });
      });

      const invoice = await asViewer(tx, payerUserId, async () => {
        return await publicInvoiceView(tx, { tenantId, invoiceId });
      });

      if (!invoice) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      return c.json(invoice);
    });
  });

  // GET /api/public/money/invoice/pdf?t=<token>
  // ★ "Download PDF" for the invoice-issued/reminder emails and the public invoice page. Reuses
  //   the SAME `invoice_view` token purpose as the view route above (one token, two uses) rather
  //   than minting a second one. Built from the platform's OWN invoice+lines (specs/INVOICE-SEND-FIX.md
  //   §2.7) — the same builder the email attachment and the editor's preview use — never a live
  //   Stripe fetch. An invoice's lines never change again once sent, so this always matches what
  //   was actually emailed; only invoiced work (never a live draft) is ever public here, since the
  //   token itself is minted at Send.
  app.get("/api/public/money/invoice/pdf", async (c) => {
    const token = c.req.query("t");
    let peek;
    try {
      peek = await peekLinkToken(token, ["invoice_view"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }
    const { tenantId, subjectId: invoiceId } = peek;

    return await withTenant(tenantId, async (tx) => {
      const { rows: invoiceRows } = await tx.query(
        `SELECT payer_user_id FROM keystone.invoice WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceId]);
      if (invoiceRows.length === 0) return c.json(notFoundResponse(), { status: 404 });
      const payerUserId = invoiceRows[0].payer_user_id;

      const { view, pageSize, invoiceNumber } = await asViewer(tx, payerUserId, async () => {
        const { rows } = await tx.query(
          `SELECT ie.status, i.currency, i.invoice_number, i.due_at, i.issued_at, i.custom_fields, i.rendering,
                  i.memo, ie.hosted_invoice_url, ie.paid_minor, ie.amount_remaining_minor
             FROM keystone.invoice i
             JOIN keystone.invoice_effective ie ON ie.id = i.id
            WHERE i.tenant_id = $1 AND i.id = $2`,
          [tenantId, invoiceId]);
        if (rows.length === 0) return {};
        const { rows: lineRows } = await tx.query(
          `SELECT name_snapshot, unit_amount_minor, quantity, discount_minor, tax_minor
             FROM keystone.line_item
            WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'active'
            ORDER BY position ASC NULLS LAST, created_at ASC`,
          [tenantId, invoiceId]);
        const { rows: payerRows } = await tx.query(
          `SELECT display_name, email FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
          [tenantId, payerUserId]);
        const practiceName = (await getSetting(tx, "practice.name", null)) || "Workbench";
        const phone = await getSetting(tx, "practice.support_phone", null);
        return {
          invoiceNumber: rows[0].invoice_number,
          pageSize: rows[0].rendering?.page_size ?? "a4",
          // ★ `branding.logo_url` deliberately omitted — `ks-object:` pointer, not a fetchable URL.
          view: buildInvoiceView({
            invoice: rows[0], lines: lineRows, payer: payerRows[0] ?? null,
            practiceBranding: { name: practiceName, logoUrl: null, phone },
          }),
        };
      });
      if (!view) return c.json(notFoundResponse(), { status: 404 });

      const buf = await renderInvoicePdfBuffer(view, { pageSize: pageSize || "a4" });

      return c.body(buf, 200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="Invoice-${invoiceNumber}.pdf"`,
      });
    });
  });

  // GET /api/public/money/estimate?t=<token>
  // Estimate view (peek, record view, return estimate data)
  app.get("/api/public/money/estimate", async (c) => {
    const token = c.req.query("t");

    let peek;
    try {
      peek = await peekLinkToken(token, ["estimate_accept"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    const { tenantId, subjectId: estimateId } = peek;

    return await withTenant(tenantId, async (tx) => {
      // Find the estimate to get recipient_user_id for viewer context
      const { rows: estimateRows } = await tx.query(
        `SELECT recipient_user_id FROM keystone.estimate WHERE tenant_id = $1 AND id = $2`,
        [tenantId, estimateId]
      );

      if (estimateRows.length === 0) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      const recipientUserId = estimateRows[0].recipient_user_id;

      // Record view and return estimate data as the recipient
      await asViewer(tx, recipientUserId, async () => {
        await recordEstimateView(tx, { tenantId, estimateId });
      });

      const estimate = await asViewer(tx, recipientUserId, async () => {
        return await publicEstimateView(tx, { tenantId, estimateId });
      });

      if (!estimate) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      return c.json(estimate);
    });
  });

  // POST /api/public/money/estimate/accept
  // Accept an estimate (single-use token, redeem, call acceptEstimate)
  app.post("/api/public/money/estimate/accept", async (c) => {
    const body = await c.req.json();
    const token = body.t;

    let redeem;
    try {
      redeem = await redeemLinkToken(token, ["estimate_accept"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    const { tenantId, subjectId: estimateId } = redeem;

    return await withTenant(tenantId, async (tx) => {
      // Verify estimate exists and get recipient for viewer
      const { rows: estimateRows } = await tx.query(
        `SELECT recipient_user_id FROM keystone.estimate WHERE tenant_id = $1 AND id = $2`,
        [tenantId, estimateId]
      );

      if (estimateRows.length === 0) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      const recipientUserId = estimateRows[0].recipient_user_id;

      // Accept as the recipient
      await asViewer(tx, recipientUserId, async () => {
        await acceptEstimate(tx, { tenantId, estimateId });
      });

      return c.json({ accepted: true });
    });
  });

  // POST /api/public/money/estimate/decline
  // Decline an estimate (single-use token, redeem, call declineEstimate)
  app.post("/api/public/money/estimate/decline", async (c) => {
    const body = await c.req.json();
    const token = body.t;
    const reason = body.reason || null;

    let redeem;
    try {
      redeem = await redeemLinkToken(token, ["estimate_accept"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    const { tenantId, subjectId: estimateId } = redeem;

    return await withTenant(tenantId, async (tx) => {
      // Verify estimate exists and get recipient for viewer
      const { rows: estimateRows } = await tx.query(
        `SELECT recipient_user_id FROM keystone.estimate WHERE tenant_id = $1 AND id = $2`,
        [tenantId, estimateId]
      );

      if (estimateRows.length === 0) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      const recipientUserId = estimateRows[0].recipient_user_id;

      // Decline as the recipient
      await asViewer(tx, recipientUserId, async () => {
        await declineEstimate(tx, { tenantId, estimateId, reason, actorUserId: recipientUserId });
      });

      return c.json({ declined: true });
    });
  });

  // GET /api/public/money/card-update?t=<token>
  // Card update flow (redeem token, start session, redirect to Stripe)
  app.get("/api/public/money/card-update", async (c) => {
    const token = c.req.query("t");

    let redeem;
    try {
      redeem = await redeemLinkToken(token, ["card_update"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    const { tenantId, subjectId: appUserId } = redeem;

    return await withTenant(tenantId, async (tx) => {
      // Start card update session and redirect
      const session = await startCardUpdateSession(tx, {
        tenantId,
        appUserId,
        returnUrl: c.req.header("origin") || "https://example.com",
      });

      return c.redirect(session.url, 302);
    });
  });

  // GET /api/public/money/links/:slug
  // Payment link view (resolve tenant from Host, fetch link data)
  app.get("/api/public/money/links/:slug", async (c) => {
    const slug = c.req.param("slug");

    // Resolve tenant from Host header
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    return await withTenant(tenantId, async (tx) => {
      const link = await publicPaymentLinkView(tx, { tenantId, slug });

      if (!link) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      return c.json(link);
    });
  });

  // POST /api/public/money/links/:slug/intent
  // Create payment intent for a payment link
  app.post("/api/public/money/links/:slug/intent", async (c) => {
    const slug = c.req.param("slug");
    const body = await c.req.json();
    const amountMinor = body.amountMinor;

    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return c.json(invalid("amountMinor must be a positive integer"), { status: 400 });
    }

    // Resolve tenant from Host header
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    return await withTenant(tenantId, async (tx) => {
      const intent = await createLinkIntent(tx, { tenantId, slug, amountMinor });

      if (!intent) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      return c.json(intent);
    });
  });

  // POST /api/public/money/invoice/pay
  // Pay an invoice (peek token, check teen refusal FIRST, call createClientPayment)
  app.post("/api/public/money/invoice/pay", async (c) => {
    const body = await c.req.json();
    const token = body.t;

    // Peek to discover tenant and invoice
    let peek;
    try {
      peek = await peekLinkToken(token, ["invoice_view"]);
    } catch (err) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    const { tenantId, subjectId: invoiceId } = peek;

    return await withTenant(tenantId, async (tx) => {
      // Find the invoice to get payer_user_id
      const { rows: invoiceRows } = await tx.query(
        `SELECT payer_user_id FROM keystone.invoice WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceId]
      );

      if (invoiceRows.length === 0) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      const payerUserId = invoiceRows[0].payer_user_id;

      // ★★★ TEEN REFUSAL FIRST — before any invoice read (refusal order in spec)
      const { rows: payerRows } = await tx.query(
        `SELECT role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`,
        [payerUserId, tenantId]
      );

      if (payerRows.length === 0) {
        return c.json(notFoundResponse(), { status: 404 });
      }

      if (payerRows[0].role === "adolescent_client") {
        return c.json({ error: ADOLESCENT_PAYMENT_REFUSAL }, { status: 403 });
      }

      // Create the payment allocation
      const payment = await createClientPayment(tx, {
        tenantId,
        payerUserId,
        invoiceIds: [invoiceId],
        idempotencyKey: `pay:${tenantId}:${invoiceId}`,
      });

      return c.json({
        clientSecret: payment.clientSecret,
        paymentIntentId: payment.paymentIntentId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      });
    });
  });

  // POST /api/public/money/gift-cards/buy
  // Gift card purchase (resolve tenant from Host, validate settings, create Stripe intent)
  app.post("/api/public/money/gift-cards/buy", async (c) => {
    const body = await c.req.json();
    const amountMinor = body.amountMinor;
    const holderEmail = body.holderEmail;

    // Resolve tenant from Host header
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) {
      return c.json(notFoundResponse(), { status: 404 });
    }

    // Validate amount is in range 500-100000 ($5-$1000)
    if (!Number.isInteger(amountMinor) || amountMinor < 500 || amountMinor > 100000) {
      return c.json(
        invalid("amountMinor must be between 500 and 100000 (USD $5-$1000)"),
        { status: 400 }
      );
    }

    return await withTenant(tenantId, async (tx) => {
      // Check if gift cards are enabled
      const giftCardsEnabled = await getSetting(tx, "giftcards.enabled", false);
      if (!giftCardsEnabled) {
        return c.json(
          { error: "Gift cards are not available for this practice." },
          { status: 403 }
        );
      }

      // Get tenant currency (default USD)
      // ★ tenant has no `settings` column (this 500'd): the currency is the `money.currency` setting
      const currency = (await getSetting(tx, "money.currency", "USD")) ?? "USD";

      // Create Stripe payment intent with metadata
      const result = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: "/payment_intents",
        sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
        movesMoney: true,
        purpose: "gift_card_sale",
        form: {
          amount: amountMinor,
          currency: currency.toLowerCase(),
          ...Object.fromEntries(
            Object.entries(metadataFor("payment_intent", {
              keystone_gift_card_sale: "1",
              keystone_gift_card_amount: amountMinor,
              keystone_tenant_id: tenantId,
            })).map(([k, v]) => [`metadata[${k}]`, v])
          ),
        },
      });

      return c.json({
        clientSecret: result.body.client_secret,
      });
    });
  });
}
