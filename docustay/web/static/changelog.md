---
title: Changelog
description: What changed in Docustay, newest first.
---

# Changelog

## Version 0.2.2: Pro at $35, packages and the public repository (October 2026)

- Pro is $35 a month for the whole workspace: unlimited team members, signers, documents and templates.
- Every package is at 0.2.2: the SDK, embed, React, Vue, Angular, MCP server and CLI on npm, Python on PyPI, PHP on Packagist, C# on NuGet and Go. The SDKs, the signing element, the MCP server and the CLI are MIT; the server and app are AGPL-3.0.
- The public repository starts fresh at v0.2.2, with images built by its release workflow and scanned for known vulnerabilities before they are published.
- Known issues: the demo workspace opens with one sample document instead of three and no sample forms; the Choose stop reminders control in the signer's view is not covered by a test yet; a self-host builder or Scribe embed answers 409 until the workspace lists its website under Settings, Developers, Embedding; under very heavy load, reminder and schedule sweeps wait behind email and webhook deliveries.

## Pricing in plain words (October 2026)

- Two words now cover everyone: a team member has a Docustay login and is the only person who ever costs money (Pay as you go, $5 each a month); a signer is anyone you send to, and signers are free.
- Free includes 15 different signers a month and Pay as you go 25 new templates a month, from 1 November 2026. Sending again to someone you already sent to never counts, and a workspace already past either number keeps everything it has.
- People in the app is now Contacts, and a signing group shares one signing spot. No price changed.

## Version 1: simpler, and pay for what you use (October 2026)

- New plans: Free, Pay as you go ($5 per team member a month, then $0.50 a document after 15 and $0.30 an AI draft after 10), Pro and a one-time Lifetime offer. Set a budget (default $50), get alerts at 50, 80 and 100%, and sending pauses at the budget. Documents are never deleted.
- Scribe now uses one model and shows the price of a draft before it runs. A failed or empty draft is never charged.
- Signing documents is the whole product again. Removed: forms with public links, automations, contract key dates, reports, the kiosk and QR sign-in, your own signing domain and mailbox, editable email wording, the translated signing pages, conditional fields and formulas, and recurring payments. Your documents and signed copies are untouched.
- Payments inside signing take one fixed amount. Connect an existing Stripe account with a sign-in, or create one.
- The API is twelve scopes and 61 operations; webhooks gain documents.usage.threshold. Templates and former form templates are now one library of ready-made templates.

## Self-hosting: rebuild your images (October 2026)

- Images built from this repository before this version contained the install's .env file (its master key, sign-in secret and database password). Upgrade as usual (git pull, docker compose build, docker compose up -d), then delete the old images with docker image prune. If you ever pushed or copied an image you built, treat the secrets in that .env as known to whoever has the image.
- An install that sends through its own mail server or a connected mailbox now gets its notices (someone signed, everyone has signed), which were skipped before.
- A fresh install says plainly that email is not set up on the Email settings and the Check step, before you press Send.

## Payments inside a document (October 2026)

- Add a payment field and the signer pays through Stripe's hosted page, to the Stripe account you connect. The amount can be fixed, typed by the signer, a formula, a Stripe price or a payment link.
- Docustay charges 2% on the Free plan and nothing on Pro, on top of Stripe's own fees.

## A new look and a board for your documents (October 2026)

- Paper-and-ink design with a dark mode.
- Documents as a board of three lanes, with the list still one click away.
- Settings grouped by purpose; a developer console with API keys, webhooks with a delivery log and replay, and an embedding snippet builder.
- A signing page built for the phone first.

## Developers (October 2026)

- A complete OpenAPI 3.1 file and a Postman collection.
- Embedded signing, text tags, HTML to template, test keys and test mode.
- A Model Context Protocol server and agent skills.

## Security (October 2026)

- Security headers on every response, two-step sign-in for workspaces that require it, a list of active sessions, and a daily backup of the database to a separate location.
