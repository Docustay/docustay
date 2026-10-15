# Connect ChatGPT, Claude or any assistant

The hosted connector lets an AI assistant work on **drafts** in your workspace without anyone copying an API key around. You add one address to the assistant, sign in once, and say Allow.

**Address to add:** `https://app.docustay.app/mcp` (on a self-hosted install, your own address plus `/mcp`).

## What happens
1. The assistant finds the sign-in details at `/.well-known/oauth-authorization-server`, registers itself, and opens Docustay's consent page.
2. You sign in if you are not already, read what it can and cannot do, and press Allow.
3. Docustay makes a key for that assistant. It is **draft-only**, lasts 90 days, allows 100 drafts a day, and appears in Settings → Developers → API keys as “Connector: <the assistant's name>”. Revoke it there and the connector stops at once.

## What it can do
List templates (the built-in library and your own) and skills, read documents, start a draft from a built-in template (it asks you a few questions with 2 to 4 options), make a draft from a template, read a draft, and **ask** for a draft to be sent.

## What it cannot do
Send a document. “Ask to send” files a request; a person approves it in Settings → Developers → Approvals. It cannot remind, void or sign, change settings or keys, or see billing.

## Tools
`list_templates`, `get_template`, `list_documents`, `get_document`, `list_plays`, `get_play`, `start_draft`, `answer_questions`, `use_template`, `get_draft_source`, `request_send`. Every tool is one call to the same `/api/v1` routes the SDKs use, carrying the assistant's own key, so scopes, limits and the draft-only rule apply exactly as they do anywhere else.

## How the sign-in is protected
OAuth with PKCE (S256 only) and dynamic client registration; no client secret is stored. The one-time code lasts two minutes and is sealed with the install's own pepper. Return addresses must be https, or http on localhost, and must be the ones the assistant registered. The key is minted only when the code is exchanged, with the rank of the person who pressed Allow, and a person can only hand over scopes they could mint themselves.

## Your own key instead
If you would rather not use sign-in, send `Authorization: Bearer <key>` to `/mcp` with a key from Settings → Developers → API keys. The same tools and rules apply. The local server `@docustay2026/mcp` (see [MCP server and agent skills](/docs/mcp-and-skills)) has more tools, including sending with a preview step.

## Look at it from a terminal

The connector speaks the standard MCP and OAuth discovery documents, so you can see what an assistant sees before you connect it. The first call names the resource and its sign-in server; the second lists what a client may ask for.

```bash
curl -s https://app.docustay.app/.well-known/oauth-protected-resource
curl -s https://app.docustay.app/.well-known/oauth-authorization-server
```

An assistant registers itself, sends you to a Docustay page to approve, and exchanges the one-time code for a draft-only key. You can see that key afterwards under Developers with its limits:

```bash
curl -s https://app.docustay.app/api/v1/documents \
  -H "Authorization: Bearer $DOCUSTAY_KEY"   # the draft-only key the approval made
```
