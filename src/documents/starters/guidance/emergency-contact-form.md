---
name: emergency-contact-form
template: emergency-contact
use: form
title: "Emergency contact form (link)"
description: "Use to publish emergency contact as one link: keep up-to-date emergency contacts, confirmed by the person they belong to."
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
  - "asks for about you"
  - "asks for first contact"
  - "asks for second contact"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
