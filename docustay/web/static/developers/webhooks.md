---
title: E-signature webhooks
description: Every document event, from sent and opened to signed, completed, declined and voided, signed with the Standard Webhooks headers. Verify the raw body, ignore repeats by webhook-id, replay from the delivery log.
---

# Webhooks

Every document event, from sent and opened to signed, completed, declined and voided, signed with the Standard Webhooks headers. Verify the raw body, then fetch the document.

```
documents.document.sent
documents.document.opened
documents.document.signed
documents.document.executed
documents.document.declined
documents.document.expired
documents.document.voided
```

## Four steps.

1. **Read**: Raw body, as bytes
2. **Verify**: Three headers
3. **Dedupe**: webhook-id
4. **Answer 200**: Queue the work

## Refuse a changed body, a wrong secret, an old timestamp.

```
import { verifyWebhook } from "@docustay2026/sdk";
const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, rawBody);
```

## Delivery you can debug.

**Retries.** A failed delivery is retried, and every attempt is in the delivery log.

**Replay.** Send again replays an event as often as you like, so you can fix the receiver without making another document.

**Rotation.** Rotate an endpoint's secret without recreating the endpoint.

## Change one byte and the signature stops matching.

Each delivery carries a signature over its id, its timestamp and its raw body. A body that was changed on the way fails the check.

**Raw body.** Verify the bytes you received, not re-serialised JSON.

**Fresh.** A timestamp more than five minutes old is refused.

**Once.** Use webhook-id to ignore a repeat.

## Every event, and when it fires.

| Event | When |
| --- | --- |
| documents.document.sent | The document went out |
| documents.document.opened | Someone opened their link |
| documents.document.signed | One person signed |
| documents.document.executed | Everyone signed and the sealed copy exists |
| documents.document.declined | A person declined |
| documents.document.expired | It lapsed before everyone signed |
| documents.document.voided | The sender cancelled it |

Events carry facts about the document, never a signing link or a code.

## Trigger an event and check the signature locally.

**Replay.** Send again replays an event from the delivery log, as often as you like.

**Same code.** verify uses the same code as the SDK.

## Verify, ignore repeats, answer fast.

Read the raw body, verify the three headers against it, skip a webhook-id you have seen, answer 200 and do slow work afterwards.

```
import http from "node:http";
import { verifyWebhook } from "@docustay2026/sdk";
const seen = new Set();
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");   // the bytes you received
    let event;
    try { event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, raw); }
    catch (e) { res.writeHead(400).end(e.message); return; }
    const id = req.headers["webhook-id"];
    if (seen.has(id)) { res.writeHead(200).end("repeat"); return; }
    seen.add(id);
    console.log(event.topic, event.subject_id);          // then queue the work
    res.writeHead(200).end("ok");
  });
}).listen(3000);
```

## What happens when your server is down.

| Attempt | Sent |
| --- | --- |
| 1 | Straight away |
| 2 | 1 minute after the first fails |
| 3 | 5 minutes later |
| 4 | 30 minutes later |
| 5 | 2 hours later |
| 6 | 12 hours later; after this one fails the delivery is marked as given up |

Six attempts in all. Any 2xx counts as delivered. Every attempt is in the delivery log, where Send again replays it.

## Add an endpoint and rotate its secret without a gap.

eventTypes come from GET /api/v1/webhooks/topics. The signing secret is in the answer once.

```
curl -X POST https://app.docustay.app/api/v1/webhooks \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/docustay", "eventTypes": ["documents.document.executed"] }'
```

## Three things people get wrong.

| Topic | Detail |
| --- | --- |
| Raw body only | Verify the bytes you received. A framework that parses JSON and re-serialises it changes the bytes, and the signature will not match. |
| A public address | Docustay posts only to a public https address. localhost, 127.0.0.1 and home or office network addresses are refused when you add the endpoint. Use docustay listen while you build. |
| Events are hints | They can repeat and arrive out of order. Fetch the document with GET /api/v1/documents/{id} rather than treating an event as the final word. |

## What an event carries.

| Field | Meaning |
| --- | --- |
| topic | The event name, such as documents.document.executed |
| subject_id | The id of the document the event is about |
| source | "sent" for a document your team sent |
| documents.template.fields_detected | A template made from an uploaded file had its fields looked for; the payload says how many were found, how many signers, how many it was unsure of and how many were placed |
| documents.ai.allowance_low | The workspace's AI drafts reached 80% of the period's allowance; sent once per period |
| documents.usage.threshold | A budget alert: the workspace used 50%, 80% or 100% of its monthly budget (kind "budget"), or the month closed (kind "summary"); each budget alert is sent once a month |

Events carry facts about the document, never a signing link or a code.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Build with the relay | docustay listen forwards signed events to your laptop; nothing is opened to the internet. | CLI: /developers/cli |
| Test the whole flow | A test key makes documents that fire the same events. | Test mode: /developers/test-mode |
| Read the document back | The REST API page covers states and the sealed copy. | REST API: /developers/api |

## Three commands that stand in for a public server.

From the command line, with a test key.

**listen.** docustay listen forwards real, signed webhook deliveries to an address on your own computer, such as http://localhost:3000/webhooks, so you never have to open a port.

**trigger.** docustay trigger sends a test event to the listening endpoint. Choose the event with --topic, for example documents.document.executed.

**verify.** docustay verify checks a signature the way your server should, from the secret, the webhook-id, the timestamp, the signature and the body.

## Questions

**Can I send to localhost?**

No. Endpoints must be public https addresses. Use a tunnel, or npx docustay listen --forward-to.

**Does an event carry a signing link?**

Never. Events carry facts about the document, not links or codes.

**Which event means finished?**

documents.document.executed: everyone signed and the sealed copy exists.


## Keep reading

- [Test mode](/developers/test-mode)
- [Command line](/developers/cli)
- [REST API](/developers/api)
