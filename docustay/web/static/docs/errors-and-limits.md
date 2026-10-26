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

The count is per workspace. On Free it is per calendar month in UTC and resets on the 1st. On Pay as you go, Pro and Lifetime it follows your billing month: it starts the day you subscribe (or buy Lifetime) and resets on the same day each month, the same window Stripe invoices. `GET /api/v1/usage` returns it as `periodStart` and `periodEnd`.

- **Free:** 15 documents a month. At the limit, sending is blocked with a `403` whose `error.detail.code` is `plan_document_limit` (with `used`, `limit` and `resetsAt`) and whose message says the plan allows 15 documents a month and to switch to Pay as you go or Pro. Free is never billed.
- **Pay as you go:** 15 documents each billing month are free, then $0.50 each, counted toward your budget. When the budget (default $50) is reached, sending is paused with a `403` and `error.detail.code` `budget_reached`; raise the budget in Billing to go on.
- **Pro and Lifetime:** no monthly document limit.

## Signer limits

A Free workspace can send to 15 different signers a month. A signer is anyone you send a document to, counted once a month by email address however many documents they get. Sending to your own team does not count, sending again to someone you already sent to this month never counts, and reminders and resends are free. At 12 you get a soft warning and at 14 a note that one is left; a 16th new person is refused with a `403` whose `error.detail.code` is `plan_signer_limit` (`used`, `limit`, `newSigners`, `resetsAt`). Everything already made keeps working. Pay as you go, Pro and Lifetime have no signer limit. This limit starts on 1 November 2026.

## Template limits

A Free workspace can make 5 new templates a month, however they are made: written, uploaded, customized from a built-in template, duplicated, described in words, made by Scribe or created through the API, SDKs, CLI or MCP. A new version of a template you already have does not count, and nor does sending straight from a built-in template (the built-in is read-only; only "Customize" makes your own copy, and that counts). Deleting a template does not give one back. The count is per calendar month in UTC and resets on the 1st.

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

- **Pay as you go:** 25 new templates a month from 1 November 2026, refused with the same `plan_template_limit` code (the prompt offers Pro, not a per-template charge).
- **Pro and Lifetime:** no template limit.
- **Self-hosted:** no template limit.

## Email limits

Each workspace can send 25 emails a day on Free and 500 a day on every paid plan. In a workspace's first 7 days the lines are lower (10 a day on Free, 100 a day on a paid plan), because a brand-new workspace that mails many people on day one is the usual shape of misuse; they go back to the plan's number on day 8. Signing requests, reminders and completed copies sent to signers count. Alerts to the workspace owner, sign-in emails and the usage warning emails do not count and are never blocked. A self-hosted install has no limit. The day is a UTC day and the count resets at midnight UTC. When the limit is reached the send is refused with a plain message.

Hosted email is sent by Docustay with your name and reply-to. A self-hosted install sends from its own domain or SMTP server: see [Email setup](/docs/email-setup).

## API limits

Each API key may make 600 requests per minute. Over that, the API answers `429` with a `Retry-After` header (in seconds). Three limits can answer `429`, and the message says which one: `rate limit exceeded for this API key` (the key's 600 a minute), `rate limit exceeded for <bucket>` (one kind of call, such as `documents` for field detection), and `too many requests from this address` (all callers from one IP address). Each answer carries its own wait in both `Retry-After` and `error.detail.retryAfterSeconds`, always the same number; two different `429`s can name different waits. Nothing is lost if you wait and retry. Retried `POST` requests with the same `Idempotency-Key` never send twice. There are no per-call or per-API-document fees on any plan.

## Fair use on Pro and Lifetime

Pro and Lifetime are unlimited for one organisation's own documents. A login belongs to one person. We look at, and may ask you about, a workspace with more than 50 team members or more than 2,000 documents sent in a month. On any plan we also look at a workspace that stores more than 10 GB. We contact you first and agree a plan; we do not pause or bill extra charges automatically for volume alone. Sending that draws spam complaints is different: the email guard pauses it (see the email section) and we look at it with you.

## Other plan rules and their errors

- **Using your own AI provider key** is part of Pay as you go, Pro and Lifetime. You save it in the app under **Settings → AI drafting** (the API has no route that takes a provider key). On Free, saving a key is refused with `own_key_needs_plan` (403).
- **Switching plans** from Billing credits the unused, already-paid time against the new plan when you move up; the confirm box shows the amount first. If the amount changed while you looked, the switch is refused with `switch_numbers_changed` (400) and the new amount is returned. A declined card is `switch_card_declined`; nothing is changed.
- **A lost dispute** on a plan payment pauses sending and AI drafting in that workspace: sends are refused with `workspace_on_hold` (403) until we lift it.
- **A spam-report pause** (the email guard) cannot be resumed from the app: `email_paused_for_spam` (403). Contact support.
- **Free workspaces** may be signed in on three devices at once; a fourth sign-in signs out the oldest.

## Usage and alerts

The Billing page shows documents sent this month, new templates made this month and emails sent today. We email the workspace owner once when 80% and once when 100% of the Free monthly document limit is used (the 12th and the 15th document). On Pay as you go the alerts come at 50%, 80% and 100% of your budget, and arrive as the `documents.usage.threshold` webhook too, and once a day when 80% and 100% of the daily email limit is used (Free: the 20th and the 25th email; paid plans: the 400th and the 500th).

`GET /api/v1/usage` returns the same numbers. It needs an API key with `documents:read`.

```bash
curl https://app.docustay.app/api/v1/usage -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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

`emails.limitPerDay` is the most this workspace may send **today**. For a workspace's first 7 days it is lower than the plan's `limits.emailsPerDay`: 10 a day on Free and 100 on a paid plan. After that the two are the same.

## Pagination

Lists take `limit` (1 to 200) and `cursor`. The answer carries `page.nextCursor` (null on the last page).

## Upload limits

Files uploaded for signing in the app are limited to 25 MB on Free and Pay as you go, and 100 MB on Pro and Lifetime.

Through the API most request bodies are limited to 1 MB (`413` above that); written documents and HTML templates take up to 3 MB. The two routes that take a file, `POST /api/v1/templates/file` and `POST /api/v1/documents/detect-fields`, take a file up to your plan's upload limit (sent as base64); a bigger file is refused with `400` and the code `too_big`.

## A retry loop that is safe

Always send the same `Idempotency-Key` on every retry of one logical request, and wait for `Retry-After` on a `429`:

```js
async function sendWithRetry(body) {
  const key = crypto.randomUUID();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const r = await fetch("https://docustay.app/api/v1/documents/send", {
      method: "POST", body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${process.env.DOCUSTAY_API_KEY}`, "Idempotency-Key": key, "Content-Type": "application/json" },
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

## Finding fields through the API

`POST /api/v1/documents/detect-fields` runs on our server and does not use an AI model, so it is not counted as an AI draft and costs nothing. To keep one workspace from using all of it, each workspace may make 30 calls an hour; past that the answer is a `429` with `Retry-After`.
