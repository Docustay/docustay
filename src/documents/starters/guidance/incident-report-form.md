---
name: incident-report-form
template: incident-report
use: form
title: "Incident report form (link)"
description: "Use to publish incident report as one link: capture the facts while they are fresh, the same way every time, so they can be reviewed."
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
  - key: countersign
    question: "Should someone on your team counter-sign each response?"
    must_ask: true
    options:
      - label: "Yes, a team member signs after them"
        description: "Each response waits for the decision"
        recommended: true
      - label: "No, the person's signature is enough"
        description: "Responses complete straight away"
checklist:
  - "asks for about you"
  - "asks for what happened"
  - "asks for injury or damage"
defaults:
  expiry_days: 1
  verification: "none"
  order: "sequential"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
