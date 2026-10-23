---
title: Payments inside e-signature, into your Stripe | Docustay
description: Payments inside e-signature: the signer pays as part of signing, straight into your own Stripe account. Docustay never holds the money.
---

# Get paid inside the signature.

Add a payment field for payments inside e-signature. The signer signs, then pays on the same page, and the money goes to your own Stripe account. Docustay never holds it.

## From the signer to your Stripe account.

1. **Signer**: Signs, then pays
2. **Docustay**: Checks the amount
3. **Your Stripe**: Takes the money

## Connect Stripe, finish onboarding, add a field.

**Connect Stripe.** Connect your own Stripe account from Settings, Payments.

**Finish Stripe's onboarding.** Stripe asks for what it needs to pay you out. That part is between you and Stripe.

**Add a payment field.** Drop a payment field on any document or template and set the amount.

## How it works.

**You set the amount.** Set one amount in the payment field. A deposit is just a smaller amount.

**They pay last.** Paying is the last step of signing. Their signature is kept for 7 days while they pay, and the receipt comes with the signed copy. The amount is worked out on the server, never trusted from the browser.

**It is your account.** Money goes to your own Stripe account, so you can take it with you.

## One payment, paid while signing.

The payment field charges one set amount, paid in full as the last step of signing. Use it for a deposit, a fee or the whole price.

- A deposit agreement carries its own payment field.
- Stripe's own fees go to Stripe.

## Every payment in one place.

The Payments tab in Billing lists who paid, for which document, and what Stripe kept in fees. Refund in full or in part with a reason the payer sees on their receipt. Disputes open in Stripe.

- This month's money in, fees and refunds at the top.
- The same list and refunds are in the API.

- **Free and Pay as you go**: 2% fee on top of Stripe's
- **Pro and Lifetime**: 0% fee on top of Stripe's
- **Account**: Your own Stripe account

## The payment is a field, like a signature.

**You add a payment field.** One set amount, the same for everyone who signs.

**They pay on Stripe's own page.** The amount is worked out on the server, never trusted from the browser.

**Then they can sign.** The signature opens once Stripe says it is paid, and the money goes to your own Stripe account.

## A payment is one tag.

Write the payment where it belongs. A payment is one fixed amount.

```
Retainer: {{Retainer;type=payment;role=Client;amount=1500.00;currency=usd}}
```

## Who takes what.

|  | Free and Pay as you go | Pro and Lifetime |
| --- | --- | --- |
| Stripe's own fees | To Stripe | To Stripe |
| Docustay's fee on top | 2% | 0% |
| Where the money lands | Your Stripe account | Your Stripe account |

Stripe's fees are Stripe's. Docustay never holds the money.

## Every payment has one status.

| Status | Means |
| --- | --- |
| paid | Stripe took the money. |
| waiting | The person has signed and the signature is kept, for up to 7 days, while they pay. |
| started | They opened the payment and did not finish it. |
| refunded or partially_refunded | Some or all of it was given back. |
| disputed | The payer's bank opened a dispute. You answer it in Stripe. |

This month's figures sit above the list: money in, Stripe's own fees and refunds. Stripe's fee can show as pending for a few minutes while Stripe settles it.

## The amount is set on the server.

- **Fixed**: amount=150.00 with a currency. From 0.50 to 999,999.99.
- **Never the browser**: The server reads the amount from the document you sent. The browser never sends an amount.
- **Card details**: Typed on Stripe's page. Docustay never receives or stores them.

## Give money back from your own code.

A refund goes through Stripe on your own account. Leave out the amount to refund the rest. A reason is required: the payer sees it on their receipt and it goes in the document's audit trail.

```
const r = await docustay.refundPayment(paymentId, { amountMinor: 500, reason: "Charged twice" });
```

- **Stripe connected**: Settings, Payments: set up payments, and Stripe's own sign-up page creates an account in your name, or choose I already have Stripe and sign in to the account you use. The status reads connected, needs_attention or not_connected.
- **Only when connected**: A document with a payment field can only be sent when the status is connected; otherwise Send answers with a plain reason.
- **The fee**: Docustay's fee is 2% on Free and Pay as you go and 0% on Pro and Lifetime, on top of Stripe's fees, decided when the payment starts. A refund returns the fee with it.
- **Test mode**: Does not test payments against real cards.

## The payment is part of the proof.

The certificate lists what each signer paid, by Stripe's own reference, and only money that actually arrived.

The payments list on GET /api/v1/documents/{id} shows each payment's status, amount, Stripe receipt link, refunds and the Docustay fee.

## Keep going with the next piece.

- [Templates](/free-templates): The payment tag, and the other field types.
- [Signing](/features/how-it-works#sign): Paying is the last step of signing.
- [Proof](/features/proof): What the certificate shows about a payment.

## What happens to the payment after the signature.

Paying is the last step of signing, and it goes to your own Stripe account.

**One set amount.** A payment field holds one fixed amount, so one template can cover a deposit or a fee.

**Every payment in one list.** The Payments page lists each payment taken while signing, with who paid, for which document and its status, and the same facts are available from the API and the command line.

**Refunds go through Stripe.** A refund is made from Docustay and goes through Stripe: leave out an amount to refund what is left, or give one to refund part. The reason is required.

**What it costs.** Docustay's own fee on a payment taken in a document is 2% on Free and Pay as you go and 0% on Pro and Lifetime, on top of Stripe's fees. Docustay does not charge per API call on any plan.

**Where the money goes.** A payment is taken through your own Stripe account, so the money goes to you and your Stripe dashboard shows it as it would any other charge.

## Questions

**Does Docustay hold my money?**

No. The charge goes through your own Stripe account.

**What does it cost?**

Stripe's fees go to Stripe. Docustay adds 2% on Free and Pay as you go and 0% on Pro and Lifetime.

**Can Scribe set payment terms?**

Yes, once your Stripe account is connected. You review them before anything is sent.


## Keep reading

- [Deposit agreement](/templates/deposit-agreement)
- [Pricing](/pricing)
- [Scribe](/features/scribe)
