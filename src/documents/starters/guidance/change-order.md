---
name: change-order
template: change-order
use: document
title: "Change order"
description: "Use to record a written change to an existing agreement: what changes, the price effect and the new dates."
questions:
  - key: effect
    question: "What does the change do to the price?"
    must_ask: true
    options:
      - label: "No change to the price"
        description: "Scope or dates change only"
        recommended: true
      - label: "Adds to the price"
        description: "An extra amount is due"
      - label: "Reduces the price"
        description: "A credit or lower fee"
  - key: dates
    question: "Does it move the dates?"
    must_ask: false
    options:
      - label: "No"
        description: "Deadlines stay the same"
        recommended: true
      - label: "Yes"
        description: "New dates are written in"
checklist:
  - "names the agreement it changes"
  - "states exactly what changes"
  - "states the price and date effect"
  - "says everything else stays as it was"
flags:
  - topic: "Effect on the original agreement"
    note: "A change order only works if the original agreement allows changes in this way; check how it says changes are made."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


