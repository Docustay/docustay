
# API reference

Generated from the OpenAPI 3.1 document at `/api/openapi.json`; do not edit by hand.

Send documents for signature and follow them, from your own software.

**Authentication.** Send `Authorization: Bearer <key>`. Make keys in Settings → Developers → API keys and give each only the scopes it needs (there are 35 in all): `accounts:read`, `accounts:write`, `booking:read`, `booking:write`, `documents:read`, `documents:write`, `growth:read`, `growth:write`, `items:read`, `items:write`, `lead:write`, `money:read`, `money:write`, `network:read`, `network:write`, `notifications:read`, `notifications:write`, `people:read`, `people:write`, `platform:read`, `platform:write`, `records:read`, `records:write`, `settings:read`, `settings:write`, `plays:read`, `plays:write`, `drafts:write`, `templates:read`, `templates:write`, `webhooks:read`, `webhooks:write`, `reports:read`, `account:read`, `embedded:write`. A key that starts `dsk_test_` works in **test mode**: documents it sends are practice runs (emailed only to the sender, stamped TEST, never counted or billed), it can only see and act on test documents (any other document answers `404`), and it can sign them itself with `POST /api/v1/documents/{id}/test-sign`. A key can also be limited to a list of addresses, given an expiry, or made **draft-only**.

**Draft-only keys.** A draft-only key can make and edit drafts but cannot send. Asking it to send answers `202` with an `approval`, the document stays a draft, and a person approves or declines in Settings → Developers → Approvals. Keys can also have a daily limit of drafts and sends; past it you get `429`.

**Payments.** A template may contain payment fields (text tag `type=payment` with one of `amount`, `formula`, `price` or `link`). The signer pays on Stripe's hosted page; the money goes to your own connected Stripe account; Docustay's fee is 2% on the Free plan and 0% on Pro, plus Stripe's own fees. The document's `payments` list shows each payment, its receipt and the fee. Card details never reach Docustay.

**Idempotency.** Requests that create a document or a template, or send one, need an `Idempotency-Key` header (8–200 characters). Repeating a request with the same key and body returns the first answer instead of doing it twice.

**Your own reference.** Documents and templates take `externalId` (your id for it) and `metadata` (up to 20 short key/value pairs). List with `externalId=` or `metadata[key]=value` to find them again, and both come back in webhooks.

**Errors.** Every error is `{ "error": { "kind", "message", "requestId", "retryable" } }`. `kind` is one of `invalid`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `dependency`, `timeout`. Quote the `requestId` to support, or search it in Settings → Developers → API log. **Plan limits** are `403 forbidden` with `error.detail.code`: `plan_document_limit` (the plan's documents this month are used; a form counts the first time it is published, and every signed response counts) or `plan_template_limit` (Free: 5 new templates a month, documents and forms together; a new version of a template you have does not count). Both carry `detail.used`, `detail.limit` and `detail.resetsAt` (the first of next month, UTC). Everything already made keeps working. Pro and self-hosted installs have no template limit.

**Rate limits.** Each key has its own per-minute budget. Every answer carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds); over the budget you get `429` with a `Retry-After` header.

**Versions.** Every answer carries `Docustay-Version`, a date. A change that could break a caller gets a new date and is announced in the changelog before it ships; additions (a new field, a new route) are not breaking and do not change the date.

**Pagination.** Lists take `limit` (1–200) and `cursor`; the answer carries `page.nextCursor` (null on the last page).

**Signing links.** No response contains a signing link or access code, with one exception you control: a seat you send in `embedded` can be given an embedded signing session (`POST /api/v1/documents/{id}/embed-session`), a one-hour link for a frame on a website you listed. A key can start and follow a signature, and put your own signer in front of the form for seats you marked yourself; it cannot sign for anyone.

## GET /api/v1/documents/templates

**Templates you can send**

Answers:

- `200` Approved, current templates.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/templates \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/documents

**List documents**

Filter by your own reference: `externalId=…`, and `metadata[key]=value` (repeat for more keys; a document must match all).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `state` | query | no | string |
| `limit` | query | no | integer |
| `cursor` | query | no | string |
| `externalId` | query | no | Only documents with this `externalId`. |

Answers:

- `200` A page of documents, newest first.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/documents

**Make a document from words and people**

