# @docustay2026/sdk

JavaScript / TypeScript client for the Docustay API. No dependencies; Node 18+, browsers, Deno, Bun. MIT.

```js
import { Docustay, verifyWebhook } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY); // "dsk_test_…" keys run in test mode
const { id } = await docustay.sendDocument({ templateId, parties: [{ seat: "signer_1", name: "Tess", email: "tess@example.com" }] });
for await (const d of docustay.eachDocument({ state: "executed" })) console.log(d.id);
```

Every POST carries an `Idempotency-Key` (made for you; pass `{ idempotencyKey }` to choose it), reused on every retry. 429 and 5xx are retried with `Retry-After`. Errors are `DocustayError` (`status`, `kind`, `requestId`).
`verifyWebhook(secret, headers, rawBody)` checks a delivery (Standard Webhooks) and returns the event.
