---
name: cancellation-policy
title: "Cancellation policy"
description: "Use to add a clear cancellation and refund rule to a service agreement."
kind: addon
category: addons
questions:
  - key: notice
    question: "How much notice is needed?"
    must_ask: true
    options:
      - label: "24 hours"
        description: "Late cancellations are charged"
        recommended: true
      - label: "48 hours"
        description: "A longer window"
      - label: "7 days"
        description: "For larger bookings"
  - key: late
    question: "What happens if it is late?"
    must_ask: true
    options:
      - label: "The full fee is charged"
        description: "Nothing refunded"
        recommended: true
      - label: "Half is charged"
        description: "Half refunded"
      - label: "A credit is given"
        description: "Moved to another date"
checklist:
  - "states the notice period"
  - "states what happens when notice is short"
  - "says how to cancel"
flags:
  - topic: "Fees for late cancellation"
    note: "Rules on keeping fees for cancellations differ by place; check yours."
---

Write the cancellation rule as one short clause: the notice needed, what happens if it is short, and how to cancel (reply to the email or message the provider).
