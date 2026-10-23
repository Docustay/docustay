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
| `amount`, `currency` | For `payment`: a fixed amount, `amount=150.00;currency=usd`. A payment takes a fixed `amount` (see Payments below) |

A value that holds a semicolon or an equals sign goes in double quotes: `default="Smith; Jones"`.

## From HTML

`POST /api/v1/templates/html` with `{ "name", "html", "paper" }` prints your HTML to a PDF and places a field wherever a tag sits. Scripts, styles that load anything, frames, forms and remote addresses are removed before printing; pictures must be `data:` addresses; the whole request, pictures included, may be up to 1 MB (a larger one gets `413` "request body too large"). The answer is `{ templateId, fields, warnings }`. A tag that could not be read comes back in `warnings`, naming that tag.

## From a document source

`POST /api/v1/templates/source` with `{ "name", "source", "profile", "paper" }` keeps a document written in the shared editor's JSON format (`{ "type": "doc", "content": [...] }`) as a template. `profile` is `typeset` (default) or `contract`; `paper` is `letter` or `a4`. Needs the `documents:write` scope and an `Idempotency-Key`. Answers 201 with `{ templateId, profile, version, hash, warnings }`.

```bash
curl -X POST https://docustay.app/api/v1/templates/source \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "name": "Notice", "source": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }, { "type": "signatureBlock", "attrs": { "slots": [{ "role": "Client", "label": "Client signature" }] } }] } }'
```

## Ask for an AI draft

AI drafting is off by default; it is refused plainly while it is off for your workspace or when a limit is reached. A draft is a suggestion for a person to read: nothing is saved or sent.

`POST /api/v1/documents/ai/draft` with `{ "prompt", "mode" }` (`mode` is `template` or `document`) answers 202 with `{ jobId, state }`.

```bash
curl -X POST https://docustay.app/api/v1/documents/ai/draft \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
  -d '{ "prompt": "A one-page services agreement with a client signature", "mode": "template" }'
```

`GET /api/v1/documents/ai/jobs/{id}` returns `{ id, state, message, source, patches }`. `state` is `queued`, `running`, `done`, `failed` or `cancelled`; poll until it is not queued or running. When done, `source` is the draft and `patches.notes` lists what to check.

```bash
curl https://docustay.app/api/v1/documents/ai/jobs/$JOB_ID -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## From a file

`POST /api/v1/templates/file` with `{ "name", "fileName", "file" }` where `file` is the base64 of a PDF file with tags written in it. Tags are found in the file's text, covered with a white box and replaced by the field. The box covers the tag on the page, but its characters stay in the file's hidden text layer, so a search or a copy of the signed PDF can still find them. If that matters, set the tags in white in your source file, or make the template from HTML, which never prints them.

## Check the seats

`GET /api/v1/templates/{id}` returns the template's `seats`. Send with one `parties` entry per seat: `{ "seat": "signer_1", "name": "…", "email": "…" }`.

## Payments

A `payment` field makes the signer pay on Stripe's own page before their signature completes. The money goes to **the Stripe account you connect** (Settings → Payments → Connect Stripe; Stripe's own sign-up page creates it in your name, separate from any Stripe account you already have). Docustay's fee is 2% of each payment on the Free plan and 0% on Pro, on top of Stripe's own fees, which Stripe charges to that Stripe account as usual. Card details are typed on Stripe's page; Docustay never receives or stores them.

A payment field takes one fixed amount. To charge a different amount for each document, use `amount=custom.key` and give the amount when you send:

| Amount | Tag | Notes |
|---|---|---|
| Fixed | `amount=150.00` | 0.50 to 999,999.99 |

## A tag in an HTML file, sent through the API

```bash
curl -X POST https://docustay.app/api/v1/templates/html \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{ "name": "Services agreement", "html": "<p>Client: {{Client signature;type=signature;role=Client}}</p>" }'
```
