---
title: E-signature API you can own
description: A REST API, SDKs, signed webhooks and an embeddable signer, with test mode on from the first call. Open source under AGPL-3.0. Free to build, flat price to ship.
---

# An API you can read in an afternoon.

A REST API, SDKs, webhooks and an embeddable signer. Test mode keeps every email to you until you go live.

## Pick your language.

- [JavaScript](/sign-pdf/javascript): Send a document from JavaScript.
- [TypeScript](/sign-pdf/typescript): Typed requests and answers.
- [Python](/sign-pdf/python): No dependencies, Python 3.9+.
- [curl](/developers/api): One call from a terminal.

## How a signing flow reports back.

1. **document.sent**: Emailed
2. **document.opened**: Link opened
3. **document.signed**: One person signed
4. **document.executed**: Sealed copy exists

## What you can build.

**Embed the signer.** Show the signing form inside your own page with one element. The key stays on your server.

**Send from your backend.** POST a template and a person; read back the state. Writes are idempotent.

**React to events.** Seven signed events, replay from the log, rotate the secret.

## Safe to try, safe to hand to an agent.

- **Test keys**: dsk_test_ keys never email anyone but you
- **Watermark**: Every page carries TEST
- **Counting**: Left out of usage, billing and reports

- **Draft**: An assistant can draft from a template or a play
- **Approve**: A person approves each send
- **Revoke**: Draft-only keys expire in 90 days and can be revoked at once

- **Free**: 15 documents and 5 new templates a month, API included
- **Rate**: 600 requests a minute per key
- **Pro**: Unlimited documents, 500 emails a day

## Questions

**Is there a free tier for building?**

Yes. The Free plan includes the API, webhooks and test mode inside 15 documents and 5 new templates a month; test-mode documents never count.

**Are the SDKs on npm and PyPI?**

Not yet. They are built and tested, and you install them from the sdk/ folder of the repository. The changelog will say when that changes.

**Can I try without a card?**

Yes. Create a key, send with a test key, and the document is emailed only to you.

**Can I run it myself?**

Yes. The code is AGPL-3.0, and Self-host Community is free.


## Keep reading

- [REST API](/developers/api)
- [Test mode](/developers/test-mode)
- [Sign documents from your code](/sign-pdf)
