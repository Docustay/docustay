---
title: Email setup
description: How Docustay email is sent on the hosted service, and, for a self-hosted install, how to make mail from your own domain arrive: SPF, DKIM and DMARC records, how to test, and the settings.
order: 8
---

# Email setup

## On the hosted service

Nothing to set up. Docustay sends your signing requests, reminders and completed copies from its own verified sending domain, with **your name** as the sender and your address as the reply-to, so a reply goes to you. Hosted workspaces cannot send from their own domain, mailbox or SMTP server. The rest of this page is for a **self-hosted** install, which sends from your own domain.

## On a self-hosted install

Signing requests only help if they arrive. Mail sent from your own domain is far more likely to reach the inbox when the domain publishes three DNS records: SPF, DKIM and DMARC. Docustay shows the exact values to use; this page explains what they are. Every record below uses `example.com`: replace it with your domain.

## The three records

**SPF** says which servers may send for your domain. It is a `TXT` record on the sending domain. For a provider, it looks like this:

```
example.com.  TXT  "v=spf1 include:<provider's include> ~all"
```

A domain may have only **one** SPF record. If you already have one, add the provider's `include:` to it instead of adding a second record.

**DKIM** signs each message. The provider gives you a selector and a public key. Add them as a `TXT` or `CNAME` record exactly as shown:

```
selector1._domainkey.example.com.  TXT  "v=DKIM1; k=rsa; p=<public key from your provider>"
```

**DMARC** tells receivers what to do when SPF and DKIM fail, and where to send reports. Start by only watching:

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
```

When the reports look clean, move to `p=quarantine`.

## Verify in Docustay

1. Open **Settings → Email**.
2. Add the domain.
3. Add the records it shows at your DNS host.
4. Press **Verify**.

The state shows **pending** until DNS answers. DNS can take minutes to hours.

## Test it

Send a test email to a mailbox you control. In the message's headers (often "Show original") look for `spf=pass`, `dkim=pass` and `dmarc=pass`.

## Self-hosting

The self-host environment file (`docustay/.env.example`) takes one of two options:

- `RESEND_API_KEY`: your own Resend API key.
- Your own SMTP server: leave `RESEND_API_KEY` empty and enter the server in **Settings → Email** after you sign in. Amazon SES works this way too: SES gives you SMTP credentials (in the SES console, “SMTP settings”); enter that server, port 587 and those credentials, and your sending goes through your SES account and never through ours.

`KEYSTONE_MAIL_SENDER` is the default From address used until you verify your own domain, and `KEYSTONE_PUBLIC_URL` is the address used for links in emails. If neither option is set, Docustay says email isn't set up and will not invite signers.

## Common mistakes

- **Two SPF records.** Merge them into one with all the `include:` entries.
- **A mistyped DKIM selector.** The record name must match the selector exactly.
- **A trailing dot.** Some DNS hosts add your domain for you; a name entered with a trailing dot, or with the domain repeated, ends up in the wrong place.
- **Cached answers.** A long TTL on an old record keeps the old answer until it expires; wait, then press Verify again.
