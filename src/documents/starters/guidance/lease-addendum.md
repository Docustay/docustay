---
name: lease-addendum
template: lease-addendum
use: document
title: "Lease addendum"
description: "Use when you change an existing lease on one subject: a pet, a parking space, a guest, a repair."
questions:
  - key: subject
    question: "What is the addendum about?"
    must_ask: true
    options:
      - label: "A pet"
        description: "Permission, deposit and rules"
        recommended: true
      - label: "Parking"
        description: "A space and its rules"
      - label: "Another occupant"
        description: "Adding a person to the lease"
      - label: "Something else"
        description: "Describe it in your own words"
checklist:
  - "names the lease it changes"
  - "states exactly what changes"
  - "says all other terms stay the same"
  - "has a signature and date from each side"
flags:
  - topic: "Effect on the lease"
    note: "An addendum should match what the main lease allows; check the lease says how it can be changed."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


