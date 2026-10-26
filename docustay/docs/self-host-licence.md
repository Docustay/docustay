---
title: Pro licence keys
description: How a self-hosted Docustay Pro licence works from purchase to renewal, where the key goes, and what happens when it ends.
order: 18
---

# Pro licence keys

Community is free under the AGPL-3.0 and needs no key. Pro is a yearly licence for your own business, and it unlocks the Pro features on your install. This page follows a key from purchase to renewal.

## 1. Buy

Choose Self-host Pro on the [Self-host](/self-host) page and pay by card. When the payment is confirmed, a key is made for you and emailed once to the address on the payment. We keep only a fingerprint of the key, never the key itself, so it cannot be shown again. Keep the email.

## 2. Install the key

Add it to the `.env` of your install and restart:

```ini
# add this line to .env in your install folder (a file, not a command)
DOCUSTAY_LICENSE_KEY=<the key from the email>
```

```bash
docker compose up -d
```

The first time the app starts with a key it has not used before, it downloads the Pro add-on from docustay.app. Your key and the install's own id are sent; a key that is valid, not ended and not cancelled, and that belongs to this install, gets the add-on (a different install gets the same refusal as a wrong key). The add-on is checked against its digest before it is unpacked into the install's data folder. To fetch it again or after a failure:

```bash
docker compose exec app node docustay/selfhost/addon.mjs pull
docker compose restart app worker
```

The install then checks the key against the public key shipped with it (`license-public.pem`). That check happens on your machine: a key is valid if it was signed by us, has not ended, and was not cancelled.

## 3. Renewal

When your yearly payment succeeds, the key is extended to the end of the paid year plus 14 days of grace, so a late card does not switch your install off. You do not need to change anything: an install that can reach docustay.app renews its record by itself.

## 4. Working offline

An install with no route to the internet cannot renew by itself. Open Settings and download the usage report (it holds five whole numbers and an install id, never a document, name or address), and send it to us when we ask. You can also turn off the daily anonymous ping with `DOCUSTAY_TELEMETRY=off`; the key still works.

## 5. When the licence ends

If you cancel or the grace days pass, the Pro features stop (the add-on stays in the data folder but is not loaded without a live licence). Your documents, signed PDFs and settings are not touched, and the install keeps running as Community. Nothing is deleted.

## Lost key?

Write to the address on your payment receipt.

## What the install sends, exactly

With `DOCUSTAY_LICENSE_KEY` set, the worker checks your Pro licence as well as sending its anonymous daily usage ping. The ping holds a random install id, the version and five counts, never a document, name or email. `DOCUSTAY_TELEMETRY=off` stops the ping without affecting the key's validity.

## Which file does what

| Item | Where | Purpose |
|---|---|---|
| `DOCUSTAY_LICENSE_KEY` | your `.env` | the key from your purchase email |
| `license-public.pem` | shipped in the install | the public key your machine checks the signature against |
| the usage report | Settings, download | five whole numbers and an install id, for installs that cannot reach the internet |

## What stops and what stays

When the licence ends, the Pro features stop, and nothing else changes. Your documents, signed PDFs and settings stay where they are, and the install keeps running as Community under the AGPL-3.0.

## Before you contact us

Write to the address on your payment receipt. Do not paste the key itself into a message.

## One production instance per key

A key is for one production instance. The install checks its key when it is set up and then about once a month. If it cannot reach docustay.app, the last answer keeps working for another 30 days, so a short outage never switches Pro off.

If a second production instance uses the same key, **Settings, Usage** on each instance shows a warning and we email the licence owner. Nothing is switched off because of it. The check sends only the key, the install's anonymous id, the version and the instance role: never a document, a name or an address.

A test or staging copy does not count if you set `DOCUSTAY_INSTANCE_ROLE=test` in its `.env`. If you need a second production instance, write to us and we will sort out the licence.
