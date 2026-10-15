---
title: E-signature REST API
description: POST /api/v1/documents/send with a template and a party. Bearer keys, scopes, Idempotency-Key on every create, typed errors and a 600 a minute limit per key.
---

# REST API

POST a template and a party; read back the state. Bearer keys with scopes, an Idempotency-Key on every create.

## The parts you use.

**Auth.** Authorization: Bearer <key>. Thirteen scopes you tick per key, from documents:read and documents:write to one-job scopes such as reports:read. A missing scope answers like a wrong key.

**Idempotency.** Creates take an Idempotency-Key of 8 to 200 characters. The same key and body returns the first answer.

**Errors.** { error: { kind, message, requestId, retryable } }. Kinds: invalid, unauthenticated, forbidden, not_found, conflict, rate_limited, dependency, timeout.

## What you will call first.

- **POST**: /api/v1/documents/send
- **POST**: /api/v1/documents
- **POST**: /api/v1/documents/{id}/embed-session
- **POST**: /api/v1/plays

- **GET**: /api/v1/documents?state=executed
- **GET**: /api/v1/documents/{id}
- **GET**: /api/v1/documents/{id}/signed.pdf
- **GET**: /api/v1/usage

## The same send in three languages.

```
import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
});
console.log(doc.id, doc.state);
```

- **Rate**: 600 requests a minute per key; 429 with Retry-After
- **Fees**: No per-call or per-API-document fee on any plan
- **Retries**: Safe with the same Idempotency-Key

## Make a document from text you wrote.

A document is words plus people. Roles are words from the text, never seat numbers. It stays a draft until you send it.

```
curl -X POST https://app.docustay.app/api/v1/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{
    "title": "Retainer agreement",
    "source": { "type": "doc", "content": [
      { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Retainer agreement" }] },
      { "type": "paragraph", "content": [{ "type": "fieldTag", "attrs": { "name": "Client signature", "type": "signature", "role": "Client" } }] }
    ] },
    "people": [{ "name": "Dana Whitfield", "email": "dana@example.com", "role": "Client" }]
  }'
```

## Questions

**Does a response contain a signing link?**

No. No response contains a signing link or an access code. A key cannot sign for anyone.

**Can I page through lists?**

Yes. The SDKs page for you with eachDocument and each_document.

**Is there a spec file?**

Yes. OpenAPI 3.1 at /api/openapi.json and a Postman collection at /api/docustay.postman_collection.json.


## Keep reading

- [Webhooks](/developers/webhooks)
- [Keys and security](/developers/keys-and-security)
- [SDKs](/developers/sdks)
