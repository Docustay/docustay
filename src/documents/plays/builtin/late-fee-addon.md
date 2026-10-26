---
name: late-fee-addon
title: "Late fee clause"
description: "Use to add a stated late fee to an agreement with payment dates."
kind: addon
category: addons
questions:
  - key: fee
    question: "What is the late fee?"
    must_ask: true
    options:
      - label: "A flat fee"
        description: "One fixed amount"
        recommended: true
      - label: "A percentage per month"
        description: "A share of the overdue amount"
  - key: grace
    question: "Is there a grace period?"
    must_ask: true
    options:
      - label: "Seven days"
        description: "After the due date"
        recommended: true
      - label: "None"
        description: "Applies the day after"
checklist:
  - "states the fee and when it applies"
  - "says the grace period"
flags:
  - topic: "Late fees"
    note: "Limits on late fees and interest are set by law in many places; check the rate you choose."
---

Add one short clause stating the late fee, when it starts and any grace period. Keep the amount reasonable and say it is not a penalty but a charge for the cost of late payment.
