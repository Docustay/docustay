---
name: intake-form-collect
template: intake-form
use: form
title: "Client intake form (link)"
description: "Use to let new clients fill in and sign your intake form from one link on your website or in a message."
questions:
  - key: check
    question: "Should clients confirm their email first?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "Keeps out typing mistakes and bots"
        recommended: true
      - label: "No, just sign"
        description: "Quickest"
checklist:
  - "asks for name and email"
  - "asks only what you need"
  - "tells the client how the information is used"
flags:
  - topic: "Sensitive information"
    note: "If you collect health details, check the rules for keeping them."
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