People first: each person has a name, an email and (optionally) a role word from the text. The document is left as a **draft** unless `sendNow` is true. Needs an `Idempotency-Key`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | object | no | Your own wording for the emails about THIS document. The workspace's saved wording (Settings → Email templates) applies underneath; what you give here wins. |
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `title` | string | yes |  |
| `source` | object | yes | A written document: TipTap JSON `{type:"doc",content:[…]}`. Field tags (`fieldTag` with name, type, role, required, autofill, editable, placeholder, tooltip, locked, options, default…), merge chips (`variableChip`; `custom.<key>` chips are the template's questions), and headings with `audience: "sender"` (Sender only: in nothing a signer sees, signs or receives). |
| `people` | array of object | yes |  |
| `facts` | object | no | Merge text: `org.name`, `sender.name`, `custom.<key>` … |
| `variableValues` | object | no |  |
| `paper` | `letter` · `a4` | no |  |
| `send` | object | no |  |
| `description` | string | no |  |
| `sendNow` | boolean | no | Also send it. The same checks as the screen's Send apply (a payment field needs Stripe connected). |

Answers:

- `201` The document.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"email":{"subject":"Example","message":"Example","replyTo":"jo@example.com","senderName":"string","locale":"string"},"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","title":"Example","source":"string","people":[{"externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"},"name":"Example","email":"jo@example.com","role":"Signer","action":"signer","order":0}],"facts":"string","variableValues":"string","paper":"letter","send":{"replyTo":"jo@example.com","senderName":"string","subject":"Example","message":"Example","expiryDays":"string","reminderDays":[0],"signingOrder":"any","language":"en","internalNote":"string","requireDeclineReason":false},"description":"string","sendNow":false}'
```

## GET /api/v1/documents/{id}

**One document and where each person is**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The document.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such document.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/documents/{id}/signed.pdf

**Download the signed copy**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The sealed PDF, with its certificate.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not signed yet, or no such document.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID/signed.pdf \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/documents/send

**Send a template to people to sign**

Makes a document from the template, puts each person on their seat and sends it. Needs an `Idempotency-Key` header (8–200 characters): a retry with the same key and body does not send again.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `templateId` | string | yes |  |
| `email` | object | no | Your own wording for the emails about THIS document. The workspace's saved wording (Settings → Email templates) applies underneath; what you give here wins. |
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `title` | string | no |  |
| `message` | string or null | no |  |
| `subject` | string | no |  |
| `language` | `en` · `es` · `fr` · `de` · `pt` · `it` · `nl` · `pl` · `tr` · `ru` · `ar` · `ja` · `zh` · `ko` | no |  |
| `expiryDays` | integer | no |  |
| `embedded` | array of string | no | Seats signed inside your own app instead of by emailed link (for example ["signer_1"]). Nobody is emailed for these seats: you ask for a session with POST /api/v1/documents/{id}/embed-session and show it on a website you listed under Settings → Developers → Embedding. |
| `parties` | array of object | yes | One entry for each seat of the template (see GET /api/v1/documents/templates). |

Answers:

- `201` Sent.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e","email":{"subject":"Example","message":"Example","replyTo":"jo@example.com","senderName":"string","locale":"string"},"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","title":"Example","message":"Example","subject":"Example","language":"en","expiryDays":0,"embedded":["string"],"parties":[{"seat":"signer_1","name":"Example","email":"jo@example.com","externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"}}]}'
```

## POST /api/v1/templates/html

**Make a template from HTML with text tags**

Prints your HTML to a PDF and places a field wherever a text tag sits, then keeps the result as a template you can send with `POST /api/v1/documents/send`. Needs an `Idempotency-Key` header.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `name` | string | yes |  |
| `html` | string | yes | HTML with text tags such as {{Tenant signature;type=signature;role=Tenant}}. Scripts, styles, frames, forms and remote addresses are removed; pictures must be data: addresses. Up to 2 MB. |
| `paper` | `letter` · `a4` | no |  |

Answers:

- `201` The template.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/html \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","name":"Example","html":"string","paper":"letter"}'
```

## POST /api/v1/templates/file

**Make a template from a file with text tags**

Reads a PDF file, places a field wherever a text tag is written in it, and keeps the result as a template. Needs an `Idempotency-Key` header.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `name` | string | yes |  |
| `fileName` | string | yes |  |
| `file` | string | yes | The file, base64-encoded: a PDF file with text tags written in it. |
| `fields` | `tags` · `auto` | no | `tags` (default) places fields only where a text tag is written. `auto` also looks at the page itself — lines, boxes, tick boxes, highlighted bars and the words beside them — and places the fields it is confident about, with the people grouped into seats. |
| `minConfidence` | number | no | With `fields: auto`: the least sure a field may be and still be placed (default 0.6). |

Answers:

- `201` The template.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/file \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","name":"Example","fileName":"string","file":"string","fields":"tags","minConfidence":0}'
```

## POST /api/v1/templates/source

**Make a template from a document source**

Keeps a document written in the shared editor's format as a template (profile `typeset` by default). Needs an `Idempotency-Key` header.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `name` | string | yes |  |
| `source` | object | yes | The document source: a ProseMirror/TipTap JSON document (`{type:"doc",content:[…]}`) using headings, paragraphs, lists, tables, `fieldTag`, `signatureBlock`, `variableChip`. See the guide on document sources. |
| `profile` | `typeset` · `contract` | no |  |
| `paper` | `letter` · `a4` | no |  |

