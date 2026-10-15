---
name: rental-application-form
template: rental-application
use: form
title: "Rental application form (link)"
description: "Use to let applicants fill in and sign a rental application from one link in a listing."
questions:
  - key: check
    question: "Should applicants confirm their email first?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "Reduces fake applications"
        recommended: true
      - label: "No, just sign"
        description: "Quickest"
checklist:
  - "asks for name and email"
  - "asks for income and references"
  - "says the information will be checked"
flags:
  - topic: "Screening and fair housing"
    note: "Rules about what you may ask and how you decide are set by law."
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
