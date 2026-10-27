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
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const source = { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "The Client agrees to the services described in this agreement." }] },
  { type: "paragraph", content: [{ type: "fieldTag", attrs: { name: "Sign here", type: "signature", role: "Client" } }] },
] };
const people = [{ name: "Rosa Alvarez", email: "rosa@example.com", role: "Client" }];
const check = await docustay.checkDocument({ source, people });   // read every problem it lists
const draft = await docustay.createDocument({ title: "Services agreement", source, people });
console.log(check, draft.id);
```

It can ask to send:

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const draftId = process.env.DOCUSTAY_DRAFT_ID;   // draft.id from the block above
const r = await docustay.sendDraft(draftId);   // answers 202: nothing is emailed yet
console.log(r.state, r.approval?.status);   // "draft" "pending"
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

## Why draft-only is a property of the key

The agent cannot turn the restriction off, because **Draft only** belongs to the key and is changed in Developers, not through the API. A send through such a key files an approval and emails nothing, and repeating the request returns the same pending approval, not a second one. The limits for drafts and sends per day are exact; past them the key gets a `429`.

## The same idea for an embedded assistant

If you show Scribe inside your own page instead of running your own agent, the session key is made for you with the same shape: draft-only, 50 drafts a day, one hour. See [Scribe in your own app](/docs/scribe-embed.md).

## Using the MCP server

AI assistants that speak the Model Context Protocol can use the MCP server in `sdk/mcp` with the same kind of key. Preview a change first, then confirm it; the server never skips the preview step. The scopes it needs are listed in `sdk/mcp/SCOPES.md`. Give it a test, draft-only key while you learn how your assistant behaves.

## What to review in an approval

Read the document, not just the title. Check the people and the fields, since an agent can place a signer in the wrong seat. If something is wrong, decline: the document stays a draft that the agent or a person can change, and nothing was sent.
