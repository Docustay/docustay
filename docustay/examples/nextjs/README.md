# Docustay + Next.js (App Router)

`POST /api/send` sends a template, `/sign?id=…` shows the signing form in the page, `POST /api/webhooks` checks signatures.

```bash
npm install
DOCUSTAY_API_KEY=dsk_test_… DOCUSTAY_TEMPLATE_ID=<template id> DOCUSTAY_WEBHOOK_SECRET=whsec_… npm run dev
```

Use a test key while you try it. List `http://localhost:3000` in Settings → Developers → Embedding.
