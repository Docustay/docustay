---
name: move-in-move-out-checklist-form
template: move-in-move-out-checklist
use: form
title: "Move-in and move-out condition checklist form (link)"
description: "Use to publish move-in and move-out condition checklist as one link: agree the condition of a property in writing, with photos, at both ends of a tenancy."
questions:
  - key: check
    question: "Should people confirm their email before they sign?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "You know each address is real"
        recommended: true
      - label: "No, just sign"
        description: "Quickest for the person"
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
  - "asks for the property"
  - "asks for condition by room"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "sequential"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
