# Tutorial: e-signatures in a Next.js app

You will end up with three small files: a route that sends a document, a page that shows the signing form, and a route that checks Docustay's webhook. The finished app is in `docustay/examples/nextjs`. It takes about ten minutes.

## 1. What you need

- A Docustay account and a **test** API key (Developers). A test key sends nothing real and bills nothing.
- A template. Make one in the app (Templates → Create) and copy its id from the address bar.
- Your site's address listed under Settings → Developers → Embedding (`http://localhost:3000` while you try it).

## 2. Make the app and install

In an empty folder:

```bash
mkdir docustay-demo && cd docustay-demo && npm init -y
npm pkg delete type
npm install next@15 react@19 react-dom@19 @docustay2026/sdk @docustay2026/embed
```

`npm pkg delete type` matters: newer npm writes `"type": "commonjs"` into package.json, and Next.js then refuses the `import` lines below.

Put the secrets in `.env.local` in that folder. They stay on the server:

```ini
# .env.local (a file, not a command)
DOCUSTAY_API_KEY=dsk_test_…
DOCUSTAY_TEMPLATE_ID=<template id>
DOCUSTAY_WEBHOOK_SECRET=whsec_…
```

## How the pieces fit

Three things happen, and each lives in one place. Your send route runs on the server with the API key and creates the document. Your sign page asks the server for a one-hour link and puts the signing form in an iframe through the embed component. Your webhook route is the only place that decides the document is signed: the `completed` event in the browser is a convenience for updating the screen, so do not unlock anything from it. Wait for the verified `documents.document.executed` event instead, because the browser can be closed, blocked or edited by the person using it.

## 3. Send a document

`app/api/send/route.js` turns a name and an email into a document whose signer signs in your page, so nobody is emailed:

```js
// app/api/send/route.js
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
// app/sign/page.js
import { Docustay } from "@docustay2026/sdk";
import Form from "./form";

export default async function Page({ searchParams }) {
  const { id } = await searchParams;
  const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
  const { url } = await docustay.embedSession(id, { seat: "signer_1", origin: "http://localhost:3000" });
  return <Form url={url} />;
}
```

A small client component shows the form and listens for the `completed` event:

```js
// app/sign/form.js
"use client";
import { useEffect, useRef, useState } from "react";

export default function Form({ url }) {
  const ref = useRef(null); const [done, setDone] = useState(false);
  useEffect(() => { import("@docustay2026/embed"); const el = ref.current; const onDone = () => setDone(true); el?.addEventListener("completed", onDone); return () => el?.removeEventListener("completed", onDone); }, []);
  return done ? <p>Signed. Thank you.</p> : <docustay-sign ref={ref} url={url} height="720" />;
}
```

## 5. Check the webhook

Docustay signs every webhook. Read the body as text and verify it before you trust it:

```js
// app/api/webhooks/route.js
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

Start the app (it stays running; Next.js adds `app/layout.js` the first time):

```bash
npx next dev
```

In a second terminal, send yourself a document:

```bash
curl -X POST localhost:3000/api/send -H 'content-type: application/json' -d '{"name":"Rosa Alvarez","email":"rosa@example.com"}'
```

Open `/sign?id=<the id it returns>`, sign, and watch your webhook route log `documents.document.executed`. When it works, swap in a live key.

## 7. If something does not work

- **The form does not appear.** The `origin` you passed to `embedSession` must be one of the addresses listed under Settings → Developers → Embedding, written exactly, including the port.
- **The link stops working.** An embedded link lasts one hour and is meant for one person. Ask the server for a new one each time the page loads rather than storing it.
- **The webhook says "bad signature".** Verify the raw text of the body, not parsed JSON, and use the secret that `npx docustay listen` printed or the one on the webhook in Developers. A test key and a live key have different webhooks.
- **Nothing arrives on your laptop.** Docustay cannot reach `localhost`. Keep `docustay listen` running in a second terminal while you try it.

## 8. Before you go live

Swap the test key for a live key in your hosting provider's settings, not in the repository. Add your real site address to the embedding list and remove `http://localhost:3000`. Point a live webhook at your public address and keep its secret in the same place as the key. Send one real document to yourself first, and read the signed copy and its audit trail before you send one to a customer.
