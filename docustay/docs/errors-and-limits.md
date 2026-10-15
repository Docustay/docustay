---
title: Errors, retries and limits
description: The error shape, idempotency, rate limits and upload limits.
order: 7
---

# Errors, retries and limits

## Errors

Every error is `{ "error": { "kind", "message", "requestId", "retryable" } }`. `kind` is one of `validation`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `unprocessable`, `rate_limited`, `dependency`, `timeout`, `internal`. Quote `requestId` when you ask for help.

| Status | Usually means |
|---|---|
| 400 | A field is not valid; `message` says which and why |
| 401 | The key is missing, wrong, revoked or lacks the scope (one answer for all four) |
| 403 | The workspace's plan or a setting does not allow this |
| 404 | No such document, template or seat |
| 409 | The request is fine but the state is wrong (for example, voiding a finished document) |
| 429 | Over the rate limit; wait the `Retry-After` seconds |
| 5xx | Our side; safe to retry with the same `Idempotency-Key` |

## Idempotency

Requests that create a document or a template (send a document, make a template from HTML, make a template from a file) need an `Idempotency-Key` header of 8 to 200 characters. Repeating a request with the same key and the same body returns the first answer instead of doing it again. Reusing a key with a different body is an error. Other requests, such as a reminder, a void or an embedded session, do not need one. The SDKs make a key for you and reuse it on every retry.

## Rate limits

Each key has its own per-minute budget; over it you get `429` with a `Retry-After` header. See [API limits](#api-limits). Sign-in, public signing, download and verification pages also have a per-address limit shared by every server of the install.

## What counts as a document

A document is a **sent** document. A package of several documents sent together counts once. Drafts, signers, reminders, resends and test-mode documents never count.

The count is per calendar month in UTC and resets on the 1st.

- **Free:** 15 documents a month. At the limit, sending is blocked with a `403` whose `error.detail.code` is `plan_document_limit` (with `used`, `limit` and `resetsAt`) and whose message says the plan allows 15 documents a month and to upgrade to Pro. Nothing is ever billed for going over: there are no overage bills.
- **Pro:** no monthly document limit.

## Template limits

A Free workspace can make 5 new templates a month, document and form templates together, however they are made: written, uploaded, customized from a built-in template, duplicated, described in words, made by Scribe or created through the API, SDKs, CLI or MCP. A new version of a template you already have does not count, and nor does sending straight from a built-in template (the built-in is read-only; only "Customize" makes your own copy, and that counts). Deleting a template does not give one back. The count is per calendar month in UTC and resets on the 1st.

- **Free:** 5 new templates a month. Every template you already have stays usable and editable. At the limit, making a new one is refused with a `403` whose `error.detail.code` is `plan_template_limit`:

```json
{
  "error": {
    "kind": "forbidden",
    "message": "Your Free plan includes 5 new templates a month and you have made 5. …",
    "requestId": "req_123",
    "retryable": false,
    "detail": { "code": "plan_template_limit", "used": 5, "limit": 5, "resetsAt": "2026-11-01T00:00:00Z" }
  }
}
```

- **Pro:** no template limit.
- **Self-hosted:** no template limit.

## Email limits

Each workspace can send 25 emails a day on Free and 500 a day on Pro. Signing requests, reminders and completed copies sent to signers count. Alerts to the workspace owner, sign-in emails and the usage warning emails do not count and are never blocked. A self-hosted install has no limit. The day is a UTC day and the count resets at midnight UTC. When the limit is reached the send is refused with a plain message.

If you send from your own connected mailbox or your own verified domain, the From address uses your provider's sending. That option is in **Settings → Email**; see [Email setup](/docs/email-setup.md).

## API limits

Each API key may make 600 requests per minute. Over that, the API answers `429` with a `Retry-After` header (in seconds). Nothing is lost if you wait and retry. Retried `POST` requests with the same `Idempotency-Key` never send twice. There are no per-call or per-API-document fees on any plan.

## Fair use on Pro

Pro is unlimited for one organisation's own documents. If your use becomes far above normal (many thousands of documents a month) we will contact you first and agree a plan. We do not bill extra charges automatically.

## Usage and alerts

The Billing and Reports pages show documents sent this month, new templates made this month and emails sent today. We email the workspace owner once when 80% and once when 100% of the Free monthly document limit is used (the 12th and the 15th document), and once a day when 80% and 100% of the daily email limit is used (Free: the 20th and the 25th email; Pro: the 400th and the 500th).

`GET /api/v1/usage` returns the same numbers. It needs an API key with `documents:read`.

```bash
curl https://app.docustay.app/api/v1/usage -H "Authorization: Bearer $DOCUSTAY_KEY"
```

```json
{
  "plan": "free",
  "period": { "start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z" },
  "documents": { "used": 4, "limit": 15 },
  "templates": { "used": 2, "limit": 5, "resetsAt": "2026-11-01T00:00:00Z" },
  "emails": { "usedToday": 6, "limitPerDay": 25, "resetsAt": "2026-10-07T00:00:00Z" }
}
```

## Pagination

Lists take `limit` (1 to 200) and `cursor`. The answer carries `page.nextCursor` (null on the last page).

## Upload limits

Files uploaded for signing in the app are limited to 25 MB on Free and 100 MB on Pro.

Through the API a request body is limited to 1 MB, whatever the plan. A file goes in the body as base64, so a file of about 700 KB is the most one request can carry; a bigger file is refused with `413`. Upload larger files in the app.

## A retry loop that is safe

Always send the same `Idempotency-Key` on every retry of one logical request, and wait for `Retry-After` on a `429`:

```js
async function sendWithRetry(body) {
  const key = crypto.randomUUID();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const r = await fetch("https://docustay.app/api/v1/documents/send", {
      method: "POST", body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${process.env.DOCUSTAY_KEY}`, "Idempotency-Key": key, "Content-Type": "application/json" },
    });
    if (r.status !== 429 && r.status < 500) return r;
    await new Promise((ok) => setTimeout(ok, (Number(r.headers.get("retry-after")) || 2 ** attempt) * 1000));
  }
  throw new Error("still failing after five tries");
}
```

## Reading an error

```json
{ "error": { "kind": "validation", "message": "Parties: signer_2 is not a seat on this template.", "requestId": "req_123", "retryable": false } }
```

`retryable: false` means sending the same thing again will fail the same way: fix the request. `retryable: true` means try again with the same key.
