---
name: docustay-send-for-signature
description: Use when the user wants to send a document for signature with Docustay, check who has signed, remind people, cancel a document, or save a signed PDF. Covers the Docustay MCP tools and the order to use them.
---

# Send a document for signature with Docustay

Use the `docustay` MCP tools. Do not guess ids.

1. `list_templates` to find the template, then `get_template` to see its **seats** (the people who sign, for example `signer_1`, `signer_2`). Every seat needs a name and an email.
2. `send_document` WITHOUT `confirm`. It sends nothing and returns a preview of exactly who would be emailed. Show that preview to the person in plain words.
3. Only when they agree, call `send_document` again with the same arguments and `confirm: true`.
4. Follow up with `get_document` (state, who is waiting) and `list_documents`.
5. `remind` and `void_document` work the same way: preview first, `confirm: true` only after the person agrees. Cancelling cannot be undone.
6. When a document is `executed`, `save_signed_pdf` writes the signed copy to a path on this computer.

Facts to keep straight:
- A `dsk_test_` key means test mode. Documents are practice runs, emailed only to the key's owner, stamped TEST, never counted or billed. Say so when you use one.
- Tools never return signing links or codes. You cannot sign for anyone.
- If a tool says the key lacks permission, tell the person which permission (`documents:read` or `documents:write`) instead of retrying.