Answers:

- `201` The template.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/source \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","name":"Example","source":"string","profile":"typeset","paper":"letter"}'
```

## POST /api/v1/documents/ai/draft

**Ask for an AI-written draft**

Starts a draft and answers at once with a job id; poll `GET /api/v1/documents/ai/jobs/{id}`. The draft is a suggestion for a person to read; nothing is saved or sent. Refused plainly when AI drafting is switched off for the workspace or a limit is reached.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | no |  |
| `brief` | object | no | The wizard's answers (see GET /api/v1/ai/wizard for the questions). |
| `mode` | `template` · `document` | no |  |

Answers:

- `202` Started.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/ai/draft \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"string","brief":{"type":"string","kind":"string","answers":"string","final":"string","payment":{"collect":true,"amount":"1500","currency":"usd","payer_role":"string","description":"string","schedule_note":"string"}},"mode":"template"}'
```

## GET /api/v1/documents/ai/jobs/{id}

**Read an AI draft job**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The job. When `state` is `done`, `source` is the draft and `patches.notes` lists what to check.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such job.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/ai/jobs/JOB_ID \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/usage

**Documents, templates and emails used against your plan**

Documents sent this calendar month (UTC), new templates made this month and emails sent today, with the plan's limits. `limit` is null when the plan has no limit (Pro has no template limit; a self-hosted install has no limits).

Answers:

- `200` Usage.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/usage \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/documents/detect-fields

**Find the fields on a PDF**

Looks at a PDF and returns the signature, initials, date, text and tick-box fields a person would place, with the page, the box (fractions of the page, origin top left), how sure it is, where it came from and which signer it belongs to. Stores nothing and sends nothing; pass the result on when you create a template or a document, or ask for `fields: "auto"` when you upload one. Free for everyone.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `fileName` | string | no |  |
| `file` | string | yes | The file, base64-encoded: a PDF file. |
| `minConfidence` | number | no |  |
| `ocr` | boolean | no | Read pages that are only a picture by character recognition (default true; English). |

Answers:

- `200` The fields found.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/detect-fields \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"string","file":"string","minConfidence":0,"ocr":false}'
```

## GET /api/v1/ai/usage

**AI credits used against your plan**

The AI allowance for the current period: credits included, used and remaining, when it resets, and the split by kind of work. `mode` is `own_key` (you bring your own provider key, so nothing is metered) or `unmetered` (self-hosted).

Answers:

- `200` AI usage.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/ai/usage \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/templates/library

**List the built-in templates**

The built-in Document templates (`kind=document`) and Form templates (`kind=form`): title, summary, seats, field counts and the questions its guidance asks. `templateId` is your workspace's copy once it has been used. Empty when the workspace hides the library.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `kind` | query | no | `document` · `form` |

Answers:

- `200` List the built-in templates
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (for a customized copy: the plan's monthly new-template limit).
- `404` No such built-in template.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/templates/library \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/templates/library/{slug}

**One built-in template**

The template's fields (who fills each one) and its guidance: the questions, the facts it needs, the checklist and when not to use it.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `slug` | path | yes | string |

Answers:

- `200` One built-in template
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (for a customized copy: the plan's monthly new-template limit).
- `404` No such built-in template.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/templates/library/LIBRARY_SLUG \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/templates/library/{slug}/documents

**Make a draft from a built-in template**

A new draft made straight from the built-in (nothing is copied into your templates, so it does not count toward the monthly new-template limit). Add the people and send it as any draft; it counts toward the month's documents when it is sent.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `slug` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | no |  |

Answers:

- `201` Make a draft from a built-in template
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (for a customized copy: the plan's monthly new-template limit).
- `404` No such built-in template.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/library/LIBRARY_SLUG/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"title":"Example"}'
```

## POST /api/v1/templates/library/{slug}/customize

**Customize a built-in template**

Your own editable copy of the built-in, as a new template. It counts toward the Free plan's monthly new-template limit.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `slug` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | no |  |

Answers:

- `201` Customize a built-in template
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (for a customized copy: the plan's monthly new-template limit).
- `404` No such built-in template.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/library/LIBRARY_SLUG/customize \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"name":"Example"}'
```

## GET /api/v1/templates/{id}

**One template and its seats**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The template.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such template.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/templates/TEMPLATE_ID \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/documents/{id}/audit-log.csv

**The document's audit log as CSV**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` One row per event: time (UTC), event, description, person, document, detail.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such document.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID/audit-log.csv \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/documents/{id}/remind

