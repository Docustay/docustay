---
name: photo-release-form
template: photo-release
use: form
title: "Photo release form"
description: "Use to collect a signed photo and media release from many people with one link, for example at an event."
questions:
  - key: check
    question: "Should people confirm their email first?"
    must_ask: true
    options:
      - label: "No, just sign"
        description: "Quickest for a crowd"
        recommended: true
      - label: "Yes, check the email"
        description: "The link and a code go to the address typed"
checklist:
  - "asks for name and email"
  - "shows where the pictures may be used"
  - "closes at a date or number you set"
flags:
  - topic: "Use of a person's image"
    note: "Check how you will use the pictures matches what the form says."
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
