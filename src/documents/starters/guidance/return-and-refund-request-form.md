---
name: return-and-refund-request-form
template: return-and-refund-request
use: form
title: "Return and refund request form (link)"
description: "Use to publish return and refund request as one link: handle every return in the same way, with evidence and a signed decision."
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
  - "asks for your order"
  - "asks for the return"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "sequential"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
