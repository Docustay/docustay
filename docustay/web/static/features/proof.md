---
title: Certificate of completion for every signed PDF | Docustay
description: Every finished document is sealed with a certificate of completion that lists who signed and when. Anyone can verify a copy without an account.
---

# Proof anyone can check.

The certificate of completion on the last page of every signed PDF lists who signed and when. The whole file is sealed, so a later change shows, and anyone can verify a copy with no account.

## Four things travel with the file.

**The seal.** A digital seal over the whole PDF, so any later change shows.

**The fingerprint.** A SHA-256 hash of the document, printed on the certificate.

**The record.** Each action with its time, address and browser, kept with the document.

**The signers.** Each person's name, email and role, and the wording they agreed to.

## Five layers, one sealed file.

The page, the fields, the signatures, the seal and the certificate are one PDF. Change any layer and the seal no longer matches.


## Every step, with its time. Every signature, with its hash.

- Sent: 09:14
- Opened: 09:17
- Signed: 09:20 · hash c093
- Sealed: 09:58 · hash 9f2c

## What the certificate shows, and how to check it.

- **Who**: Each person's name, email and role
- **When**: The time of each action, local and UTC
- **From**: The address and browser of each action
- **Agreed**: The exact wording they agreed to
- **Fingerprint**: A hash of the document, so a change shows

- **Drop**: A signed PDF onto the verify page
- **Check**: The seal is valid and the file is unchanged
- **Read**: Who signed, and when
- **Private**: The check runs in your browser; the file is not uploaded

## Change one letter and the chain breaks.

In the signature record, each hash covers its own text and the hash before it. Edit any record below and watch every later record stop matching.


## What a Docustay signature is, and what it is not.

- **Kind**: A simple electronic signature with a strong record and a digital seal
- **Record**: Intent, consent, who, when, from where, and the file's hash
- **Seal**: A digital signature over the whole file, with a trusted timestamp when the time service answers

- **Qualified**: Not a qualified electronic signature
- **Identity**: No identity documents or knowledge checks
- **Advice**: No legal advice and no promise about any outcome

## The last page tells the whole story.

It lists who signed, when, and a hash of the file, on the PDF itself. It does not need Docustay to be read.

**Who and when.** Each person's name and the time of each signature.

**The fingerprint.** A hash of the document, so a later change shows.

## Every step is a row you can export.

Sent, opened, signed, sealed: each is written down with its time, and the whole log downloads as a CSV.

**Same names.** The events are the ones webhooks send, so your system and the record agree.

## You do not have to take our word for it.

Drop a signed PDF on the verify page. It checks the seal in your browser, with no account, and says whether the file is intact, whether it carries a trusted timestamp, and what its fingerprint is. Who signed and when is on the certificate page inside the file.

The seal is a digital signature over the whole file. If anyone changes the file afterwards, it no longer matches.

## Three checks, and what they do not prove.

The verify page re-reads the signature inside the PDF. A forger who only copies the right digest into a fake signature fails the second check.

- **1 · The digest**: The digest the signer signed must equal the digest of the file's signed byte ranges.
- **2 · The signature value**: The signature over the signed attributes must verify with the public key of the certificate inside the file.
- **3 · The end of the file**: The last signed range must reach the end of the file, or what follows is only Docustay's own validation material. A page appended after sealing fails.
- **Whose seal**: The verifier reports the certificate that sealed the file and says known when its fingerprint is on Docustay's published list, unknown otherwise.
- **What it does not say**: The seal is a self-signed certificate. A pass means this exact signature was made by that key over this exact file. It does not mean an outside authority vouches for who signed.

## What the certificate can show, and what you can leave off.

| Part | What is printed | Owner setting |
| --- | --- | --- |
| Timeline | Each step in time order: sent, opened, reminded, agreed to sign, signed, completed. | On or off |
| Network address | The address each signer opened and signed from. | On or off |
| Device and browser | The device each signer used. | On or off |
| Document fingerprints | A hash of the original file. | On or off |
| Consent record | That each person agreed to sign electronically: the version, time, address and device. | On or off |
| Closing statement | A sentence at the bottom saying the document was sealed with a digital signature when the last party signed. | Editable, up to 600 characters |

Also on it when they apply: the reason a person gave, who a seat was passed on from, what each signer paid with Stripe's reference, and a signature ID. The certificate is the last pages of the PDF, or a second sealed PDF if you switch that setting.

## Evidence you can hand to someone else.

**The evidence package.** Once a document is executed, a team member can download one zip: original.pdf, signed.pdf, audit-log.csv, evidence.json and a README. evidence.json lists every signature with its hashes and every file with its SHA-256.

**A signature ID.** The first 12 characters of a signature record's own hash, in three groups of four, printed beside the signature when the owner turns it on. Anyone can recompute it from the record.

**How long it is kept.** Signed documents stay in your workspace, and you can download the sealed copy and its audit log at any time.

## Download the sealed copy from your own code.

```
curl https://docustay.app/api/v1/documents/$DOCUSTAY_DOCUMENT_ID/signed.pdf \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -o signed.pdf
```

## On your own server, the seal is yours.

A self-hosted install makes a signing certificate for itself at first run. Set your own to use one from a trusted authority, and point it at a timestamp authority so finished documents carry a trusted timestamp.

A Docustay signature is a simple electronic signature with a strong record and a digital seal. There are no qualified signatures, no identity checks and no legal advice.

## Keep going with the next piece.

- [Tracking](/features/how-it-works#prove): The same events as a list and a CSV.
- [Signing](/features/how-it-works#sign): Settings that decide what ends up on the certificate.
- [Check a PDF](/verify): Drop a signed file on the verify page.

## Questions

**What if the time service is down?**

The file is still sealed, and the certificate says the timestamp was not added. We never claim a timestamp we do not have.

**Can I download the sealed copy again?**

Yes. It is stored with the audit trail, and everyone who signed was emailed a copy.

**Will every PDF viewer show the seal as valid?**

Some viewers show validity as unknown until they are told to trust our sealing certificate. The verify page is the supported way to check a file.


## Keep reading

- [Legal validity](/trust/legal-validity)
- [Proof of signing](/trust#proof)
- [Your documents in the API](/developers/api)
