---
title: MCP server e-signature for AI agents | Docustay
description: An MCP server e-signature tool and a Claude plugin let an assistant draft documents. A person approves every send, and a draft-only key enforces it.
---

# AI agents draft. People send.

The MCP server e-signature tools and a Claude plugin let an assistant find documents, prepare drafts and read results. Sending takes a person, and a draft-only key makes that a rule.

## Look, prepare and report.

**Look.** Search documents, list payments and read the state of any document and its audit log.

**Prepare.** Make a draft from your words, a template and the people involved, check it, and revise it.

**Report.** Read results, download a finished copy to a folder on your own computer and summarise what is waiting on whom.

## Sending needs a person.

The MCP server shows a preview first and acts only on a second, confirmed call. A draft-only key can make drafts but cannot send them at all.

- No tool returns a signing link, a code or the key, and there is no tool to refund a payment.
- A read-only switch removes every tool that changes anything.

## Every action is on the record.

What an agent does is recorded like what a person does: which key, which document, and when. Revoke a key and its access ends at once.

- Per-key scopes decide what a key may do.
- The API call log keeps 30 days.

## What an assistant can and cannot do.

- **Find**: Search documents and read their state and audit log
- **Draft**: Make a draft from words, a template and the people, then check and revise it
- **Ask**: Propose a send, a reminder or a void, and show you the preview

- **Send alone**: Nothing is sent without a second, confirmed call
- **Reach the key**: No tool returns a signing link, a code or the key
- **Move money**: There is no tool to refund a payment

## Read, draft, and never send alone.

| Kind | Examples | Needs a person? |
| --- | --- | --- |
| Read | list_templates, get_document, get_audit_log, search_documents, list_payments | No |
| Prepare | create_document, use_template, check_document, revise_document, draft_document_with_ai | A person reviews the draft |
| Act | send_document, remind, void_document | Yes: a plain-words preview first, then a second call with confirm |
| Money | Refund a payment | Not offered as a tool at all |

## Add the server to your assistant.

```
{
  "mcpServers": {
    "docustay": {
      "command": "npx",
      "args": ["-y", "@docustay2026/mcp"],
      "env": { "DOCUSTAY_API_KEY": "dsk_test_..." }
    }
  }
}
```

## Rules that do not depend on the model behaving.

**Preview first.** send_document, remind and void_document do nothing the first time. They return a plain-words preview of who would be emailed, and only a second call with confirm acts.

**Draft-only keys.** A key made draft-only can create drafts and nothing else, whatever the assistant asks.

**Scoped keys.** Each key carries only the scopes you gave it, and you can revoke it at any time. A key without the scope gets the same plain refusal as any bad key.

## What it looks like to ask for a send.

You say: send the mutual NDA to Sam. The assistant finds the NDA, asks for a send without confirming, and shows you who would be emailed. You say yes, and only then does it send.

- Nothing is sent until the second call.
- No tool returns a signing link, a code or the key.

## A plugin that carries the know-how.

The Claude Code plugin bundles the server and five skills: sending for signature, text tags, embedded signing, webhooks and agent safety. The skills are plain Markdown files, so any agent that reads skill files can use them.

- For assistants that cannot run a program on your computer, a hosted connector does the same job.
- Everything the plugin does is recorded in the audit log.

## Questions

**Which assistants work?**

Any assistant that speaks the Model Context Protocol, and a Claude plugin that bundles the server.

**Can an agent send a document?**

Not on its own. A person approves each send.

**How many tools are there?**

39 tools in the MCP server, checked 12 October 2026. They cover reading, drafting, checking and acting, and every acting tool asks for a confirmation first.

**Can an assistant see signing links?**

No. No tool returns a signing link, a code or the key.

**Where do I get a key for an assistant?**

In the app, under Developers, API keys. Give it only the scopes it needs, and start with a test key.

**What about assistants that cannot run a program?**

A hosted connector does the same job for them.

**Is an assistant's work on the record?**

Yes. What an assistant does through a key is recorded like what a person does: which key, which document and when, in the same audit log your team reads. Revoke the key and its access ends at once.


## Keep reading

- [Scribe](/features/scribe)
- [Keys and scopes](/developers/keys-and-security)
- [Plays and Playbooks API](/developers/plays)
