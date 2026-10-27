---
title: Send a document for signature from Python
description: Send a document for signature from Python, with a program that was run against Docustay with a test key.
---

# Send a document for signature from Python

Sign PDF API in Python: a short program that sends a template for signature, run against Docustay with a test key before it was published. Set DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID.

`pip install docustay`

The package has no dependencies and needs Python 3.9 or newer. Calls are synchronous and return plain dictionaries. Every POST gets an idempotency key made for it and reused on retries. Pass base_url only when you point at a self-hosted install.

```
import os
from docustay import Docustay

kw = {"base_url": os.environ["DOCUSTAY_URL"]} if os.environ.get("DOCUSTAY_URL") else {}
docustay = Docustay(os.environ["DOCUSTAY_API_KEY"], **kw)
doc = docustay.send_document(
    os.environ["DOCUSTAY_TEMPLATE_ID"],
    [{"seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com"}],
)
print(doc["id"], doc["state"])
```
