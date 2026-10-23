---
title: E-signature SDKs
description: Clients for JavaScript, TypeScript and Python add idempotency keys, retries, typed errors and webhook verification. Built and tested; install from npm and PyPI. Go, PHP and C# clients are generated from the OpenAPI file.
---

# SDKs

JavaScript, TypeScript and Python clients. Idempotency keys, retries, typed errors and webhook verification are built in. Go, PHP and C# clients are generated from the OpenAPI file: `go get github.com/docustay/docustay-go/docustay`, `composer require docustay/docustay-php`, `dotnet add package Docustay.Api`.

```
# npm install @docustay2026/sdk
import { Docustay } from "@docustay2026/sdk";
const d = new Docustay(process.env.DOCUSTAY_API_KEY);
const doc = await d.sendDocument({ templateId, parties });
console.log(doc.id, doc.state);
```

## What each client does for you.

- **Idempotency**: Adds an Idempotency-Key to every POST and reuses it on retries
- **Retries**: Retries 429 and 5xx and honours Retry-After
- **Errors**: Throws DocustayError with status, kind, message and requestId
- **Paging**: eachDocument and each_document walk every page

- **JavaScript**: @docustay2026/sdk · Node 18+, browser, Deno, Bun
- **TypeScript**: Types ship inside the package
- **Python**: docustay · Python 3.9+, standard library only
- **Others**: Generate a client from the OpenAPI 3.1 file

## One call.

```
import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
});
console.log(doc.id, doc.state);
```

## Every call exists in the API, both SDKs and the MCP server.

| API | JavaScript | Python | MCP tool |
| --- | --- | --- | --- |
| POST /documents | createDocument | create_document | create_document |
| POST /documents/check | checkDocument | check_document | check_document |
| GET /documents/{id}/source | getDraftSource | get_draft_source | get_draft_source |
| POST /documents/{id}/revise | reviseDocument | revise_document | revise_document |
| POST /documents/{id}/send | sendDraft | send_draft | send_draft (asks first) |
| POST /templates/{id}/documents | useTemplate | use_template | use_template |
| POST /templates/{id}/defaults | setTemplateDefaults | set_template_defaults | set_template_defaults |

Everything the screens do, a key can do.

## Page through everything without writing the loop.

**Both clients.** each_document does the same in Python.

**No loop.** You never touch the cursor.

## Point the same client at a self-hosted install.

Both clients talk to https://app.docustay.app unless you say otherwise.

```
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, { baseUrl: "https://sign.example.com" });
```

## Every setting you can pass to the client.

| Setting | JavaScript | Python | Default |
| --- | --- | --- | --- |
| Server address | baseUrl | base_url | https://app.docustay.app |
| Retries on 429 and 5xx | maxRetries | max_retries | 2 |
| Request timeout | timeoutMs | timeout | 30,000 ms (JavaScript), 30 seconds (Python) |
| Your own fetch | fetch | not applicable | global fetch |

A retry waits for Retry-After when the answer has one, and every retry of one call reuses the same Idempotency-Key.

## Catch the typed error and read its fields.

Both clients throw DocustayError with status, kind, message and the request id. A plan limit is a 403 whose code says which limit.

```
import { Docustay, DocustayError } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
try {
  await docustay.sendDocument({ templateId, parties });
} catch (e) {
  if (!(e instanceof DocustayError)) throw e;
  if (e.code === "plan_document_limit") console.log("limit reached, resets", e.detail.resetsAt);
  else console.log(e.status, e.kind, e.requestId, e.retryable);
}
```

## What was run before this page said it.

| Topic | Detail |
| --- | --- |
| The retry | A local server answered the first send with 429 and Retry-After: 1. The client waited, sent again with the same Idempotency-Key and got the 201: two attempts, one key, one document. |
| The receiver | Webhook verification is in the same package, so a receiver needs no second library. The webhooks page shows one that was run the same way. |
| The pager | eachDocument and each_document follow page.nextCursor until it is null, so you never write the loop. |

## The edges.

| Item | Detail |
| --- | --- |
| Install | npm install @docustay2026/sdk, or pip install docustay; Go, PHP and .NET: go get github.com/docustay/docustay-go/docustay, composer require docustay/docustay-php, dotnet add package Docustay.Api |
| Runtime | Node 18 or newer, a browser, Deno or Bun; Python 3.9 or newer, standard library only |
| Other languages | The OpenAPI 3.1 file at /api/openapi.json and a Postman collection |

## Frameworks and the other languages.

| Package | What it is for |
| --- | --- |
| @docustay2026/react, @docustay2026/vue, @docustay2026/angular | Wrappers around the embedded signing element; they emit completed, declined and the rest as events |
| Go, PHP and C# | Plain HTTP with each language's own standard library, shown on the sign-a-document pages; or generate a client from the OpenAPI 3.1 file, and try each call by hand with the Postman collection |
| docustay (CLI) | Send a test document, forward webhooks and verify signatures from a terminal |

## The same call in two languages.

```
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const doc = await docustay.sendDocument({ templateId: "TEMPLATE_ID", parties: [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }] });
console.log(doc.id, doc.state);
```

## What each error kind asks of you.

| kind | What to do |
| --- | --- |
| validation | Fix the request; the message says which field and why |
| unauthenticated, forbidden | Check the key and its scopes; a 403 can also be a plan limit with a code |
| not_found, conflict | The id is wrong, or the document is in a state that does not allow it, such as voiding a finished one |
| rate_limited, dependency, timeout | Retried for you up to the limit; past it the error is thrown with retryable set |



## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Send your first test document | Make a key, send with a test key and read the state back. | Test mode: /developers/test-mode |
| Verify a delivery | verifyWebhook and verify_webhook take the raw body and the three headers. | Webhooks: /developers/webhooks |
| Use another language | The OpenAPI 3.1 file describes every operation; generators can build a client. | REST API: /developers/api |

## Questions

**Can I use another language?**

Yes. Call the REST API, or build a client from the OpenAPI 3.1 file.

**Which frameworks have wrappers?**

React, Vue and Angular wrappers for the embedded signer are MIT-licensed.

**Where is the source?**

On GitHub: https://github.com/Docustay/docustay (the sdk/ folder; the Go, PHP and C# clients have their own repositories, docustay-go, docustay-php and docustay-csharp).


## Keep reading

- [REST API](/developers/api)
- [Embedding](/developers/embedding)
- [Sign documents from code](/sign-pdf)
