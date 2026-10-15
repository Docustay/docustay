---
name: docustay-embed-signing
description: Use when the user wants to show a Docustay signing form inside their own website or app (the <docustay-sign> element, React, Vue, Angular).
---

# Embedded signing

1. In Docustay: Settings → Documents → Embedding, list each website that will show the form, for example `https://app.example.com` (`http://localhost:3000` is allowed while developing).
2. On the customer's SERVER (never in a browser; the API key must not leave the server): send with `embedded: ["signer_1"]` (the seats that sign inside the app; nobody is emailed for them), then `POST /api/v1/documents/{id}/embed-session` with `{ seat, origin }`. The answer is `{ url, expiresAt }`; the link works for one hour. Ask again for a fresh one whenever the page loads.
3. In the page: `import "@docustay2026/embed"` and `<docustay-sign url="…" height="720"></docustay-sign>`, or `DocustaySign` from `@docustay2026/react`, `@docustay2026/vue`, or `DocustaySignComponent` from `@docustay2026/angular`.
4. Listen for `ready`, `completed`, `declined`, `error`, `resize` (each has `documentId`). `completed` means the signer finished.

Rules that matter: only seats sent as embedded can get a session; only listed websites can; the form refuses to be framed by anything else; events go only to the listed parent. Do not tell the user to trust a `completed` event for anything that matters: confirm with `GET /api/v1/documents/{id}` on the server (`state: executed`).