**Remind the people who still have to sign**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `seat` | string | no | Remind only this seat (for example signer_2). Leave out to remind everyone who is up. |

Answers:

- `200` Reminded.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `409` Nobody is waiting to be reminded.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/remind \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"seat":"signer_1"}'
```

## POST /api/v1/documents/{id}/embed-session

**Start an embedded signing session for a seat**

For a seat that was sent in `embedded`. Returns a link that works for one hour and is meant for an iframe or the `<docustay-sign>` element on one of your allowed websites. It is the only way a key can put someone in front of a signing form, and only for seats you marked embedded yourself. Needs an `Idempotency-Key` header.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `seat` | string | yes |  |
| `origin` | string | yes | The website that will show the form; must be on your allowed list. |

Answers:

- `200` The session.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `409` The seat was not sent as embedded, it is not their turn, the website is not allowed, or embedding is off.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/embed-session \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"seat":"signer_1","origin":"https://app.example.com"}'
```

## GET /api/v1/reports

**Counts of what was sent and completed**

Real documents only — documents made in test mode are never counted. Dates are in the workspace's own time zone; `to` is inclusive; the default window is the last 30 days.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `from` | query | no | string |
| `to` | query | no | string |
| `team` | query | no | string |

Answers:

- `200` The report.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/reports \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/teams

**Teams and their members**

Answers:

- `200` The teams.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/teams \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/email-templates

**The workspace's email wording**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `locale` | query | no | string |

Answers:

- `200` The eight message types with the standard and the saved wording.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/email-templates \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## PUT /api/v1/email-templates/{kind}

**Set the wording of one email**

Variables look like `{{document.title}}`; each message type accepts only its own (see GET). A blank field means the standard wording.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `kind` | path | yes | invitation, reminder, completed, declined, voided, expired, code or receipt |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `locale` | string | no |  |
| `subject` | string or null | no |  |
| `preview` | string or null | no |  |
| `body` | string or null | no |  |
| `buttonLabel` | string or null | no |  |
| `footer` | string or null | no |  |

Answers:

- `200` The saved wording.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X PUT https://app.docustay.app/api/v1/email-templates/EMAIL_TEMPLATE_KIND \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"locale":"string","subject":"Example","preview":"string","body":"string","buttonLabel":"string","footer":"string"}'
```

## DELETE /api/v1/email-templates/{kind}

**Back to the standard wording**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `kind` | path | yes | invitation, reminder, completed, declined, voided, expired, code or receipt |
| `locale` | query | no | string |

Answers:

- `200` The standard wording again.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X DELETE https://app.docustay.app/api/v1/email-templates/EMAIL_TEMPLATE_KIND \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/email-templates/{kind}/preview

**Preview an email with made-up names**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `kind` | path | yes | invitation, reminder, completed, declined, voided, expired, code or receipt |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `locale` | string | no |  |
| `subject` | string or null | no |  |
| `preview` | string or null | no |  |
| `body` | string or null | no |  |
| `buttonLabel` | string or null | no |  |
| `footer` | string or null | no |  |

Answers:

- `200` Subject, preview line, body and the HTML.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/email-templates/EMAIL_TEMPLATE_KIND/preview \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"locale":"string","subject":"Example","preview":"string","body":"string","buttonLabel":"string","footer":"string"}'
```

## GET /api/v1/emails

**The log of email about your documents**

Every email sent about a document, to a person named on it: kind, subject, status (sent, delivered, bounced, complained, failed, paused). Filter by `documentId`, `to`, `status`, `kind`. No bodies, no links.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `documentId` | query | no | string |
| `to` | query | no | string |
| `status` | query | no | string |
| `kind` | query | no | string |
| `limit` | query | no | integer |
| `cursor` | query | no | string |

Answers:

- `200` A page of emails, newest first.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/emails \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/documents/{id}/test-sign

**Sign a test document (test mode only)**

Signs one seat of a **test** document with sample answers, through the same code a person's signature uses: consent, signing order, the audit trail and your webhooks all happen. Only a test key (`dsk_test_…`) may call it, and only on a test document; a live key gets `403`. A seat with a payment field cannot be test-signed: pay it with a Stripe test card.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `seat` | string | yes | The seat to sign, for example `signer_1`. |

Answers:

- `200` Signed.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/test-sign \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"seat":"signer_1"}'
```

## POST /api/v1/documents/{id}/void

**Void a document that is still out for signature**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | no |  |

Answers:

- `200` Voided.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/void \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Example"}'
```

## POST /api/v1/documents/check

