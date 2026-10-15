---
title: E-signature command line
description: Sign in, send a test document, forward real signed webhooks to localhost, verify a PDF and read your logs, all from the command line. MIT licensed.
---

# Command line

Log in, send a test document, forward signed webhooks to your laptop, verify a PDF, read the logs.

## Five commands.

- **login**: Store a key for this machine
- **send --test**: Send a practice document to yourself
- **listen**: Forward real signed events to a local URL and print the secret

- **verify**: Check a signed PDF
- **logs**: Read recent API calls

## Keys come from the environment.

DOCUSTAY_API_KEY and DOCUSTAY_URL override the saved ones.

```
export DOCUSTAY_API_KEY=dsk_test_…
export DOCUSTAY_URL=https://sign.example.com   # only for a self-hosted install
npx docustay send --test TEMPLATE_ID --party signer_1="Pat Example <pat@example.com>" --json
```

## Questions

**Why use listen?**

Endpoints must be public https addresses, and listen forwards signed events to localhost so you can build a receiver.

**Does it print my key?**

No. A key is stored for the machine and never printed.


## Keep reading

- [Webhooks](/developers/webhooks)
- [Test mode](/developers/test-mode)
- [REST API](/developers/api)
