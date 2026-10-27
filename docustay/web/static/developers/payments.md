---
title: Payments API, webhooks and CLI
description: Check Stripe status, list payments and refund them over the API. Payment webhooks, the docustay payments command, an MCP tool and how test mode treats a payment field.
---

# Payments, from code.

Read the state of Stripe, list the payments taken through documents and refund them. Three events tell you when a payment arrives, fails or runs out of time.

## GET /api/v1/payments/status

Answers whether payments can be taken now. A document with a payment field can only be sent when it is connected.

```
curl https://app.docustay.app/api/v1/payments/status \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/payments

Payments taken through documents, newest first: who paid, for which document, the amount and the status (paid, waiting, started, refunded, partially_refunded or disputed), and this month's figures. Page with before and limit.

```
curl "https://app.docustay.app/api/v1/payments?limit=20" \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## A payment, as GET /api/v1/documents/{id} shows it.

Each payment on a document carries its status, the amount in the smallest unit of its currency, the Stripe receipt, what was refunded and the Docustay fee.

```
{ "id": "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e",
  "fieldId": null,
  "person": "Rosa Alvarez",
  "status": "partially_refunded",
  "amountMinor": 15000,
  "currency": "usd",
  "paidAt": "2026-10-26T17:04:11Z",
  "receiptUrl": "https://pay.stripe.com/receipts/…",
  "refundedMinor": 500,
  "fee": { "basisPoints": 200, "amountMinor": 300, "refundedMinor": 10, "plan": "docustay_free" },
  "test": false }
```

## What a key needs.

| Operation | Scope |
| --- | --- |
| GET /api/v1/payments/status | account:read |
| GET /api/v1/payments | documents:read |
| POST /api/v1/payments/{id}/refund | documents:write |

## POST /api/v1/payments/{id}/refund

Refund in full or in part. The reason is required, and the payer sees it. Leave out amountMinor to refund the rest. Needs an Idempotency-Key.

```
curl -X POST "https://app.docustay.app/api/v1/payments/$DOCUSTAY_PAYMENT_ID/refund" \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "amountMinor": 500, "reason": "Charged twice" }'
```

## Three payment events.

| Event | Means |
| --- | --- |
| documents.payment.received | A payment arrived. |
| documents.payment.failed | A payment attempt failed. |
| documents.payment.hold_lapsed | A payment hold ran out before the signer paid. |

## docustay payments

**list.** Lists the payments taken while signing.

**refund.** Refunds one payment. It moves money, so it asks you to confirm, or you add --yes.

## An MCP tool, and test mode.

**MCP.** The get_payments_status tool reports whether Stripe is ready. It needs the account:read scope.

**Test mode.** A seat with a payment field cannot be test-signed. Pay it with a Stripe test card.

**Fees.** Each payment carries the Docustay fee decided when it started: 200 basis points on Free, 0 on Pro. Stripe's fees are separate.

## Questions

**Can the API set up Stripe?**

No. Setup is in the app, under Billing, Payments, by an Admin or Owner. The API reads the state.

**Does a payment field work from the send call?**

Yes, when the template has one and Stripe is connected. The amount is worked out on the server.


## Keep reading

- [Payments for businesses](/features/payments)
- [Payments when you self-host](/self-host/payments)
- [Webhooks](/developers/webhooks)
- [Test mode](/developers/test-mode)
