---
title: Take payments on a self-hosted server
description: Use your own Stripe keys, the charges switch, staging and what is and is not available compared with the hosted service.
---

# Payments on your own server.

Put your own Stripe keys in the settings file and payment fields work. The money goes to your Stripe account, and no Docustay fee applies to it.

## Four settings for payments.

| Setting | What it does |
| --- | --- |
| KEYSTONE_STRIPE_SECRET_KEY | Your own Stripe secret key. Needed for payment fields. |
| KEYSTONE_STRIPE_PUBLISHABLE_KEY | The matching publishable key. With it the signer pays inside the signing page; without it, on Stripe's own page, and comes back. |
| KEYSTONE_STRIPE_CHARGES_ENABLED | Off by default. Live charges are refused until it is on. |
| KEYSTONE_ENVIRONMENT | Set to staging and the server refuses live Stripe keys. |

## What is and is not the same.

**No Docustay fee.** A self-hosted install has no Docustay plan, so no Docustay fee is added to a payment. Stripe's own fees still apply.

**No guided setup.** The hosted Set up payments and Stripe connect pages are not available. The app says Connecting is not switched on for this server yet. You use your own keys.

**Every payment is checked.** A payment counts only when Stripe says it is paid. Docustay reads it back from Stripe before it records it.

## Questions

**Does Docustay trust the browser about a payment?**

No. When the payer comes back to the signing page, Docustay asks Stripe whether the payment was made and records it only if Stripe says it was paid.

**How do I try it without real money?**

Use Stripe test keys. The app then says the server is in Stripe's test mode, and a Stripe test card pays without moving real money.

**Can I use live keys on a staging server?**

No. With KEYSTONE_ENVIRONMENT set to staging, live Stripe keys are refused.


## Keep reading

- [Payments for businesses](/features/payments)
- [Payments for developers](/developers/payments)
- [Install and run](/self-host)
