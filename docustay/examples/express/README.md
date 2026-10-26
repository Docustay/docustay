# Docustay + Express

Sends a document from a template, shows the signing form inside your own page (`<docustay-sign>`), and checks webhook signatures.

```bash
npm install
DOCUSTAY_API_KEY=dsk_test_… DOCUSTAY_TEMPLATE_ID=<template id> DOCUSTAY_WEBHOOK_SECRET=whsec_… npm start
curl -X POST localhost:3000/send -H 'content-type: application/json' -d '{"name":"Pat Example","email":"pat@example.com"}'
# open http://localhost:3000/sign/<the id it returns>
```

Use a test key (`dsk_test_…`) while you try it: nothing is billed or emailed. For webhooks on your laptop, run `npx docustay listen --forward-to http://localhost:3000/webhooks` and put the secret it prints in `DOCUSTAY_WEBHOOK_SECRET`.
For the form to be allowed in your page, list `http://localhost:3000` in Settings → Developers → Embedding.
