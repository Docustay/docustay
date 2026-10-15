---
name: rsvp-form
template: rsvp
use: form
title: "RSVP form (link)"
description: "Use to publish rsvp as one link: get a clear head count and choices in one reply."
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
  - "asks for your reply"
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
