---
name: exit-interview-form
template: exit-interview
use: form
title: "Exit interview form (link)"
description: "Use to publish exit interview as one link: learn from people who leave, in their own words."
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
  - "asks for leaving"
  - "asks for your experience"
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
