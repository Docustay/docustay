---
title: Email API
description: Control the email of a document from your code, edit the templates, read the email log and get a webhook when a message is delivered or bounces.
order: 13
---

# Email API

Everything the portal does with email can be done from the API. Docustay never sends general email: only mail about a document your workspace made, to the people named on it.

## Per document

Add an `email` object to a send or a draft:

```js
await docustay.sendDocument({
  templateId, parties,
  email: { subject: "Your agreement", message: "Thanks for choosing us.", replyTo: "hello@example.com", senderName: "Example Co", locale: "fr" },
});
```

`locale` is a language code such as `en`, `es` or `fr`, or `auto` to match each person. Every field is optional.

## Templates

```js
await docustay.listEmailTemplates();                                  // every message, with saved wording where there is any
await docustay.saveEmailTemplate("invitation", { subject: "{{org.name}} sent you {{document.title}}", locale: "en" });
await docustay.previewEmailTemplate("invitation", { subject: "…" });  // what it would look like, nothing sent
await docustay.resetEmailTemplate("invitation");                      // back to the built-in wording
```

The message types are `invitation`, `reminder`, `completed`, `declined`, `voided`, `expired`, `code` and `receipt`. Reading needs the `templates:read` scope and changing needs `templates:write`.

## The log

```js
const { emails, nextCursor } = await docustay.listEmails({ documentId, status: "bounced", limit: 50 });
```

You can filter by document, recipient (`to`), `status` and `kind`. A status is one of `sent`, `delivered`, `bounced`, `complained`, `failed`, `skipped`, `paused` and `limit_reached`. The same list is in **Settings → Developers → Email events**.

## Webhooks

Subscribe a [webhook](/docs/webhooks) to `documents.email.delivered`, `documents.email.bounced` and `documents.email.complained`. They carry ids only, never an address. `documents.email.paused` tells you sending was paused for the workspace.

## Safe by design

Mail goes only to people named on the document. Sending pauses by itself for a workspace when 2% of its recent email bounces or 0.05% is reported as spam, once at least 50 emails have gone out in 30 days, so one bad list cannot harm your domain's name. **Workspace → Domains and email** shows how close you are.
