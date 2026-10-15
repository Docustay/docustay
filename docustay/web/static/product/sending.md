---
title: Send documents for signature
description: Pick a document, say who signs and in what order, and send. Reminders go out until it is done, from your own name and your own email domain.
---

# Send documents that get signed.

Pick a document, say who signs and in what order, and send. Reminders go out until it is done.

## Three decisions before you send.

**Who signs.** Add each person by name and email. Besides signers there are approvers, viewers and a copy-only role.

**Where they sign.** Place each field on the page, or let the template do it. A field belongs to one person only.

**How they sign.** By emailed link, in person on your screen, or inside your own website.

## Reminders until it is done.

- Day 0: Sent
- Day 3: Reminder
- Day 7: Reminder
- Day 14: Signed · reminders stop

## Email that comes from you.

Documents and emails carry your logo and colours. Send from your own domain, your own mailbox or your own mail server, and change the words of all eight emails Docustay sends about a document.

- A live preview and a test send for each email, in each language.
- On Pro, signing links can sit on your own web address.

## The same thing from your code.

```
import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
});
console.log(doc.id, doc.state);
```

- **Free**: 15 documents and 5 new templates a month
- **Uploads**: 25 MB on Free, 100 MB on Pro
- **Files**: PDF files only

## Questions

**Can I send to a whole list?**

Yes, on Pro. Upload a spreadsheet with a name and an email on each row and Docustay sends one document to each person.

**Can someone sign in person?**

Yes. Hand a phone or tablet across the desk and they sign on your screen, with no email at all.

**Does a reminder cost anything?**

No. Reminders, resends and test sends never count toward your documents.


## Keep reading

- [Signing order](/product/signing-order)
- [Tracking](/product/tracking)
- [The API](/developers/api)
