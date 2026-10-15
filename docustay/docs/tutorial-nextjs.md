---
title: "Tutorial: e-signatures in a Next.js app"
description: Send a document from a Next.js route, show the signing form inside your page, and check the webhook that says it was signed.
order: 19
---

# Tutorial: e-signatures in a Next.js app

You will end up with three small files: a route that sends a document, a page that shows the signing form, and a route that checks Docustay's webhook. The finished app is in `docustay/examples/nextjs`. It takes about ten minutes.

## 1. What you need

- A Docustay account and a **test** API key (Developers). A test key sends nothing real and bills nothing.
- A template. Make one in the app (Templates → Create) and copy its id from the address bar.
- Your site's address listed under Settings → Developers → Embedding (`http://localhost:3000` while you try it).

## 2. Install

```bash
npm install @docustay2026/sdk @docustay2026/embed
```

Put the secrets in `.env.local`. They stay on the server:

```bash
DOCUSTAY_API_KEY=dsk_test_…
DOCUSTAY_TEMPLATE_ID=<template id>
DOCUSTAY_WEBHOOK_SECRET=whsec_…
```

## 3. Send a document

`app/api/send/route.js` turns a name and an email into a document whose signer signs in your page, so nobody is emailed:

```js
import { Docustay } from "@docustay2026/sdk";

export async function POST(req) {
  const { name, email } = await req.json();
  const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
  const doc = await docustay.sendDocument({
    templateId: process.env.DOCUSTAY_TEMPLATE_ID,
    embedded: ["signer_1"],
    parties: [{ seat: "signer_1", name, email }],
  });
  return Response.json({ id: doc.id });
}
```

## 4. Show the signing form

A server component asks for a link that lasts one hour. It is made on the server, so the key never reaches the browser:

```js
const { url } = await docustay.embedSession(id, { seat: "signer_1", origin: "http://localhost:3000" });
```

A small client component then renders `<docustay-sign url={url} height="720" />` and listens for the `completed` event. See `app/sign` in the example.

## 5. Check the webhook

Docustay signs every webhook. Read the body as text and verify it before you trust it:

```js
import { verifyWebhook } from "@docustay2026/sdk";

export async function POST(req) {
  try {
    const event = await verifyWebhook(process.env.DOCUSTAY_WEBHOOK_SECRET, req.headers, await req.text());
    // event.topic is for example documents.document.executed, event.subject_id is the document
    return new Response(null, { status: 204 });
  } catch { return new Response("bad signature", { status: 400 }); }
}
```

On your laptop, run `npx docustay listen --forward-to http://localhost:3000/api/webhooks`. It prints the secret to use and forwards real, signed events to your route.

## 6. Try it

```bash
curl -X POST localhost:3000/api/send -H 'content-type: application/json' -d '{"name":"Pat Example","email":"pat@example.com"}'
```

Open `/sign?id=<the id it returns>`, sign, and watch your webhook route log `documents.document.executed`. When it works, swap in a live key.
