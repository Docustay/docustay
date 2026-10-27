---
title: Practice with a test key
description: Send with a dsk_test_ key and the document is emailed only to you, watermarked TEST, and left out of usage and billing. Practise without sending anything real.
---

# Test mode

Send with a dsk_test_ key. The email goes only to you, the pages carry a TEST watermark, and nothing counts toward usage.

## What a test document does.

**Emailed only to you.** The subject carries [TEST]. The person you named is never emailed.

**Watermarked.** Its pages carry TEST, and the API says test: true.

**Left out.** Usage and billing ignore it, so you can practise as much as you like.

## Pick one.

**A test key.** Use a key that starts dsk_test_.

**A send option.** Send with send_options.test: true from the app.

**A setting.** Turn on Settings → Documents → Test mode for the workspace.

## The email comes to you, marked [TEST].

The person you named is never emailed. Every page of the document carries a TEST watermark.

**The API.** Documents carry test: true.

**The app.** A Test chip, and a banner on the signing page.

## Send with a test key, then read it back.

```
curl -X POST https://app.docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_TEST_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "'"$DOCUSTAY_TEMPLATE_ID"'", "parties": [{ "seat": "signer_1", "name": "Practice Person", "email": "someone@example.com" }] }'
```

## What is different, line by line.

|  | Test | Live |
| --- | --- | --- |
| Who is emailed | Only the sender, subject marked [TEST] | The people you named |
| The pages | A TEST watermark | Clean |
| Usage and billing | Left out | Counted |
| Signing records | No real signature event | A real record |
| Payments | Not tested against real cards | Paid through your connected Stripe account |

Use test mode to check your whole flow before anything real is sent.

## Finish a test document without opening an email.

POST /api/v1/documents/{id}/test-sign signs one seat with sample answers through the same code a person's signature uses: consent, signing order, the audit trail and your webhooks all happen.

```
curl -X POST https://app.docustay.app/api/v1/documents/$DOCUSTAY_DOCUMENT_ID/test-sign \
  -H "Authorization: Bearer $DOCUSTAY_TEST_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "seat": "signer_1" }'
```

## Pick how a document becomes a practice run.

| Topic | Detail |
| --- | --- |
| A test key | Everything a dsk_test_ key sends is a practice run, whether or not the workspace setting is on. |
| A send option | send_options.test: true from the app's own send step marks that one document. |
| A workspace setting | Settings, Documents, Test mode makes everything the workspace sends a practice run until you turn it off. |

## A test key sees only test data.

| Question | Answer |
| --- | --- |
| Can it read a live document? | No. Any other document answers 404 |
| Where do the emails go? | Only to the sender, with [TEST] in the subject |
| What do the pages look like? | A TEST watermark on every page |
| Does it count? | No. Left out of usage and billing |
| Is a signature recorded as real? | No. Signing it records nothing as a real signature event |

Use it to check that your template places fields where you expect and that your receiver verifies a delivery.

## What test mode cannot tell you.

| Topic | Detail |
| --- | --- |
| Real cards | Test mode does not test payments against real cards, so a flow that takes money needs a Stripe test card on top. |
| Real inboxes | A test document goes only to you, so it cannot show how a recipient's mail provider treats the message. Send one live document to an address of your own for that. |
| Going live | Switch to a dsk_live_ key, or turn the workspace setting off. Nothing in your code changes except the key. |

## A full practice run in five steps.

| Step | What you do |
| --- | --- |
| 1. Key | Make a dsk_test_ key with documents:read and documents:write |
| 2. Send | POST /api/v1/documents/send with a template and a party you invent; the answer has "test": true |
| 3. Read | Open the [TEST] email in your own inbox; the person you named is never emailed |
| 4. Sign | Sign from the email, or call test-sign on the seat |
| 5. Check | GET the document until state is executed, and watch your webhook receiver verify the event |

Nothing in a practice run is counted or billed.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Watch the events | A test document fires the same webhooks as a live one. | Webhooks: /developers/webhooks |
| Run it from a terminal | docustay send --test refuses a live key unless you say --live. | CLI: /developers/cli |
| Know your key | Scopes, expiry and address limits for the key you ship with. | Keys and security: /developers/keys-and-security |

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
