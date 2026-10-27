---
title: Trust centre: security, privacy and proof
description: Security, privacy and data handling, proof of signing and the companies that help us run Docustay, on one page. What is in place today and what is not. No certification is claimed.
---

# Trust centre

What is in place today, and what is not, on one page. We write claims as facts about what the product does.

## What we do, and what we do not.

- **Separate**: Each workspace's rows are separated in the database itself
- **Seal**: A digital signature over every finished PDF
- **Record**: Each action with its time, address and browser
- **Back up**: The database is backed up daily to a separate location; we do not test restores on a schedule

- **Certify**: No audit or certification is done and none is claimed
- **Read**: Docustay staff do not read your documents
- **Sell**: We do not sell data or train a model on your documents
- **Advise**: Nothing here is legal advice

## What is in place.

Data in transit travels over TLS, and the site tells browsers to use it every time (HSTS).

Each workspace's data is separated from every other's by row-level rules in the database itself, forced on for every table that holds workspace data, not only in the application. The application connects as a role that cannot switch them off.

People sign in with a password, an emailed code or a passkey. Everyone can turn on two-step sign-in with an authenticator app, and an owner can require it for the whole team. Sessions can be listed and ended, and a workspace can sign people out after a period without activity.

Signed documents are sealed with a digital signature.

Secrets we store for you (webhook signing secrets, two-step secrets) are sealed with AES-256-GCM under a key kept apart from the database. Requests are rate-limited. Signing links are single-purpose tokens that are not kept in the address bar after load.

Every file we store for a workspace (uploaded PDFs, the signed and sealed copies, certificates and printed templates) is encrypted with AES-256-GCM before it is written to storage, under a data key that belongs to that workspace alone. Each workspace's key is itself sealed under a platform key kept outside the database, and a file is bound to its workspace and its place in storage, so a file copied into another workspace, or to another path, does not open. Keys can be rotated: a background job moves a workspace's files onto the new key, and the old key is kept so an older backup still opens. A restored copy of the database together with a copy of the storage opens the files; either one alone does not, and neither does the database with a different platform key.

Server logs leave out email addresses and credentials. A dependency check runs before each release and stops it on a known serious flaw that reaches the code.

The database is backed up every day to a separate storage location, and those backups are deleted after 30 days. We do not currently test restores on a schedule. When a backup is restored, the recorded deletions are carried out again, so a deleted person or workspace does not come back.

Not yet: no outside audit, certification or penetration test has been done and none is claimed. There is no bug-bounty programme. The file encryption above does not cover the database itself (that depends on the disk the host provides), staff photos, brand logos or data exports, and the platform key protects the workspace keys only as well as the place it is kept.

## People, roles and two-step sign-in, from one screen.

Two-step sign-in is offered to everyone; an owner can require it for the whole team, and sessions can be listed and ended.

**Roles.** Each person has the access you assign.

## Keys, scopes and signed webhooks.

- **Shown once**: A key is shown when it is made and stored only as a digest, so we cannot read one back.
- **Scopes**: You tick the scopes a key carries, from documents:read down to one-job scopes.
- **Limits**: A key can expire and can be limited to addresses. Each key has its own per-minute budget; over it the API answers 429 with Retry-After.
- **Test keys**: dsk_test_ keys act on test data only.

- **Signed**: Every delivery carries the Standard Webhooks headers and an HMAC-SHA256 signature you check with the endpoint's secret.
- **Public only**: Webhooks go only to a public https address; local and office network addresses are refused.
- **Idempotent**: Send an Idempotency-Key and a retried POST does the work once.
- **Audited**: Every use of a key is in the audit log with the key's name.

## What we collect, where it lives, how long it stays.

We collect four kinds of information. Your account details. The documents you upload. The names and email addresses you type for signers. The record of each signing: time, address, browser and the wording agreed. Payment card details are never collected by Docustay; payments use Stripe's hosted page.

Your workspace's people see what you assign them. Signers see only their own document. Docustay staff do not read your documents.

The hosted service runs in the United States on Railway. You cannot yet choose a region. The self-hosted edition runs wherever you run it.

A signed document is kept for the period you set, or indefinitely if you leave it empty, and cannot be deleted one by one inside that period. Unsigned drafts are yours to delete. The API call log is kept 30 days.

Take it with you. Download any signed copy as a PDF. Export a document's audit log, the workspace's audit log, and the people list as CSV. Read everything through the API.

Removing it. A member can delete their own account, with a 14-day cooling-off period. An owner can delete the whole workspace, with a 14-day cooling-off period; then everything in it is removed. Backups are deleted after 30 days, and recorded deletions are carried out again after a restore. A record that a deletion happened is kept as a hash, a date and a request id, with no names or addresses.

We do not sell data. We do not use your documents to train a model.

## Where each kind of data is kept.

