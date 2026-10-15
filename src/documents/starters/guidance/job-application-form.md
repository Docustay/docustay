---
name: job-application-form
template: job-application
use: form
title: "Job application form (link)"
description: "Use to publish job application as one link: receive every application in the same shape, so candidates are compared fairly."
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
  - "asks for the role"
  - "asks for experience"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
