---
name: event-registration-form
template: event-registration
use: form
title: "Event registration form (link)"
description: "Use to publish event registration as one link: know who is coming, what they chose and what they need, before the day."
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
  - "asks for your registration"
  - "asks for so we can look after you"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
