---
title: Get paid inside the signature, powered by Stripe
description: Add a payment field and the signer pays by card as the last step of signing. Payments are powered by Stripe and go straight to your own Stripe account. Docustay never holds the money.
---

# Get paid inside the signature.

Add a payment field to a document. The signer signs, then pays by card on the same page. Payments are powered by Stripe, and the money goes straight to your own Stripe account. Docustay never holds it.

## From the signer to your Stripe account.

1. **Signer**: Signs, then pays by card
2. **Docustay**: Works out the amount on the server
3. **Your Stripe account**: Takes the money

## Start from nothing, or bring your Stripe account.

Only Admins and Owners set up payments. It is under Billing, Payments.

- **Stripe account**: You do not need one. Stripe makes it for you at the end.
- **The form**: Company or individual, your name, what you will collect for, and your country. The form shows United States.
- **Then**: Stripe's own secure page asks for the rest.
- **You need**: A photo ID, a bank account, and an EIN or the last 4 of an SSN.
- **How long**: Setup takes about 5 minutes. You can stop and come back.
- **Privacy**: Docustay never sees your ID or your bank details.

- **Choose**: I already have a Stripe account. Connect it instead.
- **What happens**: You sign in at Stripe and allow Docustay to take payments for you.
- **Your money**: Stays in the account you already use.
- **Your dashboard**: The same Stripe dashboard you know.

## Six states, and what each one means.

| State | What it means | What you do |
| --- | --- | --- |
| Ready | Stripe is connected and can take payments. | Nothing. |
| Verifying | Stripe is checking your details. It usually takes a few minutes and sometimes up to a day. | Wait. Stripe emails you when it is done. |
| Needs attention | Stripe needs a little more from you. It shows a deadline when it has one. | Choose Continue on Stripe. |
| Restricted | Stripe has restricted the account until it has what it asked for. | Choose Continue on Stripe. |
| Paused by you | You turned Take payments off. Payment boxes say payments are paused and people can still sign. Nothing is refunded. | Turn it back on whenever you like. |
| Disconnected | Docustay no longer has access to a Stripe account. Payment boxes cannot be paid until you connect again. | Reconnect. Your Stripe account stays yours. |

## Pause it, disconnect it, open your dashboard.

**Pause payments.** Payment boxes say payments are paused, and people can still sign. Nothing is refunded. Turn it back on when you want.

**Disconnect.** The Stripe account stays yours. Payment boxes cannot be paid until you connect again, and your history stays visible.

**Open your Stripe dashboard.** One link from Billing, Payments takes you to your own Stripe dashboard, where payouts and the bank details live.

## One amount, one currency, one card payment.

| You set | Options |
| --- | --- |
| Amount | One fixed amount, from 0.50 to 999,999.99. A deposit is just a smaller amount. |
| Currency | USD, EUR, GBP, CAD, AUD, NZD, CHF, SEK, NOK or DKK. |
| Who pays | One of the people on the document. |
| What it is for | A line of text the signer sees next to the amount. |
| A Stripe Price or Payment Link | Instead of typing an amount, point the field at a one-time Price or a Payment Link on your own Stripe account. |
| Instalments | Write them in the document as a note. They are a note, not a charge: the field takes one payment. |

## They sign, then pay on the same page.

The link opens on any device, with no account. The signer signs, then pays by card as the last step. The amount is worked out on the server and never taken from the browser.

**Held for 7 days.** Their signature is held for 7 days while they pay. If the payment does not arrive in time, the signature is not kept, and you and the signer are told.

**The receipt.** The receipt comes with the signed copy. If your Stripe account already emails receipts, signers may get two.

## Every payment in one place.

Billing, Payments shows your balance and payouts, who paid for which document, Stripe's fees, and this month's money in, fees and refunds.

- Refund in full or in part, with a reason the payer sees.
- A dispute opens in Stripe, where you answer it.
- Owners get an email when Stripe asks for more information, when a payout fails and when a payment is disputed.
- Switch on Payments in your notification settings to hear when a payment arrives or one does not go through, in the app and by email.

- **Free and Pay as you go**: 2% fee on top of Stripe's
- **Pro and Lifetime**: 0% fee on top of Stripe's
- **Stripe's own fees**: Go to Stripe, from your Stripe account

## Say what you are collecting. Review what Scribe drafts.

Once Stripe is connected, Scribe's wizard asks for the amount, the currency, who pays and what it is for. The terms are written around your values, and you review everything before it is sent.

- Scribe never decides an amount. The one you typed is the one that is charged.

## The demo has no Stripe. Test mode does.

**The demo.** The demo has no Stripe account, so it cannot take a payment. You can still see a payment box in a document.

**With a test card.** Where a server is in Stripe's test mode, Docustay says so, and a Stripe test card pays without moving real money.

**For developers.** The technical side: the API, webhooks, the command line and test mode.

## Questions

**Does Docustay hold my money?**

No. The payment goes to your own Stripe account, and Stripe pays your bank on the schedule you see in Billing, Payments.

**What does it cost?**

Stripe's own fees go to Stripe. Docustay adds 2% on Free and Pay as you go and 0% on Pro and Lifetime.

**Which countries can set up payments?**

The guided setup makes a United States Stripe account, and its form shows United States. If you already have a Stripe account, you can connect it instead. A payment can be in USD, EUR, GBP, CAD, AUD, NZD, CHF, SEK, NOK or DKK.

**What if Stripe needs more information?**

The state changes to Needs attention, and Owners get an email. Choose Continue on Stripe and give it what it asks for.

**Can I take a deposit?**

Yes. A deposit is a payment field with a smaller amount. A payment field takes one amount, so a balance later is a second document or an invoice from your own Stripe.

**Can I refund a payment?**

Yes, in full or in part, from Billing, Payments or the API. Give a reason; the payer sees it.

**What about disputes?**

A dispute opens in Stripe, in your own account, and you answer it there. Owners get an email when one is opened.

**Who can set it up?**

Admins and Owners. Members can see who runs payments.


## Keep reading

- [Payments for developers](/developers/payments)
- [Payments when you self-host](/self-host/payments)
- [Scribe](/features/scribe)
- [Pricing](/pricing)
