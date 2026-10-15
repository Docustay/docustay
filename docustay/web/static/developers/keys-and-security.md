---
title: API keys and scopes
description: Keys carry scopes, can expire, can be limited to addresses and are shown once. Test keys act on test data only. Every use is in the audit log with the key's name.
---

# API keys and security

Scopes, expiry and an address allow-list. A key is shown once and every use is in the audit log.

## What a key can do.

- **Thirteen scopes**: You tick the scopes a key carries, from the broad documents:read and documents:write down to one-job scopes such as reports:read.
- **documents:read**: List and read documents and templates, the audit log, signed copies
- **documents:write**: Send, make templates, remind, void, start an embedded session
- **The full table**: In the docs under Authentication

- **Sign**: A key cannot sign for anyone
- **Links**: No response contains a signing link or a code
- **Scopes**: A key holds only scopes its creator holds

## Keep a key safe.

**Server only.** Never put a key in a web page or a mobile app.

**One per integration.** Revoke one without breaking another; revoking takes effect at once.

**Audited.** Every use is in the audit log with the key's name.

## From key to answer.

List executed documents with a key that has documents:read.

```
curl https://app.docustay.app/api/v1/documents?state=executed \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## Questions

**What does a 401 mean?**

The key is missing, wrong, revoked or lacks the scope. One answer covers all four on purpose.

**Can a key expire?**

Yes. Set an expiry when you make it.

**Can I limit where it is used?**

Yes. A key can be limited to addresses.


## Keep reading

- [REST API](/developers/api)
- [Security](/trust#security)
- [Agents](/developers/agents)
