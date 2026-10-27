# Quickstart

## Time to first signature

The goal is a first signed document within 30 minutes. In order: make a key (below), make a template (step 1), send it to yourself (step 2), open the signing email and sign, then read the executed document (step 3). Use a test key first, then a live one. In a scripted run on our test environment (sign-up, key, template, send, email, sign) the product's own waiting time was about 20 seconds, so almost all of your time is reading and writing the template.

You need a Docustay workspace and a key. In the app open **Settings → Developers → API keys** and make a key with the scopes `documents:read` and `documents:write`. Make a **test** key first (it starts `dsk_test_`): everything it does is a practice run.

> A test key works in any workspace, whether or not test mode is switched on: everything it sends is a practice run, emailed only to you and stamped TEST. If your first request answers `401`, check that you copied the whole key and that it is a key of this workspace.

> The examples use `https://app.docustay.app`. A self-hosted install or a practice server has its own address: put that address in the commands instead, and pass it to the SDKs as `baseUrl` (JavaScript) or `base_url` (Python).

## 1. Make a template

A template is a document with places for people to sign. The quickest way is HTML with text tags (see [Templates and text tags](/docs/templates-and-text-tags.md)):

```bash
curl -X POST https://app.docustay.app/api/v1/templates/html \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Simple NDA","html":"<h1>Mutual NDA</h1><p>Both parties keep each other'"'"'s information private.</p><p>Signed: {{Sign here;type=signature;role=Partner}}</p>"}'
```

The answer holds the `templateId` and how many `fields` were placed.

## 2. Send it

```bash
curl -X POST https://app.docustay.app/api/v1/documents/send \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"templateId":"'"$DOCUSTAY_TEMPLATE_ID"'","title":"NDA with Acme","parties":[{"seat":"signer_1","name":"Alex Rivera","email":"alex@example.com"}]}'
```

`seat` is the template's seat key. Seats appear in the order roles first appear in the document: the first role is `signer_1`, the next `signer_2`. `GET /api/v1/templates/{id}` lists them.

## 3. Follow it

```bash
curl https://app.docustay.app/api/v1/documents/$DOCUSTAY_DOCUMENT_ID -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

`state` moves `sent` → `partially_signed` → `executed` (or `declined`, `expired`, `void`). When it is `executed`, `GET /api/v1/documents/{id}/signed.pdf` returns the sealed copy. The sealed PDF is made a few seconds after the last signature (the document says `signedCopyAvailable: true` once it exists); until then the call answers 404 "the sealed copy is being made", so ask again after a moment, or wait for the `documents.document.executed` webhook.

## The same in code

Install the SDK first. Node 18 or later: `npm install @docustay2026/sdk`. Python 3.9 or later, in a virtual environment:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install docustay
```

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const { templateId } = await docustay.createTemplateFromHtml({ name: "Simple NDA", html: "<p>Signed: {{Sign here;type=signature;role=Partner}}</p>" });
const { id } = await docustay.sendDocument({ templateId, parties: [{ seat: "signer_1", name: "Alex Rivera", email: "alex@example.com" }] });
console.log((await docustay.getDocument(id)).state);
```

```python
import os
from docustay import Docustay
d = Docustay(os.environ["DOCUSTAY_API_KEY"])
t = d.create_template_from_html("Simple NDA", "<p>Signed: {{Sign here;type=signature;role=Partner}}</p>")
doc = d.send_document(t["templateId"], [{"seat": "signer_1", "name": "Alex Rivera", "email": "alex@example.com"}])
print(d.get_document(doc["id"])["state"])
```

Next: [get told when it is signed](/docs/webhooks.md) instead of asking.

The same first call in Go, PHP and C# is on the [SDKs page](/docs/sdks.md#other-languages).

## Check your key before you start

Two ways to confirm a key works without sending anything. The command line saves it and asks the API who it belongs to:

```bash
npx docustay login --key "$DOCUSTAY_API_KEY"
npx docustay whoami
```

Or send a practice document from a template in one line, with your own address as the signer (a test key emails only you):

```bash
npx docustay send --test $DOCUSTAY_TEMPLATE_ID --party "signer_1=Alex Rivera <you@example.com>"
```

## If a step fails

- `401` on any call: one answer covers a missing, wrong, revoked or out-of-scope key. Check the whole key was copied and that it has `documents:write` for steps 1 and 2.
- `400` on step 2: the message names the field. A `seat` that is not on the template is the usual cause; read the seats with `GET /api/v1/templates/{id}`.
- `403` on step 1 or 2: the Free plan has a monthly allowance for new templates and sent documents, and the error carries `plan_template_limit` or `plan_document_limit`. Test-mode documents are never counted.
