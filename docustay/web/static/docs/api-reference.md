
# API reference

Generated from the OpenAPI 3.1 document at `/api/openapi.json`; do not edit by hand.

The e-signature API you own. One flat price for every user. Open source and self-hostable. Pro is $35 a month for your whole team: no per-seat fees, unlimited people and documents. Signers can pay while they sign, straight into your own Stripe account, and Pro adds no fee.

**Authentication.** Send `Authorization: Bearer <key>`. Make keys in Settings → Developers → API keys and give each only the scopes it needs (there are 12 in all): `documents:read`, `documents:write`, `people:read`, `plays:read`, `plays:write`, `drafts:write`, `templates:read`, `templates:write`, `webhooks:read`, `webhooks:write`, `account:read`, `embedded:write`. A key that starts `dsk_test_` works in **test mode**: documents it sends are practice runs (emailed only to the sender, stamped TEST, never counted or billed), it can only see and act on test documents (any other document answers `404`), and it can sign them itself with `POST /api/v1/documents/{id}/test-sign`. A key can also be limited to a list of addresses, given an expiry, or made **draft-only**.

**Draft-only keys.** A draft-only key can make and edit drafts but cannot send. Asking it to send answers `202` with an `approval`, the document stays a draft, and a person approves or declines in Settings → Developers → Approvals. Keys can also have a daily limit of drafts and sends; past it you get `429`.

**Payments.** A template may contain payment fields (text tag `type=payment` with a set `amount`, optionally a `deposit`, or an amount you give when you send it with `amount=custom.<name>`). The signer pays on Stripe's hosted page; the money goes to your own connected Stripe account; Docustay's fee is 2% on the Free and Pay as you go plans and 0% on Pro and Lifetime, plus Stripe's own fees. The document's `payments` list shows each payment, its receipt and the fee. Card details never reach Docustay.

**Idempotency.** Requests that create a document or a template, or send one, need an `Idempotency-Key` header (8–200 characters). Repeating a request with the same key and body returns the first answer instead of doing it twice.

**Your own reference.** Documents and templates take `externalId` (your id for it) and `metadata` (up to 20 short key/value pairs). List with `externalId=` or `metadata[key]=value` to find them again, and both come back in webhooks.

**Errors.** Every error is `{ "error": { "kind", "message", "requestId", "retryable" } }`. `kind` is one of `validation`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `unprocessable`, `rate_limited`, `dependency`, `timeout`, `internal`. Quote the `requestId` to support, or search it in Settings → Developers → API log. **Plan limits** are `403 forbidden` with `error.detail.code`: `plan_document_limit` (the plan's documents this month are used), `plan_signer_limit` (Free: 15 different signers a month; sending again to someone already sent to this month never counts) or `plan_template_limit` (Free: 5 and Pay as you go: 25 new templates a month; a new version of a template you have does not count). All carry `detail.used`, `detail.limit` and `detail.resetsAt` (the first of next month, UTC). Everything already made keeps working. Pro, Lifetime and self-hosted installs have no template or signer limit.

**Rate limits.** Each key has its own per-minute budget. Every answer carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds); over the budget you get `429` with a `Retry-After` header.

**Versions.** Every answer carries `Docustay-Version`, a date. A change that could break a caller gets a new date and is announced in the changelog before it ships; additions (a new field, a new route) are not breaking and do not change the date.

**Pagination.** Lists take `limit` (1–200) and `cursor`; the answer carries `page.nextCursor` (null on the last page).

**Signing links.** No response contains a signing link or access code, with one exception you control: a seat you send in `embedded` can be given an embedded signing session (`POST /api/v1/documents/{id}/embed-session`), a one-hour link for a frame on a website you listed. A key can start and follow a signature, and put your own signer in front of the form for seats you marked yourself; it cannot sign for anyone.

## GET /api/v1/documents/templates

**Templates you can send**

Templates you can send.

Answers:

