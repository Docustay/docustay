---
title: SDKs
description: Official clients for JavaScript/TypeScript and Python, and generated clients for Go, PHP and C#.
order: 8
---

# SDKs

Both clients cover every operation in the [API reference](/docs/api-reference.md), add an `Idempotency-Key` to every POST and reuse it on retries, retry `429` and `5xx` honouring `Retry-After`, throw a typed error with `status`, `kind` and the request id, page through lists for you and verify webhooks.

| Language | Package | Needs |
|---|---|---|
| JavaScript / TypeScript | `@docustay2026/sdk` | Node 18+, a browser, Deno or Bun; no dependencies |
| Python | `docustay` | Python 3.9+; standard library only |

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
for await (const d of docustay.eachDocument({ state: "executed" })) console.log(d.id, d.title);
```

```python
import os
from docustay import Docustay
d = Docustay(os.environ["DOCUSTAY_API_KEY"])
for doc in d.each_document(state="executed"): print(doc["id"], doc["title"])
```

Other languages: the API is described by an OpenAPI 3.1 file at `/api/openapi.json` and a Postman collection at `/api/docustay.postman_collection.json`.
Frameworks: [`@docustay2026/react`, `@docustay2026/vue`, `@docustay2026/angular`](/docs/embedding.md).

## Pointing at your own server

Both clients talk to `https://app.docustay.app` unless you say otherwise. A self-hosted install, or any other Docustay address, goes in the constructor:

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, { baseUrl: process.env.DOCUSTAY_URL });   // your install, for example https://sign.example.com
const { templates } = await docustay.listTemplates();
console.log(templates.length, "templates on that install");
```

```python
import os
from docustay import Docustay
d = Docustay(os.environ["DOCUSTAY_API_KEY"], base_url=os.environ["DOCUSTAY_URL"])   # your install, for example https://sign.example.com
print(len(d.list_templates()["templates"]), "templates on that install")
```

If the address is wrong and answers with a web page instead of the API, the client throws a `DocustayError` of kind `bad_response` that names the address and this option; it does not show a JSON parse error.

## Installing

Install from the registries: `npm install @docustay2026/sdk` (JavaScript and TypeScript), `pip install docustay` (Python), `go get github.com/docustay/docustay-go/docustay`, `composer require docustay/docustay-php`, `dotnet add package Docustay.Api`. In a new TypeScript project for Node, also run `npm install --save-dev typescript @types/node` so `process.env` compiles. The source is at https://github.com/Docustay/docustay.

## Sending a document

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const doc = await docustay.sendDocument({ templateId: process.env.DOCUSTAY_TEMPLATE_ID, parties: [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }] });
console.log(doc.id, doc.state);
```

```python
doc = d.send_document(template_id=os.environ["DOCUSTAY_TEMPLATE_ID"], parties=[{"seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com"}])
print(doc["id"], doc["state"])
```

## Which client to use

Use the JavaScript and TypeScript client for anything that runs in Node, a serverless function, Deno or Bun, and keep the key on the server. Use the Python client for scripts, back-office jobs and notebooks. Neither needs extra packages, so adding one does not pull a tree of dependencies into your project. If you work in another language, call the REST API directly or use a client generated from the OpenAPI file; every client sends the same requests, so the API reference applies to all of them.

## Keys, test mode and retries

Create a key under Developers and pass it to the constructor. A key that starts with `dsk_test_` works in test mode: it sees only test documents and emails only you (stamped TEST), never the people on the document, so use one while you are building. Because every POST carries an `Idempotency-Key`, a request that times out can be sent again without creating a second document. Let the client do the retrying; add your own loop only for failures it reports as final.

## Handling errors

Both clients throw a typed error with `status`, `kind`, `message` and `requestId`. Catch it, look at `kind`, and decide: `validation` means fix the request, `rate_limited` and `dependency` are retried for you up to a limit, and `conflict` means the document is not in a state that allows what you asked.

## Other languages

Any language can call the REST API directly. The OpenAPI 3.1 file describes every operation. Clients generated from it for Go, PHP and C# (every operation) are published: `go get github.com/docustay/docustay-go/docustay`, `composer require docustay/docustay-php` and `dotnet add package Docustay.Api`. A generated client sends an idempotency key as an argument of each call that creates something, and its answers may carry new fields as the API grows. The Postman collection lets you try each call by hand.

