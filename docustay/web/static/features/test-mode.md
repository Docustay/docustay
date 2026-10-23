---
title: E-signature test mode: a built-in sandbox | Docustay
description: E-signature test mode: test keys, watermarked documents and email only to you. Build the whole flow before a real person gets anything.
---

# A full sandbox, built in.

E-signature test mode in one line: a test key signs watermarked documents and emails only you. Nothing a test key does counts toward a limit, and you can sign a test document yourself with one call.

## Practice runs that behave like the real thing.

**Test keys.** A key that starts dsk_test_ only does practice runs.

**Watermarked.** Every test document carries a TEST watermark so nobody mistakes it for a real agreement.

**Mail only to you.** Test emails go only to you, never to the signer you named.

## Same events, same webhooks.

**Same API.** A test key calls the same operations as a live key.

**Same events.** Test documents emit the same events, signed the same way, to your webhook.

**Not counted.** Test documents are left out of usage and billing.

## Listen to real events without opening a port.

**listen.** docustay listen forwards signed webhook events to your local server.

**send --test.** Sends a practice document and prints its id.

## Check the whole flow before anything real goes out.

**Your template.** See that fields land where you expect and that each seat is named the way your code names it.

**Your webhook receiver.** Prove that it verifies a delivery, ignores repeats and answers fast, with real signed events.

**Your embedded page.** Check that your page handles the form's events, and that your own screens show a finished document.

## A practice run should look like a practice run.

Because a test document is emailed only to you, you can send one to a made-up person and read the whole email yourself. It carries a TEST watermark and a [TEST] subject, so nobody mistakes it for a real agreement, and it is left out of usage and billing, so you can practise as much as you like.

When you are ready, switch to a live key, or turn the workspace's test setting off, and the same code sends real documents.

## Pick how you switch it on.

**A test key.** Use an API key that starts dsk_test_ and everything it sends is a practice run.

**A send option.** Send with test set to true from the app's own send step, for one document.

**A workspace setting.** Turn on Settings, Documents, Test mode and everything the workspace sends is a practice run until you turn it off.

## What differs between a test document and a live one.

|  | Test document | Live document |
| --- | --- | --- |
| Email goes to | Only the person who sent it, with [TEST] in the subject | The people you named |
| Pages carry | A TEST watermark | No watermark |
| Usage and billing | Left out | Counted |
| A signature | Records nothing as a real signature event | A real signature event |
| Events and webhooks | The same events, signed the same way | The same events |
| Plan needed | Any, including Free | Any |

## Send a test document in your language.

Every sample below was run against the API's own rules before it was published.

```
import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
});
console.log(doc.id, doc.state);
```

## Prove your receiver without a real signature.

Test documents fire the same webhooks as live ones. From your laptop, listen forwards real, signed events to your own server, and trigger asks for a sample of any topic.

- Listen prints the secret to use and forwards each event.
- Verify checks one signature by hand when you give it the three headers and the exact body.

## What test mode does, and what it does not.

- **Whole flow**: Check your template, your webhook receiver and your embedded events
- **As often as you like**: Practice runs never count toward a limit
- **Same shape**: A send answers in the same shape as a live send

- **Payments**: It does not test payments against real cards
- **Real signers**: It never emails the person you named
- **Live proof**: A test signature is not a real signature event

## Questions

**Is test mode on Free?**

Yes. It is on every plan.

**Can a test document be sent to a real person?**

No. A test key emails only you.

**How do I test webhooks?**

Use the command line's listen command, or point a test key's webhook at a request catcher.

**Does a test signature count as a real one?**

No. Signing a test document records nothing as a real signature event, and the document is marked as a practice run on its pages and in the API.

**Can I test payments?**

Not against real cards. Test mode does not take payments.

**Where do I see a document's test flag?**

In the API the document carries test: true, and the app marks it with a Test chip and a banner on the signing page.


## Keep reading

- [Developers: test mode](/developers/test-mode)
- [Webhooks](/developers/webhooks)
- [Command line](/developers/cli)
