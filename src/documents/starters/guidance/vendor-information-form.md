---
name: vendor-information-form
template: vendor-information
use: form
title: "Vendor information form (link)"
description: "Use to publish vendor information as one link: set up suppliers with complete, signed details."
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
checklist:
  - "asks for your business"
  - "asks for contacts"
  - "asks for what you supply"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
