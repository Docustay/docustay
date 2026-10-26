---
name: media-consent-form
template: media-consent-minors
use: form
title: "Media consent form for minors"
description: "Use to collect each guardian's media choices for their child with one link."
questions:
  - key: check
    question: "Should guardians confirm their email first?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "Recommended for children's images"
        recommended: true
      - label: "No, just sign"
        description: "Quickest"
checklist:
  - "asks for the guardian's name and email"
  - "lists each place the images may be used"
flags:
  - topic: "Children's images"
    note: "Keep each guardian's choices exactly as given."
defaults:
  expiry_days: 1
  verification: "none"
  order: "parallel"
---

Publish this ready-made as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
