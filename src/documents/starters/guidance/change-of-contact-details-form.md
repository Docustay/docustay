---
name: change-of-contact-details-form
template: change-of-contact-details
use: form
title: "Change of contact details form (link)"
description: "Use to publish change of contact details as one link: keep records current, with a signed request for every change."
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
  - "asks for who you are"
  - "asks for your new details"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
