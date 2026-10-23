---
title: Send a document for signature from JavaScript
description: Send a document for signature from JavaScript, with a program that was run against Docustay with a test key.
---

# Send a document for signature from JavaScript

Sign PDF API in JavaScript: a short program that sends a template for signature, run against Docustay with a test key before it was published. Set DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID.

`npm install @docustay2026/sdk`

The package has no dependencies and needs Node 18 or newer. It makes one Idempotency-Key for each call and reuses it on every retry, so a network retry never sends the document twice. It is an ES module, so use import, or a .mjs file.

```
import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
});
console.log(doc.id, doc.state);
```
