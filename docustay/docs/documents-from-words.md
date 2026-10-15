---
title: Documents from words and people
description: Make a document from written words and the people who sign it, answer a template's questions, let an assistant draft or change it, collect a payment at signing, and send it, all from the API, the SDKs or MCP.
order: 5
---

# Documents from words and people

Everything the screens do, a key can do. A document is **words** (a source) plus **people** (a name, an email, a role word). Roles are words from the text, such as `Client` and `Provider`, never seat numbers.

## Make a document

```bash
curl -X POST https://app.docustay.app/api/v1/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{
    "title": "Retainer agreement",
    "source": { "type": "doc", "content": [
      { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Retainer agreement" }] },
      { "type": "paragraph", "content": [{ "type": "text", "text": "The studio works for " },
        { "type": "variableChip", "attrs": { "name": "custom.p_client_name", "label": "Client name" } }, { "type": "text", "text": "." }] },
      { "type": "paragraph", "content": [{ "type": "fieldTag", "attrs": { "name": "Client signature", "type": "signature", "role": "Client" } }] }
    ] },
    "people": [{ "name": "Dana Whitfield", "email": "dana@example.com", "role": "Client" }],
    "send": { "subject": "Please sign", "reminderDays": [3, 7], "expiryDays": 30 }
  }'
```

The answer is `{ "id", "state": "draft", "roles": [...] }`. The document stays a **draft** until you send it with `POST /api/v1/documents/{id}/send` (or set `sendNow: true`). The same checks as the screen's Send apply.

* **People.** `{ name, email, role?, action?, order? }`. `action` is `signer`, `approver`, `viewer`, `assistant` or `cc`. Each person's own name and email are available to the words as merge text: a `custom.p_<role>_name` chip (for example `custom.p_client_name`) prints that role's person.
* **Smart fields.** A `fieldTag` can fill itself from the person (`autofill: "name"` or `"email"`), allow or forbid changes (`editable`), carry a `placeholder` and `tooltip`, or be filled by you and locked (`locked` with a `default`).
* **Sender only sections.** A heading with `audience: "sender"` hides itself and everything below it up to the next heading of the same or higher level. It is in nothing a signer sees, signs or receives. A signer field inside such a section is refused.
* **Check first.** `POST /api/v1/documents/check` tells you what a person would be told: errors, warnings and the roles in the text. Nothing is saved.
* **Read and change a draft.** `GET /api/v1/documents/{id}/source` returns the words, people and choices. `POST /api/v1/documents/{id}/revise` prints new words into a **new** draft that takes the people and choices; the old draft is deleted, so **the id changes**.

## Templates with questions

A `custom.<key>` merge chip in a template is a **question** the sender answers when using it (`kind` is `text`, `number`, `money` or `date`; `default` and `help` are optional). The template's questions are shown where you build and send it in the app; through the API you pass an answer for each question's key in `variableValues`. Use the template:

```bash
curl -X POST https://app.docustay.app/api/v1/templates/$TEMPLATE/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "people": [{ "name": "Dana Whitfield", "email": "dana@example.com" }], "variableValues": { "fee": "750", "client_company": "Harbor Traders" } }'
```

Every question must have an answer (or a starting answer). `POST /api/v1/templates/{id}/defaults` sets what a document made from the template starts with: its description, the signer-facing text, the message and the send choices.

## The assistant

* **Draft.** `POST /api/v1/documents/ai/draft` takes a plain `prompt` or the wizard's `brief`. `GET /api/v1/ai/wizard` returns the same questions the screen asks, the payment questions and the currencies offered.
* **Change.** `POST /api/v1/documents/ai/edit` takes `request` and `source` and returns **proposed changes**, never an edited document: `patches.applied` lists `replace_text`, `insert_block`, `replace_block` and `remove_block` operations for a person to accept. With `variables` (the template's questions) it also proposes answers in `patches.values`.
* **Progress.** Read `GET /api/v1/documents/ai/jobs/{id}`: `stage` moves `queued`, `writing`, `checking`, `ready` (or `failed`), and `state` is `queued`, `running`, `done`, `failed` or `cancelled`. `POST /api/v1/documents/ai/jobs/{id}/cancel` stops it. A job whose worker died is put back and finished by itself.
* The assistant never sends, never pays and never signs.

## Collect a payment at signing

Put the payment in the brief: `"payment": { "collect": true, "amount": "1500", "currency": "usd", "payer_role": "Client", "description": "the first month" }`. The **amount comes only from the person**: the assistant drafts around it, the worker (plain code) checks every amount it proposes against yours and places one Payment field for the payer, and the payment terms are written in the text from your own values. Later payments are written as text (`schedule_note`).

The signer pays on Stripe's hosted page and cannot sign until Stripe says it is paid. `GET /api/v1/payments/status` says `connected` (details submitted, charges on, nothing due), `needs_attention` or `not_connected`. **A document with a payment field can only be sent when it says `connected`**; otherwise Send answers with a plain reason. Currencies offered: usd, eur, gbp, cad, aud, nzd, chf, sek, nok, dkk.

## From an SDK or MCP

| API | JavaScript | Python | MCP tool |
|---|---|---|---|
| `POST /documents` | `createDocument` | `create_document` | `create_document` |
| `POST /documents/check` | `checkDocument` | `check_document` | `check_document` |
| `GET /documents/{id}/source` | `getDraftSource` | `get_draft_source` | `get_draft_source` |
| `POST /documents/{id}/revise` | `reviseDocument` | `revise_document` | `revise_document` |
| `POST /documents/{id}/send` | `sendDraft` | `send_draft` | `send_draft` (asks first) |
| `POST /templates/{id}/documents` | `useTemplate` | `use_template` | `use_template` |
| `POST /templates/{id}/defaults` | `setTemplateDefaults` | `set_template_defaults` | `set_template_defaults` |
| `POST /documents/ai/draft` | `draftWithAi` | `draft_with_ai` | `draft_document_with_ai` |
| `POST /documents/ai/edit` | `editWithAi` | `edit_with_ai` | `edit_document_with_ai` |
| `GET /ai/wizard` | `getWizard` | `get_wizard` | `get_wizard` |
| `GET /payments/status` | `paymentsStatus` | `payments_status` | `get_payments_status` |

Over MCP, nothing emails anyone until `send_draft` is called again with `confirm: true`, and there is no tool that signs, pays or deletes.