A first call in each (make a template, send it to one person, read it back). Set `DOCUSTAY_API_KEY` first; a `dsk_test_` key makes it a practice run. To use your own install, change the host where shown.

```go
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	docustay "github.com/docustay/docustay-go/docustay"
)

func main() {
	cfg := docustay.NewConfiguration() // hosted: app.docustay.app. Own install: cfg.Servers = docustay.ServerConfigurations{{URL: "https://sign.example.com"}}
	c := docustay.NewAPIClient(cfg)
	ctx := context.WithValue(context.Background(), docustay.ContextAccessToken, os.Getenv("DOCUSTAY_API_KEY"))
	html := "<h1>Mutual NDA</h1><p>Signed: {{Sign here;type=signature;role=Partner}}</p>"
	t, _, err := c.TemplatesAPI.CreateTemplateFromHtml(ctx).IdempotencyKey(fmt.Sprint("t-", time.Now().UnixNano())).HtmlTemplateRequest(*docustay.NewHtmlTemplateRequest("Mutual NDA", html)).Execute()
	if err != nil { fmt.Println(err); return } // the error says what the API said, e.g. "400 Bad Request: validation: ..."
	p := docustay.NewSendRequestPartiesInner("signer_1", "Alex Rivera", "alex@example.com")
	d, _, err := c.DocumentsAPI.SendDocument(ctx).IdempotencyKey(fmt.Sprint("d-", time.Now().UnixNano())).SendRequest(*docustay.NewSendRequest(t.TemplateId, []docustay.SendRequestPartiesInner{*p})).Execute()
	if err != nil { fmt.Println(err); return }
	fmt.Println("sent", d.Id, d.State)
}
```

```php
<?php
require __DIR__ . '/vendor/autoload.php';
$config = Docustay\Configuration::getDefaultConfiguration()
    ->setAccessToken(getenv('DOCUSTAY_API_KEY')); // own install: ->setHost('https://sign.example.com')
$templates = new Docustay\Api\TemplatesApi(new GuzzleHttp\Client(), $config);
$documents = new Docustay\Api\DocumentsApi(new GuzzleHttp\Client(), $config);
try {
    $t = $templates->createTemplateFromHtml(bin2hex(random_bytes(16)), new Docustay\Model\HtmlTemplateRequest([
        'name' => 'Mutual NDA',
        'html' => '<h1>Mutual NDA</h1><p>Signed: {{Sign here;type=signature;role=Partner}}</p>',
    ]));
    $d = $documents->sendDocument(bin2hex(random_bytes(16)), new Docustay\Model\SendRequest([
        'template_id' => $t->getTemplateId(),
        'parties' => [new Docustay\Model\SendRequestPartiesInner(['seat' => 'signer_1', 'name' => 'Alex Rivera', 'email' => 'alex@example.com'])],
    ]));
    echo 'sent ', $d->getId(), ' ', $d->getState(), "\n";
} catch (Docustay\ApiException $e) {
    echo $e->getCode(), ': ', $e->getResponseBody(), "\n";
}
```

```csharp
using Docustay.Api.Api;
using Docustay.Api.Client;
using Docustay.Api.Model;

var cfg = new Configuration { AccessToken = Environment.GetEnvironmentVariable("DOCUSTAY_API_KEY") }; // own install: BasePath = "https://sign.example.com"
try
{
    var t = new TemplatesApi(cfg).CreateTemplateFromHtml(Guid.NewGuid().ToString(), new HtmlTemplateRequest(
        name: "Mutual NDA", html: "<h1>Mutual NDA</h1><p>Signed: {{Sign here;type=signature;role=Partner}}</p>"));
    var d = new DocumentsApi(cfg).SendDocument(Guid.NewGuid().ToString(), new SendRequest(templateId: t.TemplateId,
        parties: new List<SendRequestPartiesInner> { new(seat: "signer_1", name: "Alex Rivera", email: "alex@example.com") }));
    Console.WriteLine($"sent {d.Id} {d.State}");
}
catch (ApiException e) { Console.WriteLine($"{e.ErrorCode}: {e.ErrorContent}"); }
```
