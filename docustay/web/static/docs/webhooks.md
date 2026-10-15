# Webhooks

Register an endpoint in **Settings → Developers → Webhooks**, choose the events, and Docustay posts a JSON event to it each time one happens. Each endpoint has a secret that starts `whsec_`, shown once.

## Verify every delivery

Deliveries carry the [Standard Webhooks](https://www.standardwebhooks.com) headers `webhook-id`, `webhook-timestamp` and `webhook-signature` (`v1,<base64 HMAC-SHA256 of "id.timestamp.body">`). Verify against the **raw** body, not re-serialised JSON.

```js
import { verifyWebhook } from "@docustay2026/sdk";
const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, rawBody);
```

```python
from docustay import verify_webhook
event = verify_webhook(secret, headers, raw_body)
```

Both refuse a changed body, a wrong secret and a timestamp more than five minutes old.
A receiver using any Standard Webhooks library passes `whsec_` plus the secret with `-` swapped for `+` and `_` for `/`.

## Trying it from your laptop

Docustay can only send to a public `https://` address: `localhost`, `127.0.0.1` and office or home network addresses are refused when you add the endpoint, and the message says so. While you build the receiver, give your laptop a public address with a tunnel tool, add that address as the endpoint, and use **Send again** in the delivery log to replay an event as often as you like. When the receiver is deployed, replace the address.

## Delivery

Answer with any `2xx` quickly. A delivery that fails is tried again after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, which is six attempts in all. After the sixth failure it is marked as given up. Every attempt is in the delivery log under the endpoint, where a delivery can be replayed. Deliveries can arrive more than once and out of order: use the `webhook-id` to ignore a repeat, and fetch the document (`GET /api/v1/documents/{id}`) rather than trusting the event as the final word.

The events carry facts about the document, never a signing link or a code.

## What a delivery looks like

The body is one JSON object, exactly as signed:

```json
{
  "id": "01a1362b-5187-7ab3-a070-9abc82270c04",
  "topic": "documents.document.executed",
  "subject_type": "document",
  "subject_id": "7a1c6f0e-…",
  "payload": { "externalId": "crm-123", "metadata": { "deal": "42" }, "parties": {}, "test": false, "source": "sent", "form": null, "executed_at": "2026-10-13T17:02:11.000Z" },
  "emitted_at": "2026-10-13T17:02:11.412Z"
}
```

- `id` is the event's id and is the same value as the `webhook-id` header. It is **time-ordered** and it does not change when a delivery is retried or replayed, so use it to ignore a delivery you already handled.
- **Order is not promised.** If the first try of one event fails and a later event arrives first, the later one is delivered first. Put events in order by `emitted_at` (or by `id`), not by arrival.
- `payload.test` is `true` on every event of a test-mode document and `false` otherwise, so a receiver can ignore practice runs.
- `payload.parties` holds the references **you** gave for each person when you sent the document (`{}` when you gave none). It is not a list of signers.
- Events carry no internal person ids. Who did what is in the document's audit log.

## Which events

You choose per endpoint. The ones most receivers want are `documents.document.sent`, `documents.document.opened`, `documents.document.signed` (one person signed), `documents.document.executed` (everyone signed and the sealed copy exists), `documents.document.declined`, `documents.document.expired` and `documents.document.voided`. A receiver that only cares about finished documents subscribes to `documents.document.executed` and nothing else.

Every document event says where the document came from: `source` is `"form"` for a response to one of your forms and `"sent"` for a document your team sent, and `form` is `{ "id", "name" }` for a form response (otherwise `null`). A receiver that only wants form responses checks `source`.

Two more come from the workspace rather than a document: `documents.template.fields_detected` (a template was made from an uploaded file and the fields were looked for; the payload says how many were found, how many signers, how many it was unsure of and how many were placed) and `documents.ai.allowance_low` (the workspace's AI credits reached 80% of the period; sent once per period).

## A receiver, step by step

1. Read the **raw** request body as bytes before any JSON parser touches it.
2. Verify the three headers against that body with the SDK, as above. If verification throws, answer `400` and stop.
3. Look at `webhook-id`. If you have processed it, answer `200` and stop; this is a repeat.
4. Queue the work (fetch the document, save the signed copy) and answer `200` at once. Do slow work after you have answered.

```bash
curl https://docustay.app/api/v1/documents/DOCUMENT_ID/signed.pdf \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -o signed.pdf
```

## The delivery log

Each endpoint's page shows a delivery log with the event, the result your server gave and which try it was. **Send again** replays a delivery, so you can fix your receiver and try again without making another document. Repeats carry the same `webhook-id`, which is why your receiver should ignore ids it has already handled.
