---
title: MCP server for e-signatures
description: A hosted connector and a local MCP server let an assistant draft documents from templates and plays. It cannot send: a person approves each send. Draft-only keys last 90 days.
---

# AI agents and MCP.

An assistant can list templates, draft a document and ask to send it. A person approves the send.

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
{ "name": "send_document", "arguments": { "templateId": "TEMPLATE_ID", "parties": [{ "seat": "signer_1", "name": "Sam", "email": "sam@example.com" }] } }
```

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

- [Templates and skills API](/developers/plays)
- [Keys and security](/developers/keys-and-security)
- [Scribe](/product/scribe)