- `200` Approved, current templates.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/documents/templates \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/documents

**List documents**

Filter by your own reference: `externalId=…`, and `metadata[key]=value` (repeat for more keys; a document must match all).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `state` | query | no | Only documents in this state; any other value is refused. |
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
| `email` | object | no | Your own wording for the emails about THIS document. What you give here is used for this document. |
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"email":{"subject":"Example","message":"Example","replyTo":"jo@example.com","senderName":"string"},"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","title":"Example","source":{},"people":[{"externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"},"name":"Example","email":"jo@example.com","role":"Signer","action":"signer","order":1}],"facts":{},"variableValues":{},"paper":"letter","send":{"replyTo":"jo@example.com","senderName":"string","subject":"Example","message":"Example","expiryDays":0,"reminderDays":[1],"signingOrder":"any","internalNote":"string","requireDeclineReason":false},"description":"string","sendNow":false}'
```

## GET /api/v1/documents/{id}

**One document and where each person is**

One document and where each person is.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## DELETE /api/v1/documents/{id}

**Delete a draft that was never sent**

Removes a draft and its files. A document that was sent cannot be deleted: void it instead (`POST /api/v1/documents/{id}/void`), which keeps its record.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` Deleted.
- `401` No or bad key.
- `404` No such document.
- `409` The document was sent; void it instead.

```bash
curl -X DELETE https://app.docustay.app/api/v1/documents/DOCUMENT_ID \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/documents/{id}/signed.pdf

**Download the signed copy**

Download the signed copy.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
| `email` | object | no | Your own wording for the emails about THIS document. What you give here is used for this document. |
| `metadata` | object | no | Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer. |
| `externalId` | string | no | Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`. |
| `title` | string | no |  |
| `message` | string or null | no |  |
| `subject` | string | no |  |
| `expiryDays` | integer | no |  |
| `signingOrder` | `any` · `sequential` | no | `sequential`: each seat signs in the template's seat order (signer_1 first), and an embedded seat gets its session only when it is that person's turn. Left out, the template's own setting. |
| `values` | object | no | The boxes the sender fills in ("Filled in by: Sender") and the template's send-time amounts, by key: a box's label in lower case with underscores ("Effective date" → `effective_date`). A send that leaves one empty answers 400 naming it. |
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e","email":{"subject":"Example","message":"Example","replyTo":"jo@example.com","senderName":"string"},"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","title":"Example","message":"Example","subject":"Example","expiryDays":1,"signingOrder":"any","values":{"effective_date":"2026-11-01"},"embedded":["string"],"parties":[{"seat":"signer_1","name":"Example","email":"jo@example.com","externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"}}]}'
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","name":"Example","source":{},"profile":"typeset","paper":"letter"}'
```

## POST /api/v1/documents/ai/draft

**Ask for an AI-written draft**

Starts a draft and answers at once with a job id; poll `GET /api/v1/documents/ai/jobs/{id}`. Send an `Idempotency-Key` header to make a retry safe: the same key and body answer the first job and spend no second draft. The draft is a suggestion for a person to read; nothing is saved or sent. Refused plainly when AI drafting is switched off for the workspace or a limit is reached.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"string","brief":{"type":"string","kind":"string","answers":{},"final":"string","payment":{"collect":true,"amount":"1500","currency":"usd","payer_role":"string","description":"string","schedule_note":"string"}},"mode":"template"}'
```

## GET /api/v1/documents/ai/jobs/{id}

**Read an AI draft job**

Read an AI draft job.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/usage

**Documents, templates and emails used against your plan**

Documents sent this period, AI drafts, new templates made this period and emails sent today, with the plan's limits, plus what the period costs so far on a plan with per-unit prices (`billing`). The period is the billing period on Pay as you go, Pro and Lifetime (`periodStart` to `periodEnd`, UTC; everything resets on `periodEnd`) and the UTC calendar month on Free. `limit` is null when the plan has no limit (Pro has no template limit; a self-hosted install has no limits).