**Check a document's words before making it**

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | object | yes | A written document: TipTap JSON `{type:"doc",content:[…]}`. Field tags (`fieldTag` with name, type, role, required, autofill, editable, placeholder, tooltip, locked, options, default…), merge chips (`variableChip`; `custom.<key>` chips are the template's questions), and headings with `audience: "sender"` (Sender only: in nothing a signer sees, signs or receives). |
| `facts` | object | no |  |
| `people` | array of object | no | With people, each person's own merge text is known, as when the document is made. |
| `variableValues` | object | no |  |
| `requireSignature` | boolean | no |  |
| `forTemplate` | boolean | no |  |

Answers:

- `200` What a person would be told.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/check \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":"string","facts":"string","people":[{"externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"},"name":"Example","email":"jo@example.com","role":"Signer","action":"signer","order":0}],"variableValues":"string","requireSignature":false,"forTemplate":false}'
```

## GET /api/v1/documents/{id}/source

**The words, people and choices of a draft**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The draft's source.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID/source \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/documents/{id}/revise

**Change the words of a draft**

A draft is never edited in place: the new words are printed into a NEW draft that takes the people and choices, and the old draft is deleted. **The id changes** (use `id` in the answer). Needs an `Idempotency-Key`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | object | yes | A written document: TipTap JSON `{type:"doc",content:[…]}`. Field tags (`fieldTag` with name, type, role, required, autofill, editable, placeholder, tooltip, locked, options, default…), merge chips (`variableChip`; `custom.<key>` chips are the template's questions), and headings with `audience: "sender"` (Sender only: in nothing a signer sees, signs or receives). |
| `facts` | object | no |  |
| `variableValues` | object | no |  |
| `roleMap` | object | no | Old role word → new role word when you renamed a role. |

Answers:

- `201` The new draft.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/revise \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":"string","facts":"string","variableValues":"string","roleMap":"string"}'
```

## POST /api/v1/documents/{id}/send

**Send a draft**

Sends a draft made with `POST /api/v1/documents`. The same checks as the screen's Send; a payment field needs Stripe connected. Needs an `Idempotency-Key`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Answers:

- `201` Sent.
- `202` A draft-only key: the request waits for a person to approve it in the app. The document is still a draft.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/send \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```

## POST /api/v1/templates/{id}/documents

**Use a written template for people**

Makes a document from a template made with `POST /api/v1/templates/source`: the people, the template's questions answered in `variableValues` (see `GET /api/v1/templates/{id}`), the template's own defaults first. A draft unless `sendNow`. Needs an `Idempotency-Key`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | object | no | Your own wording for the emails about THIS document. The workspace's saved wording (Settings → Email templates) applies underneath; what you give here wins. |
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `title` | string | no |  |
| `people` | array of object | yes |  |
| `variableValues` | object | no |  |
| `facts` | object | no |  |
| `send` | object | no |  |
| `sendNow` | boolean | no |  |

Answers:

- `201` The document.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/TEMPLATE_ID/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"email":{"subject":"Example","message":"Example","replyTo":"jo@example.com","senderName":"string","locale":"string"},"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","title":"Example","people":[{"externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"},"name":"Example","email":"jo@example.com","role":"Signer","action":"signer","order":0}],"variableValues":"string","facts":"string","send":{"replyTo":"jo@example.com","senderName":"string","subject":"Example","message":"Example","expiryDays":"string","reminderDays":[0],"signingOrder":"any","language":"en","internalNote":"string","requireDeclineReason":false},"sendNow":false}'
```

## POST /api/v1/templates/{id}/defaults

**Set what a document made from a template starts with**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | string or null | no |  |
| `clientDescription` | string or null | no |  |
| `message` | string or null | no |  |
| `send` | object | no |  |

Answers:

- `200` Saved.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/templates/TEMPLATE_ID/defaults \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"description":"string","clientDescription":"string","message":"Example","send":{"replyTo":"jo@example.com","senderName":"string","subject":"Example","message":"Example","expiryDays":"string","reminderDays":[0],"signingOrder":"any","language":"en","internalNote":"string","requireDeclineReason":false}}'
```

## POST /api/v1/documents/ai/edit

**Ask the assistant to change a document**

Starts an edit job and answers at once; poll `GET /api/v1/documents/ai/jobs/{id}`. The answer is a list of **proposed changes** (`patches.applied`); nothing is changed until you apply the ones you accept with your own copy of the source. If you pass the template's questions in `variables`, `patches.values` carries proposed answers.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `request` | string | yes |  |
| `source` | object | yes | A written document: TipTap JSON `{type:"doc",content:[…]}`. Field tags (`fieldTag` with name, type, role, required, autofill, editable, placeholder, tooltip, locked, options, default…), merge chips (`variableChip`; `custom.<key>` chips are the template's questions), and headings with `audience: "sender"` (Sender only: in nothing a signer sees, signs or receives). |
| `mode` | `template` · `document` | no |  |
| `variables` | array of object | no |  |

Answers:

- `202` Started.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/ai/edit \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"request":"string","source":"string","mode":"template","variables":[{"key":"string","label":"string","kind":"text"}]}'
```

