---
name: suggestions-and-ideas-form
template: suggestions-and-ideas
use: form
title: "Suggestions and ideas form (link)"
description: "Use to publish suggestions and ideas as one link: collect ideas with enough detail to act on them."
questions:
  - key: check
    question: "Should people confirm their email before they sign?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "You know each address is real"
      - label: "No, just sign"
        description: "Quickest for the person"
        recommended: true
checklist:
  - "asks for about you"
  - "asks for your idea"
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
