---
name: payment-plan-agreement
template: payment-plan-agreement
use: document
title: "Payment plan agreement"
description: "Use when a customer agrees to pay an outstanding balance in installments."
questions:
  - key: schedule
    question: "How often are payments due?"
    must_ask: true
    options:
      - label: "Monthly"
        description: "The same day each month"
        recommended: true
      - label: "Every two weeks"
        description: "Fortnightly"
      - label: "Weekly"
        description: "Every week"
  - key: late
    question: "What happens on a missed payment?"
    must_ask: true
    options:
      - label: "A grace period then a reminder"
        description: "Seven days, then a notice"
        recommended: true
      - label: "The whole balance falls due"
        description: "Everything is payable at once"
      - label: "A late fee applies"
        description: "A stated fee is added"
  - key: method
    question: "How will they pay?"
    must_ask: false
    options:
      - label: "Card"
        description: "Through your payment link"
        recommended: true
      - label: "Bank transfer"
        description: "To your account"
      - label: "Either"
        description: "The customer chooses"
checklist:
  - "states the total owed and each payment with its date"
  - "says what happens if a payment is missed"
  - "says how payments are made"
  - "has both signatures"
flags:
  - topic: "Late fees and interest"
    note: "Rules on fees and interest on a debt differ by state and country."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [recurring-payments, late-fee-addon]
---


