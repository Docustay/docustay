# Email API

Everything the portal does with email can be done from the API. Docustay never sends general email: only mail about a document your workspace made, to the people named on it.

## Per document

Add an `email` object to a send or a draft:

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const templateId = process.env.DOCUSTAY_TEMPLATE_ID;   // one of your templates: GET /api/v1/documents/templates lists their ids
const parties = [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }];
await docustay.sendDocument({
  templateId, parties,
  email: { subject: "Your agreement", message: "Thanks for choosing us.", replyTo: "hello@example.com", senderName: "Example Co" },
});
```

Every field is optional. Docustay's emails, signing page, sealed PDF and certificate are in English; there is no language option yet.

## Wording

Each message's wording is Docustay's own and the same for every workspace; the API does not change it. What you can set is per document: the `email` object above (subject, message, reply-to, sender name) goes into that document's invitation and reminders.

The message types are `invitation`, `reminder`, `completed`, `declined`, `voided`, `expired`, `code` and `receipt`; `GET /api/v1/emails` lists what was sent, by type and status.

## The log

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const documentId = process.env.DOCUSTAY_DOCUMENT_ID;   // a document you sent
const { emails, nextCursor } = await docustay.listEmails({ documentId, status: "bounced", limit: 50 });
```

You can filter by document, recipient (`to`), `status` and `kind`. A status is one of `sent`, `delivered`, `bounced`, `complained`, `failed`, `skipped`, `paused` and `limit_reached`. The same list is in **Settings → Developers → Email events**.

## Webhooks

Subscribe a [webhook](/docs/webhooks) to `documents.email.delivered`, `documents.email.bounced` and `documents.email.complained`. They carry ids only, never an address. `documents.email.paused` tells you sending was paused for the workspace.

## Safe by design

Mail goes only to people named on the document. Sending pauses by itself for a workspace when 2% of its recent email bounces or 0.05% is reported as spam, once at least 50 emails have gone out in 30 days, so one bad list cannot harm your domain's name. **Workspace → Domains and email** shows how close you are.

## Which message is which

| Type | Sent when |
|---|---|
| `invitation` | a document is sent to a person to sign |
| `reminder` | a reminder goes out |
| `completed` | everyone has signed |
| `declined` | a person declines |
| `voided` | the sender cancels the document |
| `expired` | the document ran past its expiry |
| `code` | a signer is sent a code |
| `receipt` | a receipt is sent |


## Reading failures

`listEmails` with `status: "bounced"` or `"failed"` gives the messages to fix. The webhook events carry ids only, so fetch the log entry by document id to see the detail, and never expect an address in the payload.

## Scopes you need

Reading the email log (`GET /api/v1/emails`) needs `documents:read`, and sending a document with an `email` object needs `documents:write`. A key that lacks the scope gets the same `401` as a wrong key, so check the scopes first when a call is refused.
