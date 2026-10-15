---
title: Test mode
description: Practice runs that email only you, carry a TEST watermark and are never counted or billed.
order: 6
---

# Test mode

A document made in test mode is a practice run:

- It is emailed **only to the person who sent it**, with `[TEST]` in the subject.
- Its pages carry a TEST watermark.
- It is left out of usage, billing and reports.
- Signing it records nothing as a real signature event.

## Three ways in

1. Use a `dsk_test_` API key.
2. Send with `send_options.test: true` from the app's own send step.
3. Turn on **Settings → Documents → Test mode** so everything the workspace sends is a practice run.

Documents carry `test: true` in the API, and the app marks them with a Test chip and a banner on the signing page. Switch back to a live key (or turn the setting off) to send real documents.

## What it is good for

Use test mode to check your whole flow before anything real is sent: that your template places fields where you expect, that your webhook receiver verifies a delivery, that your page handles the embedded form's events, and that your own screens show a finished document. Because a test document is emailed only to you, you can send one to a made-up person and read the email yourself.

## A short run-through

Send with a test key and open the email:

```bash
curl -X POST https://docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_TEST_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "TEMPLATE_ID", "parties": [{ "seat": "signer_1", "name": "Practice Person", "email": "someone@example.com" }] }'
```

The answer is the same shape as a live send (it does not carry a `test` field); fetching the document afterwards shows `"test": true`. The email arrives in your own inbox, not someone@example.com's. Sign it, then fetch the document:

```bash
curl https://docustay.app/api/v1/documents/DOCUMENT_ID -H "Authorization: Bearer $DOCUSTAY_TEST_KEY"
```

## What test mode does not do

It does not test payments against real cards. A document made in test mode is marked as a practice run on its pages and in the API (`test: true`), and it is left out of your usage, so you can practise as much as you like.
