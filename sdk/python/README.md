# docustay

Python client for the Docustay API. Standard library only; Python 3.9+. MIT.

```python
from docustay import Docustay, verify_webhook
d = Docustay(os.environ["DOCUSTAY_KEY"])   # "dsk_test_…" keys run in test mode
doc = d.send_document(template_id, [{"seat": "signer_1", "name": "Tess", "email": "tess@example.com"}])
for x in d.each_document(state="executed"): print(x["id"])
```

POSTs carry an idempotency key (made for you, reused on retries). 429 and 5xx are retried honouring `Retry-After`. Errors are `DocustayError` (`status`, `kind`, `request_id`). `verify_webhook(secret, headers, raw_body)` checks a delivery and returns the event.
