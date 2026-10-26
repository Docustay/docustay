---
title: API keys and scopes
description: Keys carry scopes, can expire, can be limited to addresses and are shown once. Test keys act on test data only. Every use is in the audit log with the key's name.
---

# API keys and security

Scopes, expiry and an address allow-list. A key is shown once and every use is in the audit log.

```
dsk_test_…   practice data only
dsk_live_…   real documents
whsec_…      webhook secret, shown once
```

## What a key can do.

- **Twelve scopes**: You tick the scopes a key carries, from the broad documents:read and documents:write down to one-job scopes such as templates:read.
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

## What each scope lets a key do.

| Scope | Lets the key |
| --- | --- |
| documents:read | List and read documents and templates, read the audit log, download signed copies, read teams |
| documents:write | Send documents, make templates, remind, void, start an embedded signing session |
| templates:read | List and read templates and the built-in template library |
| templates:write | Make and change templates and their defaults; make a draft from, or customize, a built-in template |
| account:read | Read plan usage, payment status and teams |
| webhooks:read | List your webhook addresses and what was sent to them |
| webhooks:write | Add, change, test and remove webhook addresses; make a new signing secret |
| embedded:write | Start an embedded signing session for a seat you marked as embedded |
| plays:read | Read skills and playbooks |
| plays:write | Make and change skills and playbooks |
| drafts:write | Make drafts only; nothing in it sends a document |
| people:read | List the people in your workspace by name |

A key can only carry scopes its creator holds. A request without the scope gets the same 401 as a wrong key, on purpose.

## From key to answer.

List executed documents with a key that has documents:read.

```
curl https://app.docustay.app/api/v1/documents?state=executed \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## The log says which key made which call.

A 401 after it used to work means the key was revoked, expired or lost a scope. Make a new key, update the one integration that used it.

**Test keys.** dsk_test_ keys act on test data only.

## Four rules for every key.

| Topic | Detail |
| --- | --- |
| Server only | Keep a key on your server. Never put one in a web page or a mobile app. |
| One per integration | Make a key per integration so one can be revoked alone, and tick only the scopes it needs. |
| Named in the log | Every use of a key is in the audit log with the key's name, and revoking takes effect at once. |

## What can be limited on a key.

| Option | Effect |
| --- | --- |
| dsk_test_ prefix | Test mode: practice runs only, sees only test documents |
| dsk_live_ prefix | Acts on real documents |
| Address list | The key works only from the addresses you list |
| Expiry | The key stops working on the date you set |
| Draft only | Can make and edit drafts but cannot send; a send request waits for a person |
| Daily limits | Exact limits on drafts and sends; past them the key gets 429 |

A key can only carry scopes its creator holds.

## Tell a bad key from a missing scope.

You cannot, from the answer, and that is deliberate: nothing tells a guesser which half was right. Check the log, not the response.

```
try {
  await docustay.listDocuments({ state: "executed" });
} catch (e) {
  if (e.status === 401) console.log("revoked, expired, wrong or missing documents:read:", e.requestId);
  else throw e;
}
```

## What no key can do.

| Topic | Detail |
| --- | --- |
| No links | No response contains a signing link or an access code. |
| No signing for anyone | A key cannot sign for a person. A test key can sign a test document with test-sign, nothing else. |
| One exception | For seats you mark as embedded when you send, a key can ask for a one-hour session to show your own signer the form on a website you listed. |

## Scopes for the job in front of you.

| Job | Scopes |
| --- | --- |
| Read templates only | templates:read |
| Send and follow documents | documents:read, documents:write |
| Manage webhook endpoints | webhooks:read, webhooks:write |
| Show a signing form in your page | embedded:write, plus documents:write to send |
| An agent that drafts | drafts:write, documents:read, templates:read; tick Draft only |
| List your people by name | people:read |

If a key leaks, make a new one, update the one integration that used it, and revoke the old; revoking takes effect at once.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Hand a key to an agent | A draft-only key can prepare documents and cannot send. | Agents: /developers/agents |
| Call the API | Send with the key you just made. | REST API: /developers/api |
| Rotate a webhook secret | A new secret can overlap the old for up to 168 hours. | Webhooks: /developers/webhooks |

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
