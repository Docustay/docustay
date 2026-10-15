# Templates and text tags

A **text tag** is written inside the document's own text where a field should go:

```
{{Buyer signature;type=signature;role=Buyer}}
```

The first part is the name. After it come `key=value` pairs separated by semicolons. A tag needs at least one `key=value`; `{{signer.name}}` with none is a merge field and is left alone.

| Key | Meaning |
|---|---|
| `type` | `signature`, `initials`, `date_signed`, `stamp`, `text` (default), `number`, `date`, `email`, `phone`, `zip`, `checkbox`, `dropdown` (or `select`), `multiselect`, `image`, `file`, `payment` |
| `role` | Who fills it in, any words. The first role written is `signer_1`, the next `signer_2`, and so on |
| `required` | `true` (default) or `false`. A required checkbox must be TICKED to sign, so give a box the signer may leave empty (a choice, such as "you may use my name") `required=false` |
| `default` | A starting value. Not allowed on signature, initials, date_signed or stamp |
| `options` | A comma list for dropdown and multiselect: `options=Monthly,Yearly` |
| `label` | The caption the signer sees (default: the name) |
| `width`, `height` | Size in points (1/72 inch); each type has a default |
| `max_length` | Most characters a text field takes |
| `filled` | `signer` (default) or `sender`. `filled=sender` is a box you fill in before sending: your organisation's own details and the terms you set (the trip on a permission slip, the fee in an agreement). The person signing sees your answer and cannot change it. It goes on text, dropdown and multiselect boxes; it makes no seat of its own. A required one with no answer stops the send, and a form with one cannot go live until it has its answer |
| `from` | With `filled=sender`, where the first answer comes from: `org.name`, `org.email`, `sender.name` or `sender.email`, worked out when you send. You can still type over it before sending |
| `amount`, `currency` | For `payment`: a fixed amount, `amount=150.00;currency=usd`. A payment takes exactly one of `amount`, `formula`, `price` or `link` (see Payments below) |
| `formula` | For `payment`: an amount worked out from other fields, `formula=quantity*unit_price*(1+tax/100)` |
| `price` | For `payment`: a Stripe price on the connected Stripe account, `price=price_1AbC…` |
| `link` | For `payment`: a Stripe payment link from the connected Stripe account, `link=https://buy.stripe.com/…` |

A value that holds a semicolon or an equals sign goes in double quotes: `default="Smith; Jones"`.

## From HTML

`POST /api/v1/templates/html` with `{ "name", "html", "paper" }` prints your HTML to a PDF and places a field wherever a tag sits. Scripts, styles that load anything, frames, forms and remote addresses are removed before printing; pictures must be `data:` addresses; up to 2 MB. The answer is `{ templateId, fields, warnings }`. A tag that could not be read comes back in `warnings`, naming that tag.

## From a document source

`POST /api/v1/templates/source` with `{ "name", "source", "profile", "paper" }` keeps a document written in the shared editor's JSON format (`{ "type": "doc", "content": [...] }`) as a template. `profile` is `typeset` (default) or `contract`; `paper` is `letter` or `a4`. Needs the `documents:write` scope and an `Idempotency-Key`. Answers 201 with `{ templateId, profile, version, hash, warnings }`.

```bash
curl -X POST https://docustay.app/api/v1/templates/source \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "name": "Notice", "source": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }, { "type": "signatureBlock", "attrs": { "slots": [{ "role": "Client", "label": "Client signature" }] } }] } }'
```

## Ask for an AI draft

AI drafting is off by default; it is refused plainly while it is off for your workspace or when a limit is reached. A draft is a suggestion for a person to read: nothing is saved or sent.

`POST /api/v1/documents/ai/draft` with `{ "prompt", "mode" }` (`mode` is `template` or `document`) answers 202 with `{ jobId, state }`.

```bash
curl -X POST https://docustay.app/api/v1/documents/ai/draft \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Content-Type: application/json" \
  -d '{ "prompt": "A one-page services agreement with a client signature", "mode": "template" }'
```

`GET /api/v1/documents/ai/jobs/{id}` returns `{ id, state, message, source, patches }`. `state` is `queued`, `running`, `done`, `failed` or `cancelled`; poll until it is not queued or running. When done, `source` is the draft and `patches.notes` lists what to check.

```bash
curl https://docustay.app/api/v1/documents/ai/jobs/$JOB_ID -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## From a file

`POST /api/v1/templates/file` with `{ "name", "fileName", "file" }` where `file` is the base64 of a PDF file with tags written in it. Tags are found in the file's text, covered with a white box and replaced by the field.

## Check the seats

`GET /api/v1/templates/{id}` returns the template's `seats`. Send with one `parties` entry per seat: `{ "seat": "signer_1", "name": "…", "email": "…" }`.

## Payments

A `payment` field makes the signer pay on Stripe's own page before their signature completes. The money goes to **the Stripe account you connect** (Settings → Payments → Connect Stripe; Stripe's own sign-up page creates it in your name, separate from any Stripe account you already have). Docustay's fee is 2% of each payment on the Free plan and 0% on Pro, on top of Stripe's own fees, which Stripe charges to that Stripe account as usual. Card details are typed on Stripe's page; Docustay never receives or stores them.

A payment field takes exactly one way of setting the amount:

| Amount | Tag | Notes |
|---|---|---|
| Fixed | `amount=150.00` | 0.50 to 999,999.99 |
| Formula | `formula=quantity*unit_price*(1+tax/100)` | Numbers, the names of other text fields filled by the same person, `+ - * /` and brackets. Nothing else is read, and nothing is run. The server works the amount out from the values the signer typed and the answers you gave in `filled=sender` boxes; the browser never sends an amount. If the person changes a number after paying, signing is refused. |
| Stripe price | `price=price_1AbC…` | A one-time price on your connected Stripe account. The amount comes from Stripe. |
| Stripe payment link | `link=https://buy.stripe.com/…` | A link from the same Stripe account, with a fixed price. Its items are charged as listed. |

A price or link that cannot be found stops the send, with Stripe's reason, so the signer never meets it. The `payments` list on `GET /api/v1/documents/{id}` shows each payment: status, amount, Stripe's receipt link, refunds, and the Docustay fee (`fee.basisPoints`, `fee.amountMinor`) that was decided when the payment started. A refund returns the fee with it.

## A tag in an HTML file, sent through the API

```bash
curl -X POST https://docustay.app/api/v1/templates/html \
  -H "Authorization: Bearer $DOCUSTAY_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "name": "Services agreement", "html": "<p>Client: {{Client signature;type=signature;role=Client}}</p>" }'
```

## Forms

A form is a template with one person who fills it in and, if you like, one team member who counter-signs. Publish it once and anyone with the link can fill it in and sign; every response is its own signed document. The thirty built-in [form templates](/form-templates) are written with these same tags.
