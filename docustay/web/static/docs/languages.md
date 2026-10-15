# Languages

A document is sent in one language, and everything the signer sees follows it: the signing page, the signing and reminder emails, the signed-copy email, and the Certificate of Completion at the end of the sealed PDF.

| Code | Language | Code | Language |
|---|---|---|---|
| `en` | English | `pl` | Polish |
| `es` | Spanish | `tr` | Turkish |
| `fr` | French | `ru` | Russian |
| `de` | German | `ar` | Arabic (right to left) |
| `pt` | Portuguese | `ja` | Japanese |
| `it` | Italian | `zh` | Chinese (simplified) |
| `nl` | Dutch | `ko` | Korean |

Set it with `language` when you send (`POST /api/v1/documents`), or pick it in the Send step of the app. If you leave it out, the document goes in English.

## Beta

Every language except English is a **machine-written draft**, marked Beta on the signing page and in the Send step. It is meant to be understood, not to be the final word. The text you write yourself (your document, your message) is never translated.

## Fonts

The Certificate of Completion is drawn in Noto Sans for languages the standard font cannot draw (Cyrillic, Latin Extended, Japanese, Chinese, Korean), and in IBM Plex Sans Arabic for Arabic. The fonts are all licensed under the SIL Open Font License 1.1 and are bundled as font files, not code. Japanese, Chinese and Korean carry the characters of the standard national lists, so a rare character in a name can fall back to a blank box.

## Choosing a language when sending

```bash
curl -X POST https://docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "templateId": "TEMPLATE_ID", "language": "es", "parties": [{ "seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com" }] }'
```

```js
await docustay.sendDocument({ templateId: "TEMPLATE_ID", language: "ar", parties: [{ seat: "signer_1", name: "Layla Haddad", email: "layla@example.com" }] });
```

## Right to left

Arabic pages and emails are laid out right to left. The Certificate of Completion draws Arabic in joined letterforms, and the text in the PDF can be selected and copied in reading order.
