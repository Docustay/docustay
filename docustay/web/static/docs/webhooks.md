# Webhooks

Register an endpoint in **Settings → Developers → Webhooks**, choose the events, and Docustay posts a JSON event to it each time one happens. Each endpoint has a secret that starts `whsec_`, shown once.

## Verify every delivery

Deliveries carry the [Standard Webhooks](https://www.standardwebhooks.com) headers `webhook-id`, `webhook-timestamp` and `webhook-signature` (`v1,<base64 HMAC-SHA256 of "id.timestamp.body">`). Verify against the **raw** body, not re-serialised JSON.

Deliveries also carry three older headers, `keystone-event-id`, `keystone-timestamp` and `keystone-signature`, kept for receivers built before the Standard Webhooks ones. New code should ignore them and verify with the `webhook-*` headers above. An event's `data` can also hold fields this page does not show; rely only on the documented ones, since others may change or go without notice.

```js
// npm install @docustay2026/sdk  ·  DOCUSTAY_WEBHOOK_SECRET=whsec_… node receiver.mjs
import http from "node:http";
import { verifyWebhook } from "@docustay2026/sdk";

http.createServer(async (req, res) => {
  let rawBody = ""; for await (const chunk of req) rawBody += chunk;   // the raw text, before any JSON parser
  try {
    const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, rawBody);
    console.log(event.topic, event.subject_id);
    res.writeHead(204).end();
  } catch { res.writeHead(400).end("bad signature"); }
}).listen(4000, () => console.log("listening on http://localhost:4000"));
```

```python
# pip install docustay  ·  DOCUSTAY_WEBHOOK_SECRET=whsec_… python receiver.py
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from docustay import verify_webhook

class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        raw_body = self.rfile.read(int(self.headers.get("content-length", 0)))   # the raw bytes, before any JSON parser
        try:
            event = verify_webhook(os.environ["DOCUSTAY_WEBHOOK_SECRET"], self.headers, raw_body)
            print(event["topic"], event["subject_id"])
            self.send_response(204); self.end_headers()
        except ValueError:
            self.send_response(400); self.end_headers(); self.wfile.write(b"bad signature")

HTTPServer(("localhost", 4000), Receiver).serve_forever()
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

You choose per endpoint. The ones most receivers want are `documents.document.sent`, `documents.document.opened`, `documents.document.signed` (one person signed), `documents.document.executed` (everyone signed and the sealed copy exists), `documents.document.declined`, `documents.document.expired` and `documents.document.voided`. A receiver that only cares about finished documents subscribes to `documents.document.executed` and nothing else. If a document takes payment, `documents.payment.received` says a signer paid (the document, the payment id, the amount and currency) and `documents.payment.failed` says a payment plan's charge failed; `GET /api/v1/webhooks/topics` lists every event.

Every document event carries `source` (always `"sent"`) and `form` (always `null`). Both stay in the payload so receivers written before version 1 keep working.

Two more come from the workspace rather than a document: `documents.template.fields_detected` (a template was made from an uploaded file and the fields were looked for; the payload says how many were found, how many signers, how many it was unsure of and how many were placed) and `documents.ai.allowance_low` (the workspace's AI drafts reached 80% of the plan's allowance; sent once per period) and `documents.usage.threshold` (the workspace's bill passed 50%, 80% or 100% of its budget, or an early invoice or monthly summary is ready; `kind` is `budget` or `summary`).

## A receiver, step by step

1. Read the **raw** request body as bytes before any JSON parser touches it.
2. Verify the three headers against that body with the SDK, as above. If verification throws, answer `400` and stop.
3. Look at `webhook-id`. If you have processed it, answer `200` and stop; this is a repeat.
4. Queue the work (fetch the document, save the signed copy) and answer `200` at once. Do slow work after you have answered.

```bash
curl https://docustay.app/api/v1/documents/DOCUMENT_ID/signed.pdf \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -o signed.pdf
```

## The delivery log

Each endpoint's page shows a delivery log with the event, the result your server gave and which try it was. **Send again** replays a delivery, so you can fix your receiver and try again without making another document. Repeats carry the same `webhook-id`, which is why your receiver should ignore ids it has already handled.
