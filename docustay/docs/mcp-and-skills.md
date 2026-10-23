---
title: MCP server and agent skills
description: Let an AI assistant send documents, follow them and save signed copies, with previews and your own key.
order: 9
---

# MCP server and agent skills

`@docustay2026/mcp` is a Model Context Protocol server. It runs on your own computer with your own API key and gives an assistant 39 tools. The main ones are `list_templates`, `get_template`, `list_documents`, `get_document`, `get_audit_log`, `save_signed_pdf`, `send_document`, `remind`, `void_document`, `create_template_from_html`, `detect_fields`, `search_documents`, `list_payments`, `list_plays`, `list_playbooks` and `get_ai_usage`. The rest are listed below.

```json
{ "mcpServers": { "docustay": { "command": "npx", "args": ["-y", "@docustay2026/mcp"], "env": { "DOCUSTAY_API_KEY": "dsk_test_…" } } } }
```

A server other than `https://app.docustay.app` (a self-hosted install or a practice server) is named with `DOCUSTAY_BASE_URL`, in the same `env` block.

## Safety

- **Preview first.** `send_document`, `send_draft`, `remind` and `void_document` do nothing the first time: they return a plain-words preview of who would be emailed. Only a second call with `confirm: true` acts.
- **Read-only mode.** Set `DOCUSTAY_READ_ONLY=1` and every tool that changes anything is removed.
- **Your key, your scopes.** The key decides what is possible; use a `dsk_test_` key to practise.
- **No links, no keys.** No tool returns a signing link, a code or the key.

## Words and people, and the assistant

Besides sending a template, the server can make a **draft** from written words and people (`create_document`, `use_template`), check it (`check_document`), read and change it (`get_draft_source`, `revise_document`), set a template's defaults (`set_template_defaults`), ask the Docustay assistant to draft or to propose changes (`draft_document_with_ai`, `edit_document_with_ai`, `cancel_ai_job`), read the wizard's questions (`get_wizard`) and ask whether Stripe is ready for a payment (`get_payments_status`). It can also search the workspace (`search_documents`), list payments (`list_payments`) and list the playbooks (`list_playbooks`). Refunds and switching a playbook on are left to a person: see [Search and payments](/docs/payments-and-playbooks). Making or changing a draft emails nobody: `send_draft` is the only step that does, and it previews first. The assistant's edits come back as proposals for a person to accept. See [Documents from words and people](/docs/documents-from-words.md).

## Claude Code plugin and skills

The `docustay` plugin bundles the server and five skills: sending for signature, text tags, embedded signing, webhooks and agent safety. The skills are plain Markdown files, so any agent that reads skill files can use them.

## A conversation, step by step

You ask the assistant: "Send the mutual NDA to Sam at sam@example.com." It calls `list_templates`, finds the NDA, then calls `send_document` without `confirm`. The preview says who would be emailed and from which template. You say yes; it calls `send_document` again with `confirm: true`. Nothing is sent until that second call.

```json
{ "name": "send_document", "arguments": { "templateId": "TEMPLATE_ID", "parties": [{ "seat": "signer_1", "name": "Sam", "email": "sam@example.com" }], "confirm": true } }
```

## Reading and saving

`get_document` returns the state and each person's status. `save_signed_pdf` downloads a finished copy to a folder you name on your own computer.

## Running it read-only

```ini
# in .env (a file, not a command)
DOCUSTAY_READ_ONLY=1 DOCUSTAY_API_KEY=dsk_test_… npx -y @docustay2026/mcp
```

With that variable set, `send_document`, `remind`, `void_document` and `create_template_from_html` are not offered at all, so an assistant cannot call them even by mistake.


## Which key scopes each tool needs

The table is derived from the server's own route table and checked by a test, so it cannot drift: `sdk/mcp/SCOPES.md` in the repository. A key without the scope gets the same plain 401 as any bad key. For assistants that cannot run a program on your computer, use the hosted [connector](/docs/connector).
