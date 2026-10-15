---
title: "Tutorial: let an AI agent draft contracts, with a person approving"
description: Give an AI agent a draft-only key so it can prepare documents but cannot send one until a person approves it in the app.
order: 21
---

# Tutorial: let an AI agent draft contracts, with a person approving

An agent is good at drafting and bad at knowing when a document should leave the building. Docustay lets you give it the first and keep the second. This takes about ten minutes.

## 1. Make the agent its own key

In Developers, make a key named for the agent:

- Environment: **test** while you try it.
- Scopes: `documents:read`, `documents:write`, `templates:read`. Nothing else.
- Tick **Draft only**.
- Optionally set **drafts per day** and **sends per day**. They are exact, and past the limit the key gets a `429`.

Give the agent that key and nothing more.

## 2. What the agent can do

The agent creates a draft from a template or from text, checks it, and edits it:

```js
const draft = await docustay.createDocument({ title: "Services agreement", source, people });
const check = await docustay.checkDocument({ source, people });   // read every problem it lists
```

It can ask to send:

```js
const r = await docustay.sendDraft(draft.id);   // answers 202, state "draft", approval.status "pending"
```

Nothing is emailed. The document stays a draft, and asking again returns the same request, not a second one.

## 3. A person approves

Open Settings → Developers → Approvals. Each waiting request shows the document, the key that asked, and when. Open the document, read it, then press **Approve and send** or **Decline**. Approving sends it now, as you. Declining leaves it a draft for the agent or a person to change.

## 4. See what the agent did

On the same screen, **What your keys did** lists every call the key made (route and answer, never the contents of the request, so a prompt never lands in the log) and every request with who decided it.

## 5. Tell the agent the rules

Add the published skill to your agent so it behaves: `docustay-agent-safety` in the Docustay Claude plugin (`sdk/claude-plugin`). It tells the agent to use a test key first, to read every problem a check reports, to stop on a `429`, and to tell you when a send is waiting instead of retrying.

## 6. Going live

When the test flow works, make a live draft-only key with limits that suit you. Keep **Draft only** on until you trust the agent's drafts; turning it off is a change you make to that key, not something the agent can do.