## POST /api/v1/documents/ai/jobs/{id}/cancel

**Cancel an AI job**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The job.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/ai/jobs/JOB_ID/cancel \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```

## GET /api/v1/ai/wizard

**The wizard's questions**

The questions the screen's Describe wizard asks, so an integration asks the same ones and sends the answers as `brief` to `POST /api/v1/documents/ai/draft`. Includes the payment questions and the currencies offered.

Answers:

- `200` The questions.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/ai/wizard \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/payments/status

**Is Stripe ready to take a payment?**

`connected` (details submitted, charges on, nothing due), `needs_attention` (Stripe still needs information) or `not_connected`. A document with a payment field can only be sent when this says `connected`.

Answers:

- `200` The status.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/payments/status \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/plays

**List plays**

The built-in plays and your published ones: name, one-line description, kind and category.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `kind` | query | no | string |
| `category` | query | no | string |

Answers:

- `200` List plays
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/plays \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/plays

**Save a play (a new version)**

`source` is the play file: Markdown with a block of YAML at the top. Every save is a new immutable version; publish it to use it. Data only: a play cannot add tools, run code, send or take payments.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | yes |  |

Answers:

- `201` Save a play (a new version)
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/plays \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":"string"}'
```

## GET /api/v1/plays/{name}

**One play**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `name` | path | yes | string |

Answers:

- `200` One play
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/plays/PLAY_NAME \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## DELETE /api/v1/plays/{name}

**Archive a play**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `name` | path | yes | string |

Answers:

- `200` Archive a play
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X DELETE https://app.docustay.app/api/v1/plays/PLAY_NAME \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/plays/test

**Check a play without saving it**

A dry run: parses the play file, reports every problem, and shows what the picker and the interview would use. Creates nothing.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | yes |  |

Answers:

- `200` Check a play without saving it
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/plays/test \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":"string"}'
```

## POST /api/v1/plays/{name}/publish

**Publish a play version**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `name` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | integer | no |  |

Answers:

- `200` Publish a play version
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/plays/PLAY_NAME/publish \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"version":0}'
```

## POST /api/v1/plays/{name}/duplicate

**Copy a play under a new name**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `name` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `as` | string | no |  |

Answers:

- `201` Copy a play under a new name
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/plays/PLAY_NAME/duplicate \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"as":"string"}'
```

## GET /api/v1/playbooks

**List playbooks (packs)**

Packs: named bundles of skills and templates for one job. The built-in packs first, then your own; `enabled` says whether it is switched on.

Answers:

- `200` List playbooks (packs)
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/playbooks \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/playbooks

**Save a playbook (pack)**

A pack holds at least one skill or template: up to 12 skills and 24 templates.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes |  |
| `title` | string | yes |  |
| `description` | string | no |  |
| `plays` | array of string | no |  |
| `templates` | array of string | no | `builtin:<slug>` for a library template, or one of your templates' family ids. |

Answers:

- `201` Save a playbook (pack)
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/playbooks \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"name":"Example","title":"Example","description":"string","plays":["string"],"templates":["string"]}'
```

## POST /api/v1/playbooks/{name}/enable

**Switch a pack on or off**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `name` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `enabled` | boolean | yes |  |

Answers:

- `200` Switch a pack on or off
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/playbooks/PLAYBOOK_NAME/enable \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

## POST /api/v1/drafts

**Start a draft from a template**

Starts from a built-in Document template and asks its own questions: `status: needs_input` with up to 4 questions (each with 2 to 4 options and a `draftRef`) until the must-ask ones are answered, then `status: draft` with the new draft's id. Nothing is ever sent: a draft is a draft. Answer with `POST /api/v1/drafts/{draftRef}/answers`.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `template` | string | yes | A library template's slug (see `GET /api/v1/templates/library`). |
| `title` | string | no |  |
| `people` | array of object | yes |  |
| `answers` | object | no |  |
| `useDefaults` | boolean | no |  |

Answers:

- `200` Start a draft from a template
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/drafts \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"template":"string","title":"Example","people":[{"name":"Example","email":"jo@example.com","role":"Signer","action":"signer"}],"answers":"string","useDefaults":false}'
```

## POST /api/v1/drafts/{draftRef}/answers

**Answer a template's questions**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `draftRef` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `answers` | object | yes |  |
| `useDefaults` | boolean | no |  |

Answers:

- `200` Answer a template's questions
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/drafts/DRAFT_DRAFTREF/answers \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"answers":"string","useDefaults":false}'
```

## GET /api/v1/forms

**List forms**

Every form template in the workspace: its link name, whether it is open, its response count and whether it has closed (a closing date or a response limit).

Answers:

