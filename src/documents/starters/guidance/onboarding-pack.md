---
name: onboarding-pack
template: onboarding-pack
use: document
title: "Employee onboarding pack"
description: "Use to give a new starter one packet in several parts: welcome, handbook acknowledgement, policies and forms."
questions:
  - key: parts
    question: "Which parts should it include?"
    must_ask: true
    multiSelect: true
    options:
      - label: "Welcome and handbook"
        description: "Greeting and acknowledgement"
        recommended: true
      - label: "Policies"
        description: "Conduct, IT and safety"
      - label: "Forms"
        description: "Tax and bank detail forms"
checklist:
  - "lists each part"
  - "has the person's signature on the acknowledgements"
  - "gives a date to return it by"
flags:
  - topic: "Policy wording"
    note: "Policies have to match what your company really does and the rules where it operates."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


