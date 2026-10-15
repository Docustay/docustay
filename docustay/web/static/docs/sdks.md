# SDKs

Both clients cover every operation in the [API reference](/docs/api-reference.md), add an `Idempotency-Key` to every POST and reuse it on retries, retry `429` and `5xx` honouring `Retry-After`, throw a typed error with `status`, `kind` and the request id, page through lists for you and verify webhooks.

| Language | Package | Needs |
|---|---|---|
| JavaScript / TypeScript | `@docustay2026/sdk` | Node 18+, a browser, Deno or Bun; no dependencies |
| Python | `docustay` | Python 3.9+; standard library only |

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_KEY);
for await (const d of docustay.eachDocument({ state: "executed" })) console.log(d.id, d.title);
```

```python
import os
from docustay import Docustay
d = Docustay(os.environ["DOCUSTAY_KEY"])
for doc in d.each_document(state="executed"): print(doc["id"], doc["title"])
```

Other languages: the API is described by an OpenAPI 3.1 file at `/api/openapi.json` and a Postman collection at `/api/docustay.postman_collection.json`.
Frameworks: [`@docustay2026/react`, `@docustay2026/vue`, `@docustay2026/angular`](/docs/embedding.md).

## Pointing at your own server

Both clients talk to `https://app.docustay.app` unless you say otherwise. A self-hosted install, or any other Docustay address, goes in the constructor:

```js
const docustay = new Docustay(process.env.DOCUSTAY_KEY, { baseUrl: "https://sign.example.com" });
```

```python
d = Docustay(os.environ["DOCUSTAY_KEY"], base_url="https://sign.example.com")
```

If the address is wrong and answers with a web page instead of the API, the client throws a `DocustayError` of kind `bad_response` that names the address and this option; it does not show a JSON parse error.

## Installing

The packages are built and tested but not yet published to the public registries. Until they are, install them from the `sdk/` folder of the repository. The changelog will say when that changes.

## Sending a document

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_KEY);
const doc = await docustay.sendDocument({ templateId: "TEMPLATE_ID", parties: [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }] });
console.log(doc.id, doc.state);
```

```python
doc = d.send_document(template_id="TEMPLATE_ID", parties=[{"seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com"}])
print(doc["id"], doc["state"])
```

## Handling errors

Both clients throw a typed error with `status`, `kind`, `message` and `requestId`. Catch it, look at `kind`, and decide: `invalid` means fix the request, `rate_limited` and `dependency` are retried for you up to a limit, and `conflict` means the document is not in a state that allows what you asked.

## Other languages

Any language can call the REST API directly. The OpenAPI 3.1 file describes every operation. Clients generated from it for Go, PHP and C# (all 77 operations) are in `sdk/generated` in the repository; they are not on a package registry yet, so copy one in or generate your own. The Postman collection lets you try each call by hand.