- `200` List forms
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/forms \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/forms/templates

**List form templates**

The built-in form templates (the thirty from the template library) and your own: name, summary, who it is for, whether a team member counter-signs, and its default Publish settings.

Answers:

- `200` List form templates
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/forms/templates \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/forms/{id}

**Get a form**

One form: its link (`/f/<workspace>/<slug>`), settings, response count and whether it is open.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` Get a form
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/forms/FORM_ID \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/forms/{id}/responses

**List a form's responses**

Newest first. Each response is a document: its id opens it with GET /api/v1/documents/{id}. `limit` is 1 to 500.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `limit` | query | no | integer |
| `offset` | query | no | integer or null |

Answers:

- `200` List a form's responses
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/forms/FORM_ID/responses \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/forms/publish

**Publish a form**

Gives a form template its public link and settings (or changes them). `slug` is 4 to 60 letters, numbers and dashes. The template must be approved and have one person who fills it in, plus at most one team member who counter-signs (`settings.counterSign`).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `templateId` | string | yes |  |
| `slug` | string | yes |  |
| `settings` | object | no |  |
| `enabled` | boolean | no |  |

Answers:

- `200` Publish a form
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/forms/publish \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e","slug":"mutual-nda","settings":{"verifyEmail":false,"copyTo":"jo@example.com","expiresAt":"string","responseLimit":"string","intro":"string","thankYou":"string","fillAgain":false,"embedSites":["https://example.com/hook"],"notifyOwner":false,"confirmRespondent":false,"counterSign":{"on":false,"userId":"6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e"}},"enabled":false}'
```

## POST /api/v1/forms/{id}/open

**Open or close a form**

`open: false` keeps the link but says the form is not taking responses.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `open` | boolean | yes |  |

Answers:

- `200` Open or close a form
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/forms/FORM_ID/open \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"open":false}'
```

## POST /api/v1/forms/{id}/unpublish

**Unpublish a form**

The link stops working. The form template, its settings and every response are kept; publish it again at any time.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` Unpublish a form
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` No such form.
- `409` A conflict, for example the link name is already used by another form.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/forms/FORM_ID/unpublish \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```

## GET /api/v1/webhooks/topics

**The events a webhook can subscribe to**

Answers:

- `200` The event names.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks/topics \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/webhooks

**List webhooks**

Answers:

- `200` Your webhook endpoints, newest first.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/webhooks

**Add a webhook**

Give an `https` `url` that can be reached from the internet, or `relay: true` for an endpoint that keeps its signed deliveries for `docustay listen` to fetch to your own computer. The signing secret is in the answer **once**. Events are signed with HMAC-SHA256 (Standard Webhooks headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; also `keystone-signature`).

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | no |  |
| `relay` | boolean | no |  |
| `name` | string | no |  |
| `eventTypes` | array of string | yes | From `GET /api/v1/webhooks/topics`. |

Answers:

- `201` Added. `secret` is shown once.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/webhooks \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","relay":false,"name":"Example","eventTypes":["string"]}'
```

## DELETE /api/v1/webhooks/{id}

**Remove a webhook**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` Removed: it receives nothing more. Its past deliveries stay in the record.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X DELETE https://app.docustay.app/api/v1/webhooks/WEBHOOK_ID \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/webhooks/{id}/test

**Send a test event**

Sends a sample signed event (`test: true` in its payload) to the webhook now and returns the receiver's answer. Nothing is stored and failures here never count toward disabling the webhook. Nothing is created, so no Idempotency-Key is needed: repeating the call just sends another test.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `topic` | string | no |  |

Answers:

- `200` What the receiver answered.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/webhooks/WEBHOOK_ID/test \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"topic":"string"}'
```

## POST /api/v1/webhooks/{id}/rotate

**Rotate the signing secret**

Makes a new secret (shown once). For `windowHours` (default 24) every event is signed with both the new and the old secret, so your receiver can switch without a gap.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `windowHours` | integer | no |  |

Answers:

- `200` The new secret.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/webhooks/WEBHOOK_ID/rotate \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"windowHours":0}'
```

## GET /api/v1/webhooks/{id}/deliveries

**Recent deliveries**

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The last 50 delivery attempts, newest first.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks/WEBHOOK_ID/deliveries \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/webhooks/{id}/relay

**Fetch stored deliveries of a relay webhook**

For `docustay listen`. Returns deliveries stored since `after` (an id from a previous answer; leave out for the newest few), oldest first, each with the exact headers to forward so the signature checks out. Waits up to `wait` seconds (max 25) when there is nothing yet. Kept 24 hours.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `after` | query | no | string |
| `wait` | query | no | integer or null |
| `limit` | query | no | integer |

Answers:

- `200` Stored deliveries.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks/WEBHOOK_ID/relay \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/embedded/builder-session

