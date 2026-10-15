---
title: E-signature webhooks
description: Seven document events, signed with the Standard Webhooks headers. Verify the raw body, ignore repeats by webhook-id, replay from the delivery log.
---

# Webhooks

Seven document events, signed with the Standard Webhooks headers. Verify the raw body, then fetch the document.

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
