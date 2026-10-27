---
title: The e-signature API you own, at one flat price
description: The open-source e-signature API. One flat price for every user, payments built in, self-hostable.
---

# The e-signature API you own. One flat price for every user.

Open source and self-hostable. Pro is $35 a month for your whole team: no per-seat fees, unlimited people and documents. Signers can pay while they sign, straight into your own Stripe account, and Pro adds no fee.

Send from your code, get documents signed on any device, and keep a sealed PDF with a certificate of completion. Self-host it under the AGPL-3.0 or use the hosted service.

- [Try the demo](/demo) (no sign-up; nothing is ever sent)
- [Read the docs](/docs)

## Integrate this afternoon

Make a test key, post a template and one signer, and listen for one webhook. A key that starts dsk_test_ only does practice runs.

```
curl -X POST "$DOCUSTAY_URL/api/v1/documents/send" \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"$DOCUSTAY_TEMPLATE_ID","parties":[{"seat":"signer_1","name":"Rosa Alvarez","email":"rosa@example.com"}]}'
```

## Why developers choose Docustay

- **You can read it.** The server, the app and the signing page are open source under the AGPL-3.0.
- **You can run it.** Three commands start your own copy; your documents stay on your server.
- **Safe to build against.** A test key emails only you, stamps pages TEST and never counts toward a limit.
- **Written down, not promised.** One OpenAPI 3.1 file; the reference and the clients are generated from it.
- **Made for agents.** An MCP server and a Claude plugin; a draft-only key can prepare documents but cannot send them.
- **AI that stays in its lane.** Scribe drafts and checks; a person approves every send.
- **Money inside signing.** The signer can pay as part of signing, into your own Stripe account.
- **Proof you can check without us.** Every signed PDF carries a certificate of completion with a hash; the verify page needs no account.
- **Pay for what you use.** Free is 15 documents a month; Pay as you go is $5 per team member; Pro is $35 for the whole workspace.

## More

- [Developers](/developers)
- [How it works](/features/how-it-works)
- [Templates](/free-templates)
- [Pricing](/pricing)
- [Self-host](/self-host)
- [Trust](/trust)

Docustay is not for protected health information yet.
