---
title: MCP server for e-signatures
description: A hosted connector and a local MCP server let an assistant draft documents from templates and plays. It cannot send: a person approves each send. Draft-only keys last 90 days.
---

# AI agents and MCP.

An assistant can list templates, draft a document and ask to send it. A person approves the send.

```
agent  → start_draft  template: services-agreement
agent  → answer_questions  3 answers
agent  → get_draft_source  draft_id
agent  → request_send  draft_id
←  202 · waiting for your approval
```

## Where a human stays in the loop.

1. **Agent**: Reads and drafts
2. **Draft**: In your workspace
3. **Your approval**: Settings → Developers → Approvals
4. **Send**: Only after you say so

## Every tool is draft-only.

- **Read**: list_templates, get_template, list_documents, get_document, get_draft_source
- **Plays**: list_plays, get_play, start_draft, answer_questions
- **Draft**: use_template
- **Ask**: request_send

- **Lasts**: 90 days, then it stops
- **Limit**: 100 drafts a day
- **Shown as**: Connector: the assistant's name, in Settings → Developers → API keys
- **Revoke**: Revoke the key and the connector stops at once

## Connect it, call it, cut it off.

**Hosted connector.** Add one address to the assistant, sign in once and press Allow. Sign-in uses OAuth with PKCE.

**Plays API (Pro).** List and publish plays, and call them from code.

**Revoke any time.** Every use is in the audit log with the key's name. Revoking takes effect at once.

## The local MCP server runs on your computer.

```
{ "mcpServers": { "docustay": { "command": "npx", "args": ["-y", "@docustay2026/mcp"],
  "env": { "DOCUSTAY_API_KEY": "dsk_test_…" } } } }
```

## The first call previews. The second acts.

send_document does nothing the first time: it returns a plain-words preview of who would be emailed. Only a call with confirm: true acts.

```
{ "name": "send_document", "arguments": { "templateId": "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e", "parties": [{ "seat": "signer_1", "name": "Sam", "email": "sam@example.com" }] } }
```

## What an assistant can and cannot do.

|  | Allowed | How |
| --- | --- | --- |
| Read templates and documents | Yes | With the scopes on its key |
| Draft a document | Yes | A draft only; nothing in it sends |
| Send, remind or void | Asks first | A preview, then confirm: true |
| Run read-only | Yes | DOCUSTAY_READ_ONLY=1 removes every changing tool |
| Sign for someone | Never | No tool does it |
| See a signing link or a code | Never | No tool returns one |

A key without the scope gets the same plain 401 as any bad key.

## Every call carries the key's name.

Every use is in the audit log, and revoking a key takes effect at once.

**Revoke.** One key per assistant, so you can cut one off alone.

## Add the server to your assistant.

@docustay2026/mcp runs on your own computer with your own key. Start with a test key, and a read-only run if you only want it to look.

```
{ "mcpServers": { "docustay": { "command": "npx", "args": ["-y", "@docustay2026/mcp"], "env": { "DOCUSTAY_API_KEY": "dsk_test_…" } } } }
```

## Which tool needs which scope.

| Tool | Changes things? | Scope (any one) |
| --- | --- | --- |
| list_documents, get_document | No | documents:read |
| send_document, remind, void_document | Yes | documents:write |
| create_template_from_html | Yes | templates:write |
| start_draft, answer_questions | Yes (drafts only) | drafts:write |
| list_plays, list_playbooks | No | plays:read |
| get_ai_usage, get_payments_status | No | account:read |

The full table is derived from the server's own route table and checked by a test. A key without the scope gets the same plain 401 as any bad key.

## Let the agent ask; a person decides.

A draft-only key can make and edit drafts. Asking it to send answers 202, the document stays a draft, and a person approves or declines in Developers, Approvals.

```
const draft = await docustay.createDocument({ title: "Services agreement", source, people });
const check = await docustay.checkDocument({ source, people });   // read every problem it lists
const r = await docustay.sendDraft(draft.id);   // 202, state "draft", approval.status "pending"
```

## The connector, for assistants that cannot run a program.

| Fact | Detail |
| --- | --- |
| The key | Docustay makes a draft-only key when you approve; it lasts 90 days and allows 100 drafts a day |
| Where you see it | In Developers, API keys, named Connector and the assistant's name; revoke it there and the connector stops at once |
| Sign-in | OAuth with PKCE (S256 only) and dynamic client registration; no client secret is stored |
| Its tools | list_templates, get_template, list_documents, get_document, list_plays, get_play, start_draft, answer_questions, use_template, get_draft_source, request_send |

Every tool is one call to the same /api/v1 routes the SDKs use, so scopes, limits and the draft-only rule apply as anywhere else.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Make the key | Pick the scopes the assistant needs and nothing else. | Keys and security: /developers/keys-and-security |
| Practise first | A test key keeps every email to you. | Test mode: /developers/test-mode |
| Browse the templates | The same library is on the API and in the tools. | Plays and templates: /developers/plays |

## Questions

**Can I make it read-only?**

Yes. Set DOCUSTAY_READ_ONLY=1 and every tool that changes anything is removed.

**Which assistants work?**

Any that speaks the Model Context Protocol and can use OAuth or a bearer key.

**Where are the skills?**

The Claude Code plugin bundles the server and five skills: sending, text tags, embedded signing, webhooks and agent safety.

**Does a tool return a signing link or a key?**

Never. No tool returns a signing link, a code or the key.


## Keep reading

- [Plays and Playbooks API](/developers/plays)
- [Keys and security](/developers/keys-and-security)
- [Scribe](/features/scribe)
