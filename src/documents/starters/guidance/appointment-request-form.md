---
name: appointment-request-form
template: appointment-request
use: form
title: "Appointment request form (link)"
description: "Use to publish appointment request as one link: collect appointment requests with real choices, then confirm a time."
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
  - "asks for your appointment"
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
