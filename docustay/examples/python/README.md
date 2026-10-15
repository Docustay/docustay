# Docustay + Python

Standard library plus the Docustay SDK (`pip install docustay`). Sends a document, shows the signing form in your page, checks webhooks.

```bash
DOCUSTAY_API_KEY=dsk_test_… DOCUSTAY_TEMPLATE_ID=<template id> DOCUSTAY_WEBHOOK_SECRET=whsec_… python app.py
curl -X POST localhost:3000/send -H 'content-type: application/json' -d '{"name":"Pat Example","email":"pat@example.com"}'
# open http://localhost:3000/sign/<the id it returns>
```

Use a test key while you try it. List `http://localhost:3000` in Settings → Developers → Embedding. For webhooks on your laptop: `npx docustay listen --forward-to http://localhost:3000/webhooks`.
