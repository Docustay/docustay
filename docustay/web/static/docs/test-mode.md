# Test mode

A document made in test mode is a practice run:

- It is emailed **only to the person who sent it**, with `[TEST]` in the subject.
- Its pages carry a TEST watermark.
- It is left out of usage and billing.
- Signing it records nothing as a real signature event.

## Three ways in

1. Use a `dsk_test_` API key.
2. Send with `send_options.test: true` from the app's own send step.
3. Turn on **Settings → Documents → Test mode** so everything the workspace sends is a practice run.

Documents carry `test: true` in the API, and the app marks them with a Test chip and a banner on the signing page. Switch back to a live key (or turn the setting off) to send real documents.

## What it is good for

Use test mode to check your whole flow before anything real is sent: that your template places fields where you expect, that your webhook receiver verifies a delivery, that your page handles the embedded form's events, and that your own screens show a finished document. Because a test document is emailed only to you, you can send one to a made-up person and read the email yourself.

## A short run-through

Put your test key (it starts `dsk_test_`) in `DOCUSTAY_API_KEY`, the same variable every other page uses, and the id of one of your templates in place of `TEMPLATE_ID` (`GET /api/v1/documents/templates` lists them). Send, and open the email:

```bash
curl -X POST https://app.docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "TEMPLATE_ID", "parties": [{ "seat": "signer_1", "name": "Practice Person", "email": "someone@example.com" }] }'
```

The answer is the same shape as a live send (it does not carry a `test` field); fetching the document afterwards shows `"test": true`. The email arrives in your own inbox, not someone@example.com's. Sign it, then fetch the document, with the `id` the send answered in place of `DOCUMENT_ID`:

```bash
curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## What test mode does not do

It does not test payments against real cards. A document made in test mode is marked as a practice run on its pages and in the API (`test: true`), and it is left out of your usage, so you can practise as much as you like.

## Checking your webhook receiver without a real signature

Test documents fire the same webhooks as live ones, so you can prove your receiver end to end. From your laptop, forward events to your own server and ask for a sample:

```bash
npx docustay listen --forward-to http://localhost:3000/webhooks --events documents.document.executed
npx docustay trigger --topic documents.document.executed
```

`listen` prints the secret to use and forwards real, signed events. To check one signature by hand, save the delivery's exact body to `body.json` and give `verify` that file, the three `webhook-*` headers of the same delivery and the secret `listen` printed:

```bash
npx docustay verify --secret whsec_… --id MSG_ID --timestamp TIMESTAMP --signature "v1,…" --body body.json
```

The recent email log is also available from the command line with `docustay logs --emails`, and in the app under Developers → Email events.

## Moving to live

When the practice run works, change one thing: the key. Nothing in the request changes. Live documents count toward your monthly allowance on Free and are emailed to the real signers.
