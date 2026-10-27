---
title: E-signature features from file to sealed copy
description: E-signature features from file to sealed copy: Scribe, templates, signing on any device, payments and proof, in the app and from your API.
---

# Every step, from a file to a sealed copy.

All the e-signature features, from creating a document to a sealed copy: send it, get it signed on any device, get paid and keep proof. All of it works in the app and from your code.

## Five steps, one flow.

1. **Create**: Template, PDF or words
2. **Send**: Who signs, in what order
3. **Sign**: Any device, no account
4. **Get paid**: Inside the signature
5. **Prove**: Sealed PDF + certificate

## One page for each thing Docustay does.

Send and sign, get paid and use AI, and make it yours. Open any of them for the details, the limits and the questions people ask.

**How it works.** The whole flow, from creating a document to the sealed copy.

**Signing.** What the signer sees: any device, no account, drawn or typed.

**Templates and sending.** Text tags, field detection, the library and sending to a list.

**Proof and verify.** A certificate with every signed copy, and a verify page that needs no account.

**Payments.** The signer pays as part of signing, into your own Stripe account.

**Scribe.** Describe a document in plain words and review what Scribe builds.

**AI agents.** Let an assistant draft. A person approves the send.

**Your brand.** Your logo and your colours on the signing page.

**Embedded signing.** Show the signer inside your own product.

**Team and roles.** Owner, Admin and Member, and what each costs.

**Test mode.** A full sandbox where nothing reaches a real inbox.

## You do not need to write code.

**Pick or upload.** Start from a template or upload a PDF and drop the fields on it.

**Say who signs.** Add names and emails, choose the order and press send. People sign on any phone with no account.

**Keep the proof.** Everyone gets the sealed copy and its certificate, and you can check any copy later.

## Free, Pay as you go and Pro.

| What you get | Free | Pay as you go | Pro |
| --- | --- | --- | --- |
| Documents a month | 15 | 15 free, then $0.50 each | Unlimited |
| AI drafts a month | 10 | 10 free, then $0.30 each | 100, then $0.30 each |
| Team members who can send | One, the owner | $5 per team member a month | Everyone, at no extra charge |
| Signers | 15 different signers a month | Unlimited, free | Unlimited, free |
| New templates a month | 5 | 25 | Unlimited |
| API, webhooks and test mode | Included | Included | Included |
| Reminders and send to a list | Included | Included | Included |
| Your own plays and playbooks | No | No | Yes |
| Fee on payments taken while signing | 2% | 2% | 0% |

## Pick the feature that matches your day.

If you send a few documents a week, start with How it works and Templates: pick a template, add the people and press send. Everything works from the app, and the demo lets you try it with no sign-up.

If you are building signing into a product, start with Test mode and Embedded signing, then read the developer pages. A test key lets you build the whole flow before a real person gets an email.

If you want an assistant to do the typing, start with Scribe and Agent-ready. They draft, and a person approves every send.

## What is behind the features.

Every figure on this page is checked against the code on the date shown on the About page.

- **64** API operations: One OpenAPI 3.1 file.
- **39** MCP tools: For an assistant that drafts.
- **12** API scopes: A key can be given only what it needs.
- **600** Requests a minute: The same limit on every plan.

## A document's life, as your code hears it.

- Sent: documents.document.sent
- Opened: documents.document.opened
- Signed: documents.document.signed
- Executed: documents.document.executed

## Three ways teams use it.

**A signing step in your product.** Your server asks for a session, your page shows the signer, and your code hears the completed event. The signer never leaves your site.

**Paperwork without a developer.** A property manager picks the lease addendum, adds the tenant, sends it and keeps the sealed copy. No code, no account for the tenant.

**An assistant that drafts.** An agent prepares the document from a template and a person reads it and presses send.

## The documentation behind each feature.

Every page above has a matching guide for the people who build with it.

- [Quickstart](/docs/quickstart): A test key, a send and a webhook in about ten minutes.
- [Templates and text tags](/docs/templates-and-text-tags): Write fields into a file and they place themselves.
- [Payments in the API](/docs/search-and-payments): List payments and refund with a reason.
- [Embedding](/docs/embedding): The elements, the allow list and the events.
- [MCP and the Claude plugin](/docs/mcp-and-skills): Connect an assistant and set a draft-only key.
- [Test mode](/docs/test-mode): Keys, watermarks and the listen command.

## Questions

**Do the features work from the API as well?**

Yes. Everything in the app has an API call, and the same events reach your webhooks.

**Is there a free plan?**

Yes. Free covers real work: 15 documents a month, with test mode, the API and webhooks.

**Can I try it without an account?**

Yes. The demo gives you a real workspace for 24 hours with no sign-up, and nothing in it is ever emailed.

**Do I need to write code to use any of this?**

No. Every feature on this page works in the app, and the demo lets you click through it with no sign-up. The API, SDKs and command line are there for the day you want to put signing inside your own product.

**What does it cost?**

Free is 15 documents a month with test mode, the API and webhooks. Pro is one flat price for the whole workspace, and the page for pricing has the full table.


## Keep reading

- [How it works](/features/how-it-works)
- [Templates](/free-templates)
- [Pricing](/pricing)
