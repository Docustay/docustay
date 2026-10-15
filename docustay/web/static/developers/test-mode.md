---
title: E-signature test mode
description: Send with a dsk_test_ key and the document is emailed only to you, watermarked TEST, and left out of usage, billing and reports. Practise without sending anything real.
---

# Test mode

Send with a dsk_test_ key. The email goes only to you, the pages carry a TEST watermark, and nothing counts toward usage.

## What a test document does.

**Emailed only to you.** The subject carries [TEST]. The person you named is never emailed.

**Watermarked.** Its pages carry TEST, and the API says test: true.

**Left out.** Usage, billing and reports ignore it, so you can practise as much as you like.

## Pick one.

**A test key.** Use a key that starts dsk_test_.

**A send option.** Send with send_options.test: true from the app.

**A setting.** Turn on Settings → Documents → Test mode for the workspace.

## Send with a test key, then read it back.

```
curl -X POST https://app.docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_TEST_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "TEMPLATE_ID", "parties": [{ "seat": "signer_1", "name": "Practice Person", "email": "someone@example.com" }] }'
```

## Questions

**Does test mode charge a card?**

No, and it does not test payments against real cards.

**Does a test signature count as real?**

No. Signing a test document records no real signature event.

**Can I tell a test document from a real one?**

Yes. The API says test: true and the app shows a Test chip and a banner.


## Keep reading

- [Webhooks](/developers/webhooks)
- [REST API](/developers/api)
- [Command line](/developers/cli)
