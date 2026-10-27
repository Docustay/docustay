---
title: Send a document for signature from Go
description: Send a document for signature from Go, with a program that was run against Docustay with a test key.
---

# Send a document for signature from Go

Sign PDF API in Go: a short program that sends a template for signature, run against Docustay with a test key before it was published. Set DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID.

`go get github.com/docustay/docustay-go/docustay@v0.2.2`

The module needs Go 1.23 or newer and has no dependencies beyond the standard library. Every call that creates something takes an idempotency key: build one per attempt and reuse it when you retry. Pass the server only when you point at a self-hosted install. The client is generated from the OpenAPI document, so every operation is there.

```
package main

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
}
```
