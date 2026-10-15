---
name: event-waiver-form
template: event-waiver
use: form
title: "Event waiver form"
description: "Use to collect a signed waiver from every participant with one link."
questions:
  - key: check
    question: "Should people confirm their email first?"
    must_ask: true
    options:
      - label: "No, just sign"
        description: "Quickest at the door"
        recommended: true
      - label: "Yes, check the email"
        description: "Stronger proof of who signed"
checklist:
  - "asks for name and email"
  - "shows the activity and its risks"
  - "closes after the event date"
flags:
  - topic: "Enforceability of the waiver"
    note: "Waivers are treated differently by different courts."
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
