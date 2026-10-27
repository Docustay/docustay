// "Sign a PDF with …" pages: one template, one entry per language. Every snippet here is RUN against the sandbox by docustay/web/scripts/signpdf-proof.mjs (it reads this file), so a page never shows code nobody ran.
// A snippet reads DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID (and DOCUSTAY_URL when not the hosted service) and prints the document id and its state.
import facts from "./facts.gen.json" with { type: "json" };
// the package version in an install line is the product version (facts.gen.json), never typed here
const fill = (v) => (typeof v === "string" ? v.replaceAll("__VERSION__", facts.version).replaceAll("__GO__", facts.goVersion) : Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
const RAW = [
  { slug: "javascript", notes: "The package has no dependencies and needs Node 18 or newer. It makes one Idempotency-Key for each call and reuses it on every retry, so a network retry never sends the document twice. It is an ES module, so use import, or a .mjs file.", name: "JavaScript", ext: "mjs", run: ["node", "{file}"], sdk: true, install: "npm install @docustay2026/sdk",
    code: `import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }],
});
console.log(doc.id, doc.state);` },
  { slug: "typescript", notes: "The types ship inside the package: SendRequest describes what you send and the answer is typed too, so a wrong field name fails in your editor and not at 2 a.m. The program runs as it stands on Node 22 and newer with --experimental-strip-types; elsewhere compile it with tsc as usual.", name: "TypeScript", ext: "ts", run: ["node", "--experimental-strip-types", "{file}"], sdk: true, install: "npm install @docustay2026/sdk",
    code: `import { Docustay, type SendRequest } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY!, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const request: SendRequest = {
  templateId: process.env.DOCUSTAY_TEMPLATE_ID!,
  parties: [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }],
};
const doc = await docustay.sendDocument(request);
console.log(doc.id, doc.state);` },
  { slug: "python", notes: "The package has no dependencies and needs Python 3.9 or newer. Calls are synchronous and return plain dictionaries. Every POST gets an idempotency key made for it and reused on retries. Pass base_url only when you point at a self-hosted install.", name: "Python", ext: "py", run: ["python3", "{file}"], sdk: true, install: "pip install docustay",
    code: `import os
from docustay import Docustay

kw = {"base_url": os.environ["DOCUSTAY_URL"]} if os.environ.get("DOCUSTAY_URL") else {}
docustay = Docustay(os.environ["DOCUSTAY_API_KEY"], **kw)
doc = docustay.send_document(
    os.environ["DOCUSTAY_TEMPLATE_ID"],
    [{"seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com"}],
)
print(doc["id"], doc["state"])` },
  { slug: "go", notes: "The module needs Go __GO__ or newer and has no dependencies beyond the standard library. Every call that creates something takes an idempotency key: build one per attempt and reuse it when you retry. Pass the server only when you point at a self-hosted install. The client is generated from the OpenAPI document, so every operation is there.", name: "Go", ext: "go", file: "main.go", container: { image: "golang:1.22-alpine", run: "go mod init snippet >/dev/null 2>&1 && go get github.com/docustay/docustay-go/docustay@v__VERSION__ >/dev/null 2>&1 && go run ." }, sdk: true, install: "go get github.com/docustay/docustay-go/docustay@v__VERSION__",
    code: `package main

import (
	"context"
	"fmt"
	"os"
	"time"

	docustay "github.com/docustay/docustay-go/docustay"
)

func main() {
	cfg := docustay.NewConfiguration()
	server := "https://app.docustay.app"
	if u := os.Getenv("DOCUSTAY_URL"); u != "" {
		server = u
	}
	cfg.Servers = docustay.ServerConfigurations{{URL: server}}
	client := docustay.NewAPIClient(cfg)
	ctx := context.WithValue(context.Background(), docustay.ContextAccessToken, os.Getenv("DOCUSTAY_API_KEY"))

	request := *docustay.NewSendRequest(os.Getenv("DOCUSTAY_TEMPLATE_ID"), []docustay.SendRequestPartiesInner{
		*docustay.NewSendRequestPartiesInner("signer_1", "Rosa Alvarez", "rosa@example.com"),
	})
	doc, _, err := client.DocumentsAPI.SendDocument(ctx).SendRequest(request).IdempotencyKey(fmt.Sprintf("send-%d", time.Now().UnixNano())).Execute()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(doc.GetId(), doc.GetState())
}` },
  { slug: "php", notes: "The package needs PHP 7.4 or newer with the curl and json extensions, and uses Guzzle. The first argument of each call that creates something is an idempotency key: build one per attempt and reuse it when you retry. Pass the host only when you point at a self-hosted install.", name: "PHP", ext: "php", file: "snippet.php", container: { image: "composer:2", run: "composer init --no-interaction --name=snippet/snippet -q && composer require docustay/docustay-php:__VERSION__ --no-interaction -q 2>&1 | tail -1; php snippet.php" }, sdk: true, install: "composer require docustay/docustay-php",
    code: `<?php
require __DIR__ . '/vendor/autoload.php';

$config = Docustay\\Configuration::getDefaultConfiguration()->setAccessToken(getenv('DOCUSTAY_API_KEY'));
if ($url = getenv('DOCUSTAY_URL')) {
    $config->setHost($url);
}
$api = new Docustay\\Api\\DocumentsApi(new GuzzleHttp\\Client(), $config);

$request = new Docustay\\Model\\SendRequest([
    'template_id' => getenv('DOCUSTAY_TEMPLATE_ID'),
    'parties' => [new Docustay\\Model\\SendRequestPartiesInner([
        'seat' => 'signer_1', 'name' => 'Rosa Alvarez', 'email' => 'rosa@example.com',
    ])],
]);
$doc = $api->sendDocument(bin2hex(random_bytes(16)), $request);
echo $doc->getId(), ' ', $doc->getState(), PHP_EOL;` },
  { slug: "csharp", notes: "The package targets .NET 8. Every call that creates something takes an idempotency key as its first argument: build one per attempt and reuse it when you retry. Set BasePath only when you point at a self-hosted install.", name: "C#", ext: "cs", file: "Program.cs", container: { image: "mcr.microsoft.com/dotnet/sdk:8.0", run: "dotnet new console -o app >/dev/null && cp Program.cs app/Program.cs && cd app && dotnet add package Docustay.Api --version __VERSION__ >/dev/null 2>&1 && dotnet run 2>&1 | tail -3" }, sdk: true, install: "dotnet add package Docustay.Api",
    code: `using Docustay.Api.Api;
using Docustay.Api.Client;
using Docustay.Api.Model;

var config = new Configuration { BasePath = Environment.GetEnvironmentVariable("DOCUSTAY_URL") ?? "https://app.docustay.app" };
config.AccessToken = Environment.GetEnvironmentVariable("DOCUSTAY_API_KEY");
var api = new DocumentsApi(config);

var request = new SendRequest(
    templateId: Guid.Parse(Environment.GetEnvironmentVariable("DOCUSTAY_TEMPLATE_ID")!),
    parties: new List<SendRequestPartiesInner> { new SendRequestPartiesInner(seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com") });
var doc = api.SendDocument(Guid.NewGuid().ToString(), request);
Console.WriteLine($"{doc.Id} {doc.State}");` },
];
export const SIGNPDF = fill(RAW);
export const bySlug = (s) => SIGNPDF.find((x) => x.slug === s) ?? null;
