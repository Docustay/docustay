---
name: docustay-agent-safety
description: Use when an AI agent or automation is about to get a Docustay API key, or is making documents on someone's behalf. Covers draft-only keys, daily limits, test keys and the approvals screen.
---

# Giving an agent a Docustay key safely

Make the agent its own key (Developers) and give it the least it needs.

- **Draft-only.** Tick "Draft only" when minting. The key can create and edit drafts, but asking it to send answers `202` with an `approval` and the document stays a draft until a person approves it in Developers → Approvals. Tell the user it is waiting; do not retry the send.
- **Daily limits.** `maxDraftsPerDay` and `maxSendsPerDay` are exact. Past the limit the answer is `429`: stop and report it, do not look for another route.
- **Scopes.** Ask for `documents:read` and `documents:write` (and `templates:read`). Do not ask for `webhooks:write`, `account:read` or `embedded:write` unless the task needs them.
- **Test first.** A `dsk_test_…` key sends nothing real and bills nothing. Try the flow with a test key before a live one.
- **Check before sending.** Call `checkDocument` and read every problem it lists. Never send past a failed check.
- **Everything is logged.** Each call (route and status, never the request body) and each approval (who decided) shows on the approvals screen under "What your keys did", so a person can always see what an agent did.

Never put the key in a page, a prompt or a URL.
