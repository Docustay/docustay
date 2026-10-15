---
title: Changelog
description: What changed in Docustay, newest first.
---

# Changelog

## Self-hosting: rebuild your images (October 2026)

- Images built from this repository before this version contained the install's .env file (its master key, sign-in secret and database password). Upgrade as usual (git pull, docker compose build, docker compose up -d), then delete the old images with docker image prune. If you ever pushed or copied an image you built, treat the secrets in that .env as known to whoever has the image.
- An install that sends through its own mail server or a connected mailbox now gets its notices (someone signed, everyone has signed), which were skipped before.
- A fresh install says plainly that email is not set up on the Email settings and the Check step, before you press Send.

## Fourteen languages (October 2026)

- The signing page, the emails and the Certificate of Completion can be in fourteen languages, with Arabic read right to left. Every language except English is a machine-written draft marked Beta.

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
