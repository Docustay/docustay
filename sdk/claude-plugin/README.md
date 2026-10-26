# Docustay for Claude Code

A plugin that gives Claude Code the Docustay tools (through `@docustay2026/mcp`) and five skills that teach it how Docustay works.

Set a key first. Use a `dsk_test_` key to practise: every document is a practice run, emailed only to the key's owner.

```bash
export DOCUSTAY_API_KEY=dsk_test_...
export DOCUSTAY_READ_ONLY=1   # optional: remove every tool that changes anything
```

Sending, reminding and cancelling always show a preview first and wait for the person's agreement. Nothing here is published to a marketplace yet; install from this folder.
