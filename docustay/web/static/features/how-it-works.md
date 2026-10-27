---
title: How e-signatures work: from file to sealed copy
description: How e-signatures work in Docustay: create a document, send it, sign on any device, get paid and keep proof anyone can check.
---

# From a file to a sealed copy.

See how e-signatures work, step by step: create a document, send it, get it signed on any device, get paid and keep proof anyone can check. Every step works in the app and from your code.

## Five stages, one flow.

1. **Create**: Template, PDF or words
2. **Send**: Order and reminders
3. **Sign**: Any phone
4. **Get paid**: Inside signing
5. **Prove**: Sealed + certificate

## Start from a template, a PDF or a sentence.

Pick one of 54 templates, upload a PDF and let Find fields place the boxes, or tell Scribe what you need. Then drag each field to where it belongs and give it to a signer.

**Find fields.** Docustay reads a PDF and proposes the signature, date and text boxes. You move or remove any of them.

**Fields.** Signature, initials, date, text, checkbox, dropdown, picture and payment, each given to one signer.

## Say who signs, and in what order.

Add each person by name and email. Send to one person, to a line of people one after another, or to everyone at once. The next person is told only when it is their turn.

**Order.** One at a time or all together, and you can change it before you send.

**Reminders.** Reminders go out until the document is signed, and you set when it expires.

**Send to a list.** Upload a spreadsheet and send one document to each row. Free sends up to 15 at a time.

**Your name.** The email comes from Docustay with your name and your reply-to address.

## Sign on any phone, with no account.

The signer opens the link, reads, fills in what is theirs and signs with a finger or a mouse. It works on any phone or computer.

**No account.** Nothing to install and nothing to sign up for.

**Decline.** A person can decline and say why, and you are told at once.

**Embedded.** Show the same page inside your own product.

## The signer pays as part of signing.

Add a payment field and the signer pays on the same page, straight into your own Stripe account. Docustay checks the amount and never holds the money. The fee is 2% on Free and Pay as you go and 0% on Pro, on top of Stripe's.

**Amount.** One amount you set, paid in full while signing. A deposit is just a smaller amount.

**Fee.** Docustay's fee is 2% on Free and Pay as you go and 0% on Pro.

## Keep a sealed copy that anyone can check.

When everyone has signed, Docustay seals the PDF and adds a certificate of completion: who signed, when, from where, and a hash of the file. Anyone can check a copy with no account.

**Sealed.** The whole file is sealed, so a later change shows.

**Record.** Every action has its time, and the audit trail stays with the document.

**Verify.** Drop a copy on the verify page and get an answer.

## The same flow in two commands.

Send a test document and listen for what happens to it. A test key emails only you and stamps the document TEST.

```
npx docustay login
npx docustay send --test $DOCUSTAY_TEMPLATE_ID --party signer_1="Rosa Alvarez <rosa@example.com>"
```

## Reminders until it is done.

- Day 0: Sent
- Day 3: Reminder
- Day 7: Reminder
- Day 14: Signed, reminders stop

## Email that comes from you.

Documents and emails carry your logo and colour, and every email goes out under your name with your reply-to address. For one document, change the subject and the message on the Details step.

- Your sender name and reply-to address on every email.
- A send-me-a-test button before anything goes out.

## More than signers.

**Signers and approvers.** A signer fills in fields and signs. An approver says yes before the next person is asked, so a manager can clear an offer letter first.

**Viewers and copy-only.** A viewer can read the document, and a copy-only person gets the finished copy without signing.

**An assistant for someone else.** A person can fill in fields on behalf of a signer, such as a receptionist helping at a counter, and the record says so.

## Every stage leaves a record.

| Stage | Who acts | What is kept | What your code hears |
| --- | --- | --- | --- |
| Create | You, or Scribe for you | The document, its fields and who each belongs to | documents.document.created |
| Send | You | Who was sent what, in which order, and when | documents.document.sent |
| Open | The signer | The time, the address and the browser | documents.document.opened |
| Sign | Each signer | The wording they agreed to and a hash of each signature | documents.document.signed |
| Seal | Docustay | The sealed PDF and the certificate of completion | documents.document.executed |
| Stop | You or the signer | Who declined, voided or let it expire, and why | documents.document.declined |

## Eight events cover the whole life of a document.

- Created: documents.document.created
- Sent: documents.document.sent
- Opened: documents.document.opened
- Signed: documents.document.signed
- Executed: documents.document.executed
- Declined: documents.document.declined

## The same flow, wherever you start.

**In the app.** Pick a template, add the people and press send. Everything on this page is a screen you can click through in the demo.

**From your API.** Each stage is one call, and every call can be tried with a test key that emails only you.

**Through an assistant.** An agent can prepare the document and a person approves the send.

## Your documents, your record.

Every signed document is stored with its audit trail, and everyone who signed was emailed a copy. You can download the sealed PDF again from the document page or with one API call.

On the hosted service the files are encrypted at rest. If you run Docustay on your own server, the files stay on that server and nothing is sent to us.

## Questions

**Does the signer need an account?**

No. They open the link and sign.

**Can I do this without writing code?**

Yes. Everything on this page works in the app, and the demo lets you try it with no sign-up.

**Who can see the signed copy?**

Everyone who signed is emailed a copy, and you keep it with its audit trail in your workspace.

**Can I stop a document after it is sent?**

Yes. You can void it, and anyone who was asked to sign is told it was cancelled. A document can also expire on the date you set, and the sender is told when it lapses unsigned.

**Can signers decline?**

Yes. A person can decline and say why, and you are told at once. The decline is part of the record.


## Keep reading

- [Scribe](/features/scribe)
- [Payments](/features/payments)
- [Proof and verify](/features/proof)
