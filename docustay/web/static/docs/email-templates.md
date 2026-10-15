# Email templates

Docustay sends email only about a document your workspace made, and only to the people named on it. You control the words of all eight messages.

## The eight messages

| Message | Goes to | Has the sign button |
|---|---|---|
| Signing invitation | each person asked to sign | yes |
| Reminder | a person who has not signed yet | yes |
| Completed copy | everyone, when the document is fully signed | no |
| Declined | the person who sent the document, when someone declines | no |
| Cancelled | people who were asked to sign, when the sender cancels | no |
| Expired | the person who sent the document, when it lapses unsigned | no |
| Verification code | a person opening a document that asks for an email code | no |
| Payment receipt | the person who paid while signing | no |

## What you can change

Open **Settings → Email templates**. For each message you can set the subject, the preview line (the grey text next to the subject in an inbox), the body, the button label and the footer. A **live preview** shows the email with sample values filled in, and **Send me a test** sends it to you. **Reset** goes back to the built-in wording.

Each language has its own wording. If a language has none saved, the built-in wording for it is used.

## Variables

Put a variable in double curly brackets, for example `{{signer.name}}`. Each message lists the variables it may use, and an unknown one is refused when you save. Common ones: `{{signer.name}}`, `{{sender.name}}`, `{{org.name}}`, `{{document.title}}`. The invitation and reminder also have `{{link}}`; the code message has `{{code}}` and `{{minutes}}`; the receipt has `{{amount}}` and `{{description}}`.

## For one document only

On the **Details** step of a send you can change the subject and the message for that document alone. From the API you can also set the reply-to address and the sender name, in the `email` object of the send request. See [Email API](/docs/email-api).

## Your own sender

Emails come from Docustay's address by default. To send from your own domain, add it in **Settings → Email**, put the DNS records it shows at your DNS host, and press check. See [Email setup](/docs/email-setup).

## From the API

Read the wording the workspace uses now, change one message, and look at it with made-up names before anyone gets it. A key with the `account:read` and `documents:write` permissions does all three.

```bash
curl https://app.docustay.app/api/v1/email-templates \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

```bash
curl -X PUT https://app.docustay.app/api/v1/email-templates/invitation \
  -H "Authorization: Bearer $DOCUSTAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"locale":"en","subject":"{{sender.name}} sent you {{document.title}} to sign","buttonLabel":"Review and sign"}'
```

`DELETE` on the same address goes back to the standard wording, and `POST` to `/preview` returns the email as it would look.
