---
name: permission-slip-form
template: permission-slip
use: form
title: "Permission slip form"
description: "Use to collect a guardian's signed permission slip from many families with one link."
questions:
  - key: check
    question: "Should guardians confirm their email first?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "Safer for children's forms"
        recommended: true
      - label: "No, just sign"
        description: "Quickest"
checklist:
  - "asks for the guardian's name and email"
  - "shows the activity, date and place"
  - "closes when the trip is full"
flags:
  - topic: "Children's permission"
    note: "Keep the form's wording exactly matched to the activity."
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
