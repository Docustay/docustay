---
name: recurring-payments
title: "Recurring payments"
description: "Use to add an agreement to pay in regular instalments or a repeating amount."
kind: addon
category: addons
questions:
  - key: every
    question: "How often?"
    must_ask: true
    options:
      - label: "Monthly"
        description: "Same amount each month"
        recommended: true
      - label: "Weekly"
        description: "Every week"
      - label: "Every two weeks"
        description: "Fortnightly"
  - key: end
    question: "How does it end?"
    must_ask: true
    options:
      - label: "After a set number of payments"
        description: "A fixed count"
        recommended: true
      - label: "Until cancelled"
        description: "Either side gives notice"
checklist:
  - "states the amount and the schedule"
  - "says how it ends"
  - "says how to cancel"
flags:
  - topic: "Automatic payments"
    note: "Rules on authorising repeat card payments differ by place; make sure the person clearly agrees."
---

Write the schedule in words only. The document records the agreement; any repeating card charge is set up separately by the person in their payment settings, never by the assistant.
