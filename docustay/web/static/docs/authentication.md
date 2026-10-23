# Authentication

Send `Authorization: Bearer <key>` on every request. Keys are made in **Settings → Developers → API keys** and shown once; if you lose one, make another and revoke the old.

## Scopes

A key carries only the scopes you tick when you make it. The two broad scopes (`documents:read` and `documents:write`) open everything about documents; the narrower ones let you make a key that does one job and nothing else, for example one that only reads teams and plan usage. A Docustay workspace is offered 12 scopes, and the table lists all of them.

| Scope | Lets the key |
|---|---|
| `documents:read` | list and read documents and templates, read the audit log, download signed copies, read teams |
| `documents:write` | send documents, make templates, remind, void, start an embedded signing session |
| `templates:read` | list and read templates |
| `templates:write` | make and change templates and their defaults |
| `account:read` | read plan usage, payment status and teams |
| `webhooks:read` | list your webhook addresses and what was sent to them |
| `webhooks:write` | add, change, test and remove webhook addresses, and make a new signing secret |
| `embedded:write` | start an embedded signing session for a seat you marked as embedded |
| `plays:read` | read skills and playbooks |
| `plays:write` | make and change skills and playbooks |
| `drafts:write` | make drafts only; nothing in it sends a document |
| `people:read` | list the people in your workspace by name |

A key can only carry scopes its creator holds. A request without the scope gets the same `401` answer as a wrong key, on purpose: nothing tells a guesser which half was right.

## Test keys and live keys

`dsk_test_…` keys act on test data only: documents sent with one are practice runs. `dsk_live_…` keys act on real documents. See [Test mode](/docs/test-mode.md).

## What a key can never do

No response contains a signing link or an access code, and a key cannot sign for anyone. The one exception is [embedded signing](/docs/embedding.md): for seats **you** mark as embedded when you send, a key can ask for a one-hour session to show your own signer the form on a website you listed.

## Keeping a key safe

- Keep it on your server. Never put a key in a web page or a mobile app.
- Give it only the scopes it needs, and make one key per integration so one can be revoked alone.
- Every use of a key is in the audit log with the key's name, and revoking takes effect at once.

## A request, start to finish

List your executed documents with a key that has `documents:read`:

```bash
curl https://docustay.app/api/v1/documents?state=executed \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

The same call from JavaScript, using the SDK, which adds the header for you:

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const page = await docustay.listDocuments({ state: "executed", limit: 20 });
```

## When a key stops working

A `401` after it used to work means the key was revoked, expired or lost a scope. Make a new key, update the one integration that used it, and the audit log will show which key made which call, so you can see whether the old one is still being used somewhere.
