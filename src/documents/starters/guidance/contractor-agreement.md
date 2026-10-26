---
name: contractor-agreement
template: contractor-agreement
use: document
title: "Independent contractor agreement"
description: "Use when a company engages an individual as a contractor, not an employee, for defined work."
questions:
  - key: pay
    question: "How is the contractor paid?"
    must_ask: true
    options:
      - label: "Per project"
        description: "A fixed amount per project"
        recommended: true
      - label: "Per hour"
        description: "Invoiced hours at an agreed rate"
      - label: "Per month"
        description: "A fixed monthly amount"
  - key: tools
    question: "Who provides tools and equipment?"
    must_ask: false
    options:
      - label: "The contractor"
        description: "They use their own"
        recommended: true
      - label: "The company"
        description: "The company supplies what is needed"
checklist:
  - "states the person is a contractor and controls how the work is done"
  - "states the pay and the invoice terms"
  - "says who owns the work"
  - "says how it ends"
flags:
  - topic: "Contractor or employee status"
    note: "Whether someone counts as a contractor depends on how the work really happens, not only on what the paper says."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [confidentiality-addon, payment-terms]
---


