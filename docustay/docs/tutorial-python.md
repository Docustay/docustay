---
title: "Tutorial: send a document from Python"
description: Send a document from Python, show the signing form on your own page, and verify the webhook, using the Docustay SDK and the standard library.
order: 20
---

# Tutorial: send a document from Python

This tutorial uses the Python SDK and nothing else, so it runs on any machine with Python 3. The finished program is `docustay/examples/python/app.py`.

## 1. What you need

A Docustay **test** API key, a template id, and Python 3.9 or newer.

```bash
%%PIP_INSTALL docustay%%
export DOCUSTAY_API_KEY=dsk_test_…
export DOCUSTAY_TEMPLATE_ID="paste-your-template-id"   # from the address bar of the template in the app
```

## 2. Send one document

```python
import os
from docustay import Docustay

docustay = Docustay(os.environ["DOCUSTAY_API_KEY"])
doc = docustay.send_document(
    os.environ["DOCUSTAY_TEMPLATE_ID"],
    [{"seat": "signer_1", "name": "Pat Example", "email": "pat@example.com"}],
)
print(doc["id"], doc["state"])
```

With a test key, Pat is not emailed: the signing email goes only to you, the key's owner, stamped TEST, so you can try the whole flow. To see it as the signer, call `docustay.test_sign(doc["id"], "signer_1")`.

## 3. Wait for the result with a webhook

Polling works but a webhook is better. Docustay signs each delivery; `verify_webhook` refuses a changed body, a wrong secret and an old timestamp:

```python
from docustay import verify_webhook

event = verify_webhook(secret, headers, raw_body)   # raw_body is the exact text received
if event["topic"] == "documents.document.executed":
    print("signed:", event["subject_id"])
```

Use the raw body. If you parse the JSON first and serialise it again, the signature will not match.

On your laptop, `npx docustay listen --forward-to http://localhost:3000/webhooks` forwards real signed events and prints the secret.

## 4. Download the signed copy

```python
import os
from docustay import Docustay
docustay = Docustay(os.environ["DOCUSTAY_API_KEY"])
doc = {"id": os.environ["DOCUSTAY_DOCUMENT_ID"]}   # the document sent above, once everyone has signed
open("signed.pdf", "wb").write(docustay.download_signed_pdf(doc["id"]))
```

## 5. Errors and limits

Every failure raises `DocustayError` with the HTTP status and the message from Docustay. Network failures and `429` answers are retried for you. Pass `idempotency_key=` to a send if you might call it twice for the same event; the second call returns the first result instead of sending again.

## 6. Go further

The whole example, with the page that embeds the signing form, is `docustay/examples/python/app.py`. Swap in a live key only once the test flow works.

## Test your receiver without Docustay

You can prove `verify_webhook` accepts a correctly signed body and refuses a changed one using only the standard library. This program was run against the SDK in the repository:

```python
import base64, hashlib, hmac, json, time
from docustay import verify_webhook

key = b"0123456789abcdef0123456789abcdef"
secret = "whsec_" + base64.b64encode(key).decode()
body = json.dumps({"topic": "documents.document.executed", "subject_id": "doc_1"})
msg_id, ts = "msg_1", str(int(time.time()))
sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.{body}".encode(), hashlib.sha256).digest()).decode()
headers = {"webhook-id": msg_id, "webhook-timestamp": ts, "webhook-signature": "v1," + sig}

print(verify_webhook(secret, headers, body))        # the event, as a dict
verify_webhook(secret, headers, body + " ")          # raises ValueError: webhook signature does not match
```

The signed text is the id, the timestamp and the exact body joined with dots. That is why one extra space, or a re-serialised body, fails.

## Handling a repeat

Docustay can deliver the same event more than once, and failed deliveries are retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. Keep the `webhook-id` of every event you handle and answer `200` at once for an id you have already seen. Fetch the document before acting, since events can also arrive out of order.

## What to check before going live

Confirm that your receiver answers `200` quickly and does its slow work afterwards, that it ignores a `webhook-id` it has already handled, and that your code reads the raw body before any JSON parsing. Then change the key from a `dsk_test_` key to a live key. Nothing else in the program changes.
