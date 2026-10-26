---
title: E-signature API you can own
description: A REST API, SDKs, signed webhooks and an embeddable signer, with test mode on from the first call. Open source under AGPL-3.0. Free to build; Pro is one flat price to ship.
---

# The e-signature API you own. One flat price for every user.

Open source and self-hostable. Pro is $35 a month for your whole team: no per-seat fees, unlimited people and documents. Signers can pay while they sign, straight into your own Stripe account, and Pro adds no fee.

Docustay is the open source e-signature API (AGPL-3.0): one OpenAPI 3.1 file with 64 operations, test mode on from the first call, signed webhooks, six clients (JavaScript, TypeScript, Python, Go, PHP, C#), a command line and an MCP server.

- [Quickstart](/docs/quickstart)
- [REST API](/developers/api)
- [Webhooks](/developers/webhooks)
- [Test mode](/developers/test-mode)
- [SDKs](/developers/sdks)
- [CLI](/developers/cli)
- [Agents and MCP](/developers/agents)
- [Embedding](/developers/embedding)
- [Keys and security](/developers/keys-and-security)

Send: POST /api/v1/documents/send with an Authorization bearer key, an Idempotency-Key of 8 to 200 characters, and a templateId with parties. Webhooks use the Standard Webhooks headers and are retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. The limit is 600 requests a minute for each key.
