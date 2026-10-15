---
title: Collect payment with a signature
description: Add a payment field to a document and collect money when it is signed, through your own Stripe account. The fee is 2% on Free and nothing extra on Pro.
---

# Get paid inside the document.

Add a payment field. The signer signs, then pays on the same page, and the money goes to your own Stripe account.

## How it works.

**You set the amount.** Fix it, let the signer type it, work it out from other fields, or point at a Stripe price or payment link.

**They pay last.** Paying is the last step of signing. Their signature is kept for 7 days while they pay, and the receipt comes with the signed copy. The amount is worked out on the server, never trusted from the browser.

**It is your account.** Money goes to your own Stripe account, so you can take it with you.

## One payment, or a series.

Charge a deposit, a payment plan or a subscription from one signed document. Series and subscriptions are on Pro.

- A payment plan agreement carries its own payment fields.
- Stripe's own fees go to Stripe.

## Every payment in one place.

The Payments tab in Billing lists who paid, for which document, and what Stripe kept in fees. Refund in full or in part with a reason the payer sees on their receipt. Disputes open in Stripe.

- This month's money in, fees and refunds at the top.
- The same list and refunds are in the API.

- **Free**: 2% fee on top of Stripe's
- **Pro**: 0% fee on top of Stripe's
- **Account**: Your own Stripe account

## A payment is one tag.

Write the payment where it belongs. A payment takes exactly one way to set the amount.

```
Retainer: {{Retainer;type=payment;role=Client;amount=1500.00;currency=usd}}
```

## Questions

**Does Docustay hold my money?**

No. The charge goes through your own Stripe account.

**What does it cost?**

Stripe's fees go to Stripe. Docustay adds 2% on Free and 0% on Pro.

**Can Scribe set payment terms?**

Yes, once your Stripe account is connected. You review them before anything is sent.


## Keep reading

- [Payment plan agreement](/templates/payment-plan-agreement-template)
- [Pricing](/pricing)
- [Scribe](/product/scribe)
