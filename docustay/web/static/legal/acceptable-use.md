---
title: Acceptable use
description: What you may and may not send through Docustay: no unlawful, deceptive or harmful use, no attempt to break the service, and what we do when a rule is broken.
---

# Acceptable use

What you may and may not do with Docustay. This text is general information, not legal advice.

## Anything you send or store.

These rules apply to every workspace, signer and API key. They sit beside the terms of service.

## Six things.

Do not use Docustay to send anything unlawful, to deceive a signer about what they are signing, or to forge a signature or an identity.

Do not send spam or bulk email to people who did not expect it.

Do not try to break, probe or overload the service, or reach another workspace's data.

Do not use another person's name or email to sign for them.

Do not upload malware or content you have no right to share.

Do not resell or embed the hosted service without a commercial licence.

## A warning first, when we can.

If a rule is broken we may pause a send, remove content, or end the account. Where we can, we say why first. To report a problem, write to abuse@docustay.app.

## Told before they apply.

When these rules change we update this page, and tell workspace owners when the change matters to them.

## Everyone who sends, signs or builds on Docustay.

These rules cover three kinds of people. Senders use Docustay to send documents. Signers receive them and never need an account. Developers call the API, the SDKs, the command line, the webhooks or the MCP server with a key. The rules for one group sit beside the rules for the others, and a sender is responsible for what their documents, emails and integrations do.

The short version: send things people expect, say truthfully what they are signing, keep the people you send to safe from tricks and spam, and do not use the service to harm it or anyone else. The rest of this page explains what that means in practice and what happens when a rule is broken.

## Content and purposes that are not allowed.

You may not use Docustay to create, send, store or collect anything that is unlawful where you or the signer are, or that you have no right to share. In particular:

## Not for protected health information yet.

Docustay is not for protected health information yet. Do not use a workspace, a form or an upload to collect or store it, and do not describe your use of Docustay to your own customers as suitable for it. If you are unsure whether a document counts, leave it out of Docustay until we say the product is ready for it.

## A signer should know what is happening and who is asking.

The person you send a document to is trusting an email from you. Keep that trust: use your own real name or organisation as the sender, say in the message what the document is, and give a way to reach you. Docustay lets a signer decline and records the steps of each document in an audit log; do not work around either.

Do not pressure people with false deadlines, and do not set an expiry that is meant to catch someone out. Do not ask a signer to sign a blank document or one with fields left open to be filled in later without their knowledge. If a signer declines, or says they did not expect the document, stop sending to them.

A signed document is a record. Do not void or replace a document to hide that it was signed, and do not ask Docustay to remove a signed record to deceive someone.

## Only to people who should receive it.

Docustay sends email only about a document your workspace made, to the people named on it. You may not add people to a document in order to send them something else, use the message field for advertising, or send to a list of addresses you bought or scraped.

Sending pauses on its own for a workspace when about 2 percent of its recent email bounces or about 0.05 percent is reported as spam, once at least 50 emails have gone out in 30 days. This protects your domain's name and ours. If it happens, look at the email log under Developers, remove the addresses that bounced, and write to us at abuse@docustay.app to restart sending. Do not respond by creating new workspaces to continue the same list.

A self-hosted install that sends from its own domain or mail server is also responsible for that domain's reputation and for keeping its records correct.

## Do not break it, probe it or get around it.

You may not try to reach another workspace's data, test the service for weaknesses on live customers' documents, overload it, or use it to attack anything else. You may not reverse-engineer the hosted service, or use automation to create accounts, bypass the bot check on the sign-up page, or avoid a plan limit by spreading one organisation's use over many free workspaces.

Limits exist so that one customer cannot harm the others: each API key may make 600 requests a minute, a request body to the API is limited to 1 MB, and uploaded files are limited by plan. When you meet a limit the API answers with a clear status and a retry time; wait and retry rather than opening more keys. The sign-in, public signing, download and verification pages are also limited per address.

If you find a weakness, please report it to security@docustay.app rather than using it. Reporting in good faith, without reading other customers' data or disrupting the service, is welcome.

## Your key is your responsibility.

A key can do what its scopes allow, so give each integration only the scopes it needs, keep keys out of public code and pages, set an expiry and an address allowlist where you can, and revoke a key you think has leaked. Do not share a key between unrelated organisations or sell access to one.

Use a test key for practice. A document made with a test key is emailed only to the sender and carries a TEST watermark; do not use test documents as real agreements, and do not use test mode to avoid the limits that apply to live use.

Webhook receivers must verify the signature on every delivery. If you build a service on Docustay for other organisations, you remain responsible for how it is used.

## A person stays in charge.

Scribe and Find fields with AI send the text or page pictures of a document to an AI model, only when someone uses the feature and only for that request. Do not use them to produce content that breaks these rules, to impersonate another person, or on documents you have no right to process.

An agent that acts through a key should use a draft-only key. With one, a request to send files an approval that a person decides in the app, and nothing is emailed until they approve. Do not build an agent that tries to get around that step, hides what it is doing from the person approving, or retries after a refusal or a rate-limit answer.

## A warning first, when we can give one.

We may take the smallest step that stops the problem. Depending on what happened, that can be: pausing a send, revoking a key, removing a document or a link, limiting a workspace, or ending the account. Where it is safe to do so we say what rule was broken and what to change, and we give you a chance to fix it. For serious or repeated cases, or where there is risk to a signer, to other customers or to the service, we may act first and explain afterwards.

We do not remove a signed document because a rule was broken. A record of what was signed stays what it is, and the Privacy Policy and Terms say how workspace data is exported and deleted if an account ends.

If you think we made a mistake, write to abuse@docustay.app with the workspace name and what you were doing, and we will look again.

## How to tell us.

If you received a document that looks like fraud or harassment, do not sign it, and write to abuse@docustay.app with the email you received and, if you have it, the document link. Do not forward the signing link to others, since it is meant for you. If you think someone is in danger, contact your local emergency services first.

For anything about your own information, see the Privacy Policy. For a security weakness, write to security@docustay.app.

## Plain language, not legal advice.

This page states the rules for using Docustay and describes what the product does when they are broken. It is general information and not legal advice, and it does not promise any particular legal outcome. It sits beside the Terms of Service, which govern in the same way for hosted use. Self-hosted installs run the AGPL-3.0 code under its licence, and the operator of an install sets the rules for their own users.


## Keep reading

- [Privacy policy](/legal/privacy-policy)
- [Cookies](/legal/cookies)
- [Data processing addendum](/legal/dpa)
- [Refunds and cancellation](/legal/refunds)
- [Renewal terms](/legal/renewal)