| Data | Kept at | Also handled by | How long |
| --- | --- | --- | --- |
| Documents, PDFs and field values | Railway (US) | Anthropic, only when a person uses an AI feature | While your workspace exists |
| Audit trail and certificates | Railway (US) | No one else | With the document |
| Sign-in identity | Google (Firebase) | No one else | Until the account is deleted |
| Emails | Resend | No one else | Resend's send log |
| Payments | Stripe | No one else | Stripe's own records |
| Product analytics | PostHog | No one else | Set by PostHog's retention for our project |
| Backups | A separate storage location | No one else | 30 days |

## Docustay is not for protected health information yet.

Docustay is not for protected health information yet. We do not sign Business Associate Agreements, so please do not send protected health information through Docustay.

There is no health mode and no health setting. Every workspace gets the same protections: data travels over TLS, two-step sign-in is offered to everyone, and an owner can require it for the whole team.

Every view, download and export by the team is written to an access log that owners and admins can download, in every workspace.

Running it yourself? The self-host hardening guide is the checklist for sensitive documents: what to switch on, what to keep private and what to check. This is not legal advice.

## What is inside a signed PDF.

- [The record](/features/proof): Every signature is a row in an append-only record whose hash covers the one before it.
- [The seal](/features/proof): A detached PKCS#7 digital signature over the whole file; any later change makes it fail.
- [The certificate](/features/proof): The last page lists each person, the time and address of each act and the SHA-256 fingerprint.

## Each signature's hash covers the one before it.

Change one record and every later hash stops matching.

**Who and when.** The seat, name, email, time, address and browser.

**What was agreed.** The wording the person agreed to.

## A trusted time, and a check anyone can run.

The seal is stamped by a time-stamping authority (RFC 3161), so the time it was sealed is vouched for by someone other than us. If the authority cannot be reached the document is still sealed, and the certificate page says it was not timestamped.

By default the seal comes from a certificate Docustay makes for the deployment, so a reader may say the signer is unverified. Self-hosters set their own.

Anyone can drop a signed PDF on the verify page. It reads the seal and the fingerprint from the file itself and says whether it is intact. The file is not uploaded.

This is a simple electronic signature with a strong evidence record and a tamper-evident seal. It is not a qualified electronic signature and does not check anyone's identity beyond their email address or an access code you share.

## Sign it, seal it, check it.

When the last person signs, the PDF gets a digital signature over the whole file. Anyone can drop the copy on the verify page, with no account.

**Seal.** A digital signature over every finished PDF.

**Check.** The verify page reads the file in your browser; it is not uploaded.

## Nine companies.

- **Railway**: Application and database hosting. All data you store.
- **Google Cloud and Firebase**: Sign-in and supporting infrastructure. Account email and sign-in identifiers.
- **Stripe**: Payments and billing. Billing details and payment references; card numbers go to Stripe directly.
- **Resend**: Sending email. Recipient email address and the message.
- **Anthropic**: The AI model behind Scribe and Find fields with AI. The text or page pictures of a document, only when a person uses an AI feature, and only for that request.
- **Cloudflare**: Delivery of the website and the signing pages, and the bot check on the sign-up page. The visitor's address and browser. Page traffic passes through it in transit.
- **PostHog**: Product analytics. Events about how the website and the service are used, tied to an account id, never document content.
- **Google Analytics**: Website visit statistics, only after you press Accept in the cookie choice. Page visits and a browser identifier, never document content or signer details.
- **A public time-stamp authority (DigiCert by default)**: Trusted timestamp on a signed file. A hash of the document only, never its contents.

## Told before it changes.

Services you connect yourself, such as your own Stripe account, or your own mail server on a self-hosted install, are your choice and are not Docustay sub-processors. When this list changes we update this page and tell workspace owners before the change takes effect.

## Write to us; we read every report.

Found a security problem? Write to security@docustay.app with what you found and how to see it. The same address is in /.well-known/security.txt. Please give us time to fix it before you tell anyone else, and do not read, change or delete other people's data while you test.

A privacy question, or a request about your data: privacy@docustay.app. If a breach affects your workspace, we tell its owners by email and in the product, with what happened, what data and what we have done.

## Questions

**Is there a bug bounty?**

No.

**Do you sell data?**

No.

**Is my data used to train a model?**

No.

**Does Docustay hold a certification?**

No certification of any kind is claimed, and Docustay is not for protected health information yet.

**Can a record be edited?**

Not a signature. Each signature's hash covers the one before it, so a change breaks the chain.

**Does test mode appear?**

Test documents are marked TEST, mailed only to the sender and left out of usage and billing.

**Can I check a signed PDF?**

Yes. Drop it on the verify page. It needs no account.

## The full wording.

- [Is an electronic signature legal?](/trust/legal-validity): What the ESIGN Act and UETA look for, in plain words.
- [Privacy policy](/legal/privacy-policy): What we collect and why.
- [Data processing addendum](/legal/dpa): For workspaces that need one.


## Keep reading

- [Legal validity](/trust/legal-validity)
- [Self-host hardening](/docs/self-host-hardening)
- [Proof](/features/proof)