Answers:

- `200` Usage.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/usage \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## POST /api/v1/preflight

**Ask what an action would do to your plan, before doing it**

Answers, for one action, whether it is allowed (`allowed`), what it costs this time in whole cents (`cost.minor`, 0 inside the allowance; for `invite_person` it is a monthly amount, `cost.prorated`), where the meter stands and where it will stand (`meter`, `afterThis`), how loud the moment is (`severity`: `none`, `info` from 50 percent of the meter, `warn` from 80, `limit` at 100 while still allowed, `blocked` when the action would be refused), the stable refusal code the action would carry (`reason`, the same codes the refusals use: `plan_document_limit`, `plan_people_limit`, `plan_template_limit`, `plan_pro_required`, `budget_reached`, `ai_limit_credits`, `too_big`), the options that would let you go on with their prices (`options`, cheapest first) and one plain sentence (`message`). Every number is read from the one price list and your workspace's own counts; nothing is changed. The refusals the other routes return carry the same `options` and `severity` in `error.detail`.

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `action` | `send_document` · `bulk_send` · `invite_person` · `remove_person` · `ai_draft` · `ai_edit` · `ai_read_file` · `create_template` · `upload` · `use_feature` · `connect_payments` | yes | What you are about to do: `send_document`, `bulk_send` (with `documents`), `invite_person` or `remove_person` (with `people`), `ai_draft`, `ai_edit`, `ai_read_file`, `create_template`, `upload` (with `bytes`), `use_feature` (with `item`) or `connect_payments`. |
| `documents` | integer | no |  |
| `people` | integer | no |  |
| `recipients` | array of string | no | For `send_document`: the email addresses you are about to send to, so a Free workspace is told how many of them are new signers this month (anyone already sent to this month, and your own team, do not count). |
| `bytes` | integer | no |  |
| `item` | string | no | For `use_feature`: the item to ask about, one of `unlimited_documents`, `hide_footer`, `auto_reminders`, `bulk_send`, `team_roles`, `signing_groups`, `scribe_actions`, `ai_bulk`, `custom_plays` (your own plays and playbooks), `plays_api`. Any other name is a 400 `unknown_item`. |

Answers:

- `200` The answer.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/preflight \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"action":"send_document","documents":1,"people":1,"recipients":["string"],"bytes":0,"item":"string"}'
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"string","file":"string","minConfidence":0,"ocr":false}'
```

## GET /api/v1/ai/usage

**AI drafts used against your plan**

The AI allowance for the current period: drafts included, used and remaining, when it resets, and the split by kind of work. `mode` is `own_key` (you bring your own provider key, so nothing is metered) or `unmetered` (self-hosted).

Answers:

- `200` AI usage.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/ai/usage \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/templates/library

**List the built-in templates**

The built-in templates: title, summary, seats, field counts and the questions its guidance asks. `templateId` is your workspace's copy once it has been used. Empty when the workspace hides the library.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `kind` | query | no | `document` |

Answers:

- `200` List the built-in templates
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (for a customized copy: the plan's monthly new-template limit).
- `404` No such built-in template.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/templates/library \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"name":"Example"}'
```

## GET /api/v1/templates/{id}

**One template and its seats**

One template and its seats.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/documents/{id}/audit-log.csv

**The document's audit log as CSV**

The document's audit log as CSV.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## POST /api/v1/documents/{id}/remind

**Remind the people who still have to sign**

Remind the people who still have to sign.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"seat":"signer_1"}'
```

## POST /api/v1/documents/{id}/embed-session

**Start an embedded signing session for a seat**

For a seat that was sent in `embedded`. Returns a link that works for one hour and is meant for an iframe or the `<docustay-sign>` element on one of your allowed websites. It is the only way a key can put someone in front of a signing form, and only for seats you marked embedded yourself. No `Idempotency-Key` is needed: each call starts a fresh one-hour session, and the last few stay open so a page that loads twice keeps working.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"seat":"signer_1","origin":"https://app.example.com"}'
```

