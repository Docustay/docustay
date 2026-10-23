---
title: E-signature REST API
description: POST /api/v1/documents/send with a template and a party. Bearer keys, scopes, Idempotency-Key on every create, typed errors and a 600 a minute limit per key.
---

# REST API

POST a template and a party; read back the state. Bearer keys with scopes, an Idempotency-Key on every create.

## The parts you use.

**Auth.** Authorization: Bearer <key>. Twelve scopes you tick per key, from documents:read and documents:write to one-job scopes such as templates:read. A missing scope answers like a wrong key.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{
    "title": "Retainer agreement",
    "source": { "type": "doc", "content": [
      { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Retainer agreement" }] },
      { "type": "paragraph", "content": [{ "type": "fieldTag", "attrs": { "name": "Client signature", "type": "signature", "role": "Client" } }] }
    ] },
    "people": [{ "name": "Dana Whitfield", "email": "dana@example.com", "role": "Client" }]
  }'
```

## Seven statuses, one error shape.

| Status | Usually means |
| --- | --- |
| 400 | A field is not valid; the message says which and why |
| 401 | The key is missing, wrong, revoked or lacks the scope (one answer for all four) |
| 403 | The workspace's plan or a setting does not allow this |
| 404 | No such document, template or seat |
| 409 | The request is fine but the state is wrong, such as voiding a finished document |
| 429 | Over the rate limit; wait the Retry-After seconds |
| 5xx | Our side; safe to retry with the same Idempotency-Key |

Every error is { error: { kind, message, requestId, retryable } }. Quote the requestId when you ask for help.

## Read your usage from code.

**Same numbers.** The billing page reads the same figures.

**Scope.** A key with documents:read.

## Know what an action will cost before you do it.

**Reads only.** Nothing is sent, charged or stored. The answer carries the same reason code the real action would fail with.

**Scope.** A key with documents:read.

## What happens between your request and the email.

| Topic | Detail |
| --- | --- |
| The key | The Authorization: Bearer header names the key; the key decides the workspace and the scopes. A missing scope answers exactly like a wrong key. |
| The retry guard | The Idempotency-Key header (8 to 200 characters) makes the create safe to repeat: the same key and body returns the first answer instead of sending twice. |
| The seats | templateId is the template's uuid, and each seat in parties is one of its seat keys. Seats appear in the order roles first appear in the document: signer_1, then signer_2. |
| The answer | 201 with the document id and state sent, plus emailed and notEmailed, so you know whether each person was emailed. |
| After the send | Everything after that is a GET on the document, or a webhook that tells you without asking. |
| The count | A sent document counts once; drafts, reminders, resends and test-mode documents never count. There are no per-call fees on any plan. |

## From sent to a sealed copy.

state moves sent, then partially_signed, then executed (or declined, expired, void). The sealed PDF is made a few seconds after the last signature.

```
curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## Find a document again, by your own id.

| Parameter | What it does |
| --- | --- |
| limit and cursor | limit is 1 to 200; the answer carries page.nextCursor, which is null on the last page |
| state | Only documents in one state, such as executed |
| externalId | Your own id for the document, set when you sent it |
| metadata[key]=value | Up to 20 short key and value pairs you attached; both come back in webhooks |

The SDKs follow the cursor for you with eachDocument and each_document.

## What every answer carries.

| Where | What |
| --- | --- |
| RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset | On every answer, in seconds for the reset; over the budget you get 429 with Retry-After |
| Docustay-Version | A date on every answer. A change that could break a caller gets a new date and is announced in the changelog first; additions do not change it |
| 403 with error.detail.code | plan_document_limit or plan_template_limit, with used, limit and resetsAt (the first of next month, UTC). Everything already made keeps working |
| Request body size | 1 MB through the API. A file goes in as base64, so about 700 KB is the most one request can carry; a bigger one is refused with 413 |
| Rate limit | 600 requests a minute per key. Retried POSTs with the same Idempotency-Key never send twice |

The OpenAPI 3.1 file at /api/openapi.json describes every operation.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Get told, do not ask | Seven signed events instead of polling, with replay from the delivery log. | Webhooks: /developers/webhooks |
| Choose your scopes | Make one key per integration and tick only what it needs. | Keys and security: /developers/keys-and-security |
| Practise safely | A test key emails only you and counts for nothing. | Test mode: /developers/test-mode |

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
