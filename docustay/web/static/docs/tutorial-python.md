# Tutorial: send a document from Python

This tutorial uses the Python SDK and nothing else, so it runs on any machine with Python 3. The finished program is `docustay/examples/python/app.py`.

## 1. What you need

A Docustay **test** API key, a template id, and Python 3.9 or newer.

```bash
pip install docustay
export DOCUSTAY_API_KEY=dsk_test_…
export DOCUSTAY_TEMPLATE_ID=<template id>
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

With a test key, Pat is not emailed; the document is made so you can try the whole flow. To see it as the signer, call `docustay.test_sign(doc["id"], "signer_1")`.

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
open("signed.pdf", "wb").write(docustay.download_signed_pdf(doc["id"]))
```

## 5. Errors and limits

Every failure raises `DocustayError` with the HTTP status and the message from Docustay. Network failures and `429` answers are retried for you. Pass `idempotency_key=` to a send if you might call it twice for the same event; the second call returns the first result instead of sending again.

## 6. Go further

The whole example, with the page that embeds the signing form, is `docustay/examples/python/app.py`. Swap in a live key only once the test flow works.