## GET /api/v1/teams

**Teams and their members**

Teams and their members.

Answers:

- `200` The teams.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/teams \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/emails

**The log of email about your documents**

Every email sent about a document, to a person named on it: kind, subject, status (sent, delivered, bounced, complained, failed, paused). Filter by `documentId`, `to`, `status`, `kind`. No bodies, no links.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `documentId` | query | no | string |
| `to` | query | no | string |
| `status` | query | no | Only emails in this state; any other value is refused (R13-D205). |
| `kind` | query | no | Only emails of this kind; any other value is refused (R13-D346). |
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
| `decline` | boolean | no | Decline the seat instead of signing it: the document becomes `declined` and `documents.document.declined` fires, as when a person declines. |
| `reason` | string | no | With `decline`, the reason the sender sees. |

Answers:

- `200` Signed, or declined with `decline: true`.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/documents/DOCUMENT_ID/test-sign \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"seat":"signer_1","decline":false,"reason":"Example"}'
```

## POST /api/v1/documents/{id}/void

**Void a document that is still out for signature**

Void a document that is still out for signature.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Example"}'
```

## POST /api/v1/documents/check

**Check a document's words before making it**

Check a document's words before making it.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":{},"facts":{},"people":[{"externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"},"name":"Example","email":"jo@example.com","role":"Signer","action":"signer","order":1}],"variableValues":{},"requireSignature":false,"forTemplate":false}'
```

## GET /api/v1/documents/{id}/source

**The words, people and choices of a draft**

The words, people and choices of a draft.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":{},"facts":{},"variableValues":{},"roleMap":{}}'
```

## POST /api/v1/documents/{id}/send

**Send a draft**

Sends a draft made with `POST /api/v1/documents`. The same checks as the screen's Send; a payment field needs Stripe connected. Needs an `Idempotency-Key`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |
| `Idempotency-Key` | header | yes | A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice. |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `values` | object | no | The boxes the sender fills in ("Filled in by: Sender") and the template's send-time amounts, by key: a box's label in lower case with underscores ("Effective date" → `effective_date`). A send that leaves one empty answers 400 naming it. |

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"values":{"effective_date":"2026-11-01"}}'
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
| `email` | object | no | Your own wording for the emails about THIS document. What you give here is used for this document. |
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"email":{"subject":"Example","message":"Example","replyTo":"jo@example.com","senderName":"string"},"metadata":{"crmDealId":"D-1042"},"externalId":"contract-2026-0042","title":"Example","people":[{"externalId":"contract-2026-0042","metadata":{"crmDealId":"D-1042"},"name":"Example","email":"jo@example.com","role":"Signer","action":"signer","order":1}],"variableValues":{},"facts":{},"send":{"replyTo":"jo@example.com","senderName":"string","subject":"Example","message":"Example","expiryDays":0,"reminderDays":[1],"signingOrder":"any","internalNote":"string","requireDeclineReason":false},"sendNow":false}'
```

## POST /api/v1/templates/{id}/defaults

**Set what a document made from a template starts with**

Set what a document made from a template starts with.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"description":"string","clientDescription":"string","message":"Example","send":{"replyTo":"jo@example.com","senderName":"string","subject":"Example","message":"Example","expiryDays":0,"reminderDays":[1],"signingOrder":"any","internalNote":"string","requireDeclineReason":false}}'
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"request":"string","source":{},"mode":"template","variables":[{"key":"string","label":"string","kind":"text"}]}'
```

## POST /api/v1/documents/ai/jobs/{id}/cancel

**Cancel an AI job**

Cancel an AI job.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":"string"}'
```

## GET /api/v1/plays/{name}

**One play**

One play.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## DELETE /api/v1/plays/{name}

**Archive a play**

Archive a play.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source":"string"}'
```

## POST /api/v1/plays/{name}/publish