**Start an embedded template builder session**

Returns a link that works for one hour and is meant for an iframe or the `<docustay-builder>` element on one of your allowed websites. The builder lets the person write a document, drop signature and other fields on it, and save it as a template; the saved template's id comes back to your page in a `saved` event. The link holds a key of its own that can only read and write templates and stops working after an hour. Needs an `Idempotency-Key` header.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `origin` | string | yes | The website that will show the builder; must be on your allowed list. |
| `name` | string | no | A name to start the template with. |

Answers:

- `200` The session.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `409` Embedding is off, or that website is not on your allowed list (Developers → Embedding).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/embedded/builder-session \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"origin":"https://app.example.com","name":"Example"}'
```

## POST /api/v1/embedded/scribe-session

**Start an embedded Scribe session**

Returns a link that works for one hour and is meant for an iframe or the `<docustay-scribe>` element on one of your allowed websites. The person picks a play, names who signs, answers a few clickable questions and gets a DRAFT; the draft's id comes back to your page in a `drafted` event. The link holds a key of its own that is draft-only (it cannot send: asking to send files an approval a person decides in Docustay), allows 50 drafts a day and stops working after an hour. Needs an `Idempotency-Key` header.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `origin` | string | yes | The website that will show Scribe; must be on your allowed list. |
| `name` | string | no |  |

Answers:

- `200` The session.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `409` Embedding is off, or that website is not on your allowed list (Developers → Embedding).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/embedded/scribe-session \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"origin":"https://app.example.com","name":"Example"}'
```

## GET /api/v1/search

**Search documents, templates, forms and people**

The same search as ⌘K in the app: documents by title or signer, templates, forms and people, best first, grouped. `per` is how many of each kind (1 to 20, default 6).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `q` | query | yes | string |
| `per` | query | no | integer |

Answers:

- `200` Search documents, templates, forms and people
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/search?q=example \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## GET /api/v1/contracts

**List signed contracts with their key dates**

Every signed document with the dates read from its boxes at signing — start, end, notice, renewal — and its value, with where each came from (`source`: a box, or a person's correction). Filter with `q` (title or person).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `q` | query | no | string |
| `limit` | query | no | integer |

Answers:

- `200` List signed contracts with their key dates
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/contracts \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/contracts/{id}/dates

**Correct a contract's key date**

Sets one key date (or the value) on a signed document by hand. The signed PDF never changes; the correction is kept as the person's, and renewal reminders follow it. `date` is YYYY-MM-DD; `null` clears it.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `start` · `end` · `notice` · `renewal` · `value` | yes |  |
| `date` | string or null | no |  |
| `amountMinor` | integer or null | no |  |
| `currency` | string or null | no |  |

Answers:

- `200` Correct a contract's key date
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/contracts/CONTRACT_ID/dates \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"kind":"start","date":"string","amountMinor":"string","currency":"string"}'
```

## GET /api/v1/payments

**List payments taken through documents and forms**

Newest first: who paid, for which document, the amount, status (`paid`, `waiting` — signed, the signature kept while they pay — `started`, `refunded`, `partially_refunded`, `disputed`), and this month's figures (`month.stripeFee` is Stripe's own fees, `month.stripeFeePending` the payments Stripe has not settled yet). Page with `before` (the `next` of the previous page).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `before` | query | no | string |
| `limit` | query | no | integer |

Answers:

- `200` List payments taken through documents and forms
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/payments \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/payments/{id}/refund

**Refund a payment, in full or in part**

Refunds through Stripe on the workspace's own account. Leave out `amountMinor` for the rest of the payment. `reason` is required: it shows on the payer's Stripe receipt and goes in the document's audit trail. The signed document stays signed. Needs an `Idempotency-Key`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `amountMinor` | integer | no |  |
| `reason` | string | yes |  |

Answers:

- `201` Refund a payment, in full or in part
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `409` The payment was never completed, or has already been refunded, so there is nothing (more) to refund.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/payments/PAYMENT_ID/refund \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"amountMinor":0,"reason":"Example"}'
```

## GET /api/v1/automations

**List automations**

Each automation built on the canvas: when it starts (a signed document from a template or form), its steps, whether it is on, how many times it ran and its recent runs. (`GET /api/v1/playbooks` lists packs: bundles of skills and templates.)

Answers:

- `200` List automations
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/automations \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## POST /api/v1/automations/{id}/enable

**Switch an automation on or off**

`on: true` switches it on (Pro): from then on, each matching signed document starts a run. `on: false` stops new runs, and a run that is waiting stops when its wait ends, without sending its reminder.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `on` | boolean | yes |  |

Answers:

- `200` Switch an automation on or off
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/automations/AUTOMATION_ID/enable \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"on":false}'
```
