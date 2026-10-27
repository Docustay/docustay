---
title: Search and payments
description: Search the workspace, list the payments taken while signing, and refund them in full or in part.
order: 23
---

# Search and payments

These calls do what the app's own screens do: the search box and the Payments tab of Billing. Each one calls the same code as the screen, so the API and the app always give the same answer.

| You want to | Call | Scope |
|---|---|---|
| Find documents, templates and people | `GET /api/v1/search?q=…` | `documents:read` |
| List payments taken while signing | `GET /api/v1/payments` | `documents:read` |
| Refund a payment, in full or in part | `POST /api/v1/payments/{id}/refund` | `documents:write` |

A key without the scope gets `401`, the same answer as a wrong key. Another workspace's document or payment is `404`: a key never learns that it exists.

## Search

`q` is the words to look for. `per` is how many of each kind come back (1 to 20, default 6). The answer is grouped into `documents`, `templates` and `people`, best match first.

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const r = await docustay.search("Deposit", { per: 5 });
for (const d of r.groups.documents) console.log(d.id, d.state, d.title);
```

## Payments

A payment box on a document takes a fixed amount while the person signs. `GET /api/v1/payments` lists them newest first, with this month's figures in `month`. Each payment has its `status`:

| Status | Means |
|---|---|
| `paid` | Stripe took the money |
| `waiting` | signed, and the signature is kept while they pay (for up to 7 days) |
| `started` | they opened the payment and did not finish it |
| `refunded` / `partially_refunded` | some or all of it was given back |
| `disputed` | the payer's bank opened a dispute; answer it in Stripe |

In `month`, `stripeFee` is Stripe's own fees on this month's payments, and `stripeFeePending` counts the payments Stripe has not settled yet (that can take a few minutes). Page through with `before`, using `next` from the previous page.

### Refunds

A refund goes through Stripe on your workspace's own Stripe account. Leave out `amountMinor` to refund the rest of the payment, or give it in the smallest unit of the currency (`500` is 5.00). `reason` is required: the payer sees it on their receipt, and it goes in the document's audit trail. The signed document stays signed.

A refund moves money, so it needs an `Idempotency-Key`. Send the same key again and you get the first answer back, with no second refund. The SDKs add a key for you and reuse it when they retry.

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const paymentId = process.env.DOCUSTAY_PAYMENT_ID;   // from documents.payment.received or GET /api/v1/payments
const r = await docustay.refundPayment(paymentId, { amountMinor: 500, reason: "Charged twice" });
console.log(r.status, r.refundedLabel);   // "partially_refunded", "$5.00"
```

```python
import os
from docustay import Docustay
docustay = Docustay(os.environ["DOCUSTAY_API_KEY"])
payment_id = os.environ["DOCUSTAY_PAYMENT_ID"]
docustay.refund_payment(payment_id, reason="Charged twice")   # the rest of the payment
```

From the command line, `docustay payments refund <id> --reason "…" --yes` does the same. It never runs without `--yes`, or a typed yes at the prompt.

## From an AI assistant

The MCP server has `search_documents` and `list_payments`. It has no tool to refund a payment: that moves money, so a person does it in the app, from the command line or from their own code.

Plays and playbooks (your own sets of templates and skills) are covered in [the template library](/docs/template-library).