**Publish a play version**

Publish a play version.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"version":0}'
```

## POST /api/v1/plays/{name}/duplicate

**Copy a play under a new name**

Copy a play under a new name.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"name":"string","title":"Example","description":"string","plays":["string"],"templates":["string"]}'
```

## POST /api/v1/playbooks/{name}/enable

**Switch a pack on or off**

Switch a pack on or off.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
| `values` | object | no | Send-time amounts the template's words need, by key (a `needs_input` answer lists them under `values`), e.g. `{ "deposit": "$500" }`. |
| `useDefaults` | boolean | no |  |

Answers:

- `200` Start a draft from a template
- `400` Not valid.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` Not allowed (Pro) or the key lacks the scope.
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl -X POST https://app.docustay.app/api/v1/drafts \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"template":"string","title":"Example","people":[{"name":"Example","email":"jo@example.com","role":"Signer","action":"signer"}],"answers":{},"values":{},"useDefaults":false}'
```

## POST /api/v1/drafts/{draftRef}/answers

**Answer a template's questions**

Answer a template's questions.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `draftRef` | path | yes | string |

Request body (JSON):

| Field | Type | Required | Notes |
|---|---|---|---|
| `answers` | object | yes |  |
| `values` | object | no | Send-time amounts the template's words need, by key (a `needs_input` answer lists them under `values`), e.g. `{ "deposit": "$500" }`. |
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"answers":{},"values":{},"useDefaults":false}'
```

## GET /api/v1/webhooks/topics

**The events a webhook can subscribe to**

The events a webhook can subscribe to.

Answers:

- `200` The event names.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks/topics \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/webhooks

**List webhooks**

List webhooks.

Answers:

- `200` Your webhook endpoints, newest first.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","relay":false,"name":"Example","eventTypes":["string"]}'
```

## GET /api/v1/webhooks/{id}

**Get a webhook**

Get a webhook.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `id` | path | yes | string |

Answers:

- `200` The webhook endpoint. The signing secret is never shown again.
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `404` Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/webhooks/WEBHOOK_ID \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## DELETE /api/v1/webhooks/{id}

**Remove a webhook**

Remove a webhook.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## POST /api/v1/webhooks/{id}/test

**Send a test event**

Sends a sample signed event (`test: true` in its payload) to the webhook now and returns the receiver's answer. The send is listed under the webhook's deliveries with `test: true`; failures here never count toward disabling the webhook and are never retried. Nothing is created, so no Idempotency-Key is needed: repeating the call just sends another test.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"windowHours":1}'
```

## GET /api/v1/webhooks/{id}/deliveries

**Recent deliveries**

Real deliveries and test sends (`test: true`, from `POST /webhooks/{id}/test`) together.

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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"origin":"https://app.example.com","name":"Example"}'
```

## GET /api/v1/search

**Search documents, templates and people**

The same search as ⌘K in the app: documents by title or signer, templates and people, best first, grouped. `per` is how many of each kind (1 to 20, default 6).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `q` | query | yes | string |
| `per` | query | no | integer |

Answers:

- `200` Search documents, templates and people
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/search?q=example \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## GET /api/v1/payments

**List payments taken through documents**

Newest first: who paid, for which document, the amount, status (`paid`, `waiting` — signed, the signature kept while they pay — `started`, `refunded`, `partially_refunded`, `disputed`), and this month's figures (`month.stripeFee` is Stripe's own fees, `month.stripeFeePending` the payments Stripe has not settled yet). Page with `before` (the `next` of the previous page).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `before` | query | no | string |
| `limit` | query | no | integer |

Answers:

- `200` List payments taken through documents
- `400` The request is not valid. `message` says which field and why.
- `401` The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.
- `403` The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).
- `429` Too many requests. Wait `Retry-After` seconds, then try again.

```bash
curl https://app.docustay.app/api/v1/payments \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
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
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"amountMinor":1,"reason":"Example"}'
```
