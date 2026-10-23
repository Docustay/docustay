---
title: Send a document for signature from TypeScript
description: Send a document for signature from TypeScript, with a program that was run against Docustay with a test key.
---

# Send a document for signature from TypeScript

Sign PDF API in TypeScript: a short program that sends a template for signature, run against Docustay with a test key before it was published. Set DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID.

`npm install @docustay2026/sdk`

The types ship inside the package: SendRequest describes what you send and the answer is typed too, so a wrong field name fails in your editor and not at 2 a.m. The program runs as it stands on Node 22 and newer with --experimental-strip-types; elsewhere compile it with tsc as usual.

```
import { Docustay, type SendRequest } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY!, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const request: SendRequest = {
  templateId: process.env.DOCUSTAY_TEMPLATE_ID!,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
};
const doc = await docustay.sendDocument(request);
console.log(doc.id, doc.state);
```
