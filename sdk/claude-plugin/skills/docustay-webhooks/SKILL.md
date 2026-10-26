---
name: docustay-webhooks
description: Use when the user wants to receive Docustay events (a document was signed, declined or expired) at their own server and verify them.
---

# Docustay webhooks

Docustay posts signed events to an endpoint the customer registers (Settings → Developer → Webhooks). Deliveries follow the Standard Webhooks headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`.

Always verify against the RAW body, never re-serialised JSON:

- JavaScript: `import { verifyWebhook } from "@docustay2026/sdk"; const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, rawBody);`
- Python: `from docustay import verify_webhook; event = verify_webhook(secret, headers, raw_body)`

Both refuse a changed body, a wrong secret and a timestamp more than 5 minutes old, and throw. Answer 2xx quickly; failed deliveries are retried and every attempt is in the delivery log, where a delivery can be replayed. Treat the event as a prompt to fetch the document (`GET /api/v1/documents/{id}`), not as the source of truth.
