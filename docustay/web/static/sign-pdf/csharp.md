---
title: Send a document for signature from C#
description: Send a document for signature from C#, with a program that was run against Docustay with a test key.
---

# Send a document for signature from C#

Sign PDF API in C#: a short program that sends a template for signature, run against Docustay with a test key before it was published. Set DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID.

`dotnet add package Docustay.Api`

The package targets .NET 8. Every call that creates something takes an idempotency key as its first argument: build one per attempt and reuse it when you retry. Set BasePath only when you point at a self-hosted install.

```
using Docustay.Api.Api;
using Docustay.Api.Client;
using Docustay.Api.Model;

var config = new Configuration { BasePath = Environment.GetEnvironmentVariable("DOCUSTAY_URL") ?? "https://app.docustay.app" };
config.AccessToken = Environment.GetEnvironmentVariable("DOCUSTAY_API_KEY");
var api = new DocumentsApi(config);

var request = new SendRequest(
    templateId: Guid.Parse(Environment.GetEnvironmentVariable("DOCUSTAY_TEMPLATE_ID")!),
    parties: new List<SendRequestPartiesInner> { new SendRequestPartiesInner(seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com") });
var doc = api.SendDocument(Guid.NewGuid().ToString(), request);
Console.WriteLine($"{doc.Id} {doc.State}");
```
