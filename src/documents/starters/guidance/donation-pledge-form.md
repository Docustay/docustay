---
name: donation-pledge-form
template: donation-pledge
use: form
title: "Donation pledge form (link)"
description: "Use to publish donation pledge as one link: record pledges clearly, so you can follow up and thank donors as they wish."
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
  - "asks for your pledge"
  - "asks for thanks and recognition"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
