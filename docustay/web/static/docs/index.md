# Docustay developer documentation

Docustay sends documents for signature. Everything you can do in the app you can also do from code, within the permissions of an API key you create.

| You want to | Start here |
|---|---|
| Send your first document in ten minutes | [Quickstart](/docs/quickstart.md) |
| Understand keys, scopes and test keys | [Authentication](/docs/authentication.md) |
| Make a document from words and people, answer a template's questions, collect a payment | [Documents from words and people](/docs/documents-from-words.md) |
| Turn HTML or a tagged PDF into a template | [Templates and text tags](/docs/templates-and-text-tags.md) |
| Show the signing form inside your own app | [Embedded signing](/docs/embedding.md) |
| Collect responses from many people with one link | [Form templates](/form-templates) |
| Search, read contract dates, list and refund payments, switch automations on | [Search, contracts, payments and automations](/docs/contracts-payments-playbooks.md) |
| List the built-in templates, draft from one, customize one, switch packs on | [The template library](/docs/template-library.md) |
| Get told when a document is signed | [Webhooks](/docs/webhooks.md) |
| Practise without sending anything real | [Test mode](/docs/test-mode.md) |
| Handle failures and limits | [Errors, retries and limits](/docs/errors-and-limits.md) |
| Use a generated client | [SDKs](/docs/sdks.md) |
| Let an AI assistant do it | [MCP server and agent skills](/docs/mcp-and-skills.md) |
| Look up an operation | [API reference](/docs/api-reference.md) |

Every page here is also served as plain Markdown at the same address with `.md` on the end, and `/llms.txt` lists them all for tools that read documentation.

## What you can build

A typical integration is small. Your system decides a document is needed, calls the API with a template and the people's names and emails, and waits for a webhook. When the webhook says the document is completed, your system downloads the signed copy and files it. Everything between is Docustay's job: emailing, reminders, the signing page, the certificate and the seal.

```bash
curl -X POST https://docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "TEMPLATE_ID", "parties": [{ "seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com" }] }'
```

## Where to start

New to it: do the quickstart with a test key, which emails only you. Already sending: read Webhooks and Errors, retries and limits before you go live, because retries and repeat deliveries are where integrations go wrong. Building a product: read Embedded signing.

## What is included

The API, webhooks and embedding are in every plan, within your monthly allowance. Test mode is free and uncounted. The SDKs and the MCP server run on your own machine with your own key.

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_KEY);
```
