---
title: E-signature SDKs
description: Clients for JavaScript, TypeScript and Python add idempotency keys, retries, typed errors and webhook verification. Built and tested; install from the sdk folder for now.
---

# SDKs

JavaScript, TypeScript and Python clients. Idempotency keys, retries, typed errors and webhook verification are built in.

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

## Point the same client at a self-hosted install.

Both clients talk to https://app.docustay.app unless you say otherwise.

```
const docustay = new Docustay(process.env.DOCUSTAY_KEY, { baseUrl: "https://sign.example.com" });
```

## Questions

**Can I use another language?**

Yes. Call the REST API, or build a client from the OpenAPI 3.1 file.

**Which frameworks have wrappers?**

React, Vue and Angular wrappers for the embedded signer are MIT-licensed.

**Where is the source?**

In the sdk/ folder of the repository. The link appears here when the repository opens.


## Keep reading

- [REST API](/developers/api)
- [Embedding](/developers/embedding)
- [Sign documents from code](/sign-pdf)
