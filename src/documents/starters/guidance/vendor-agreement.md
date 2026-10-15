---
name: vendor-agreement
template: vendor-agreement
use: document
title: "Vendor agreement"
description: "Use when a vendor supplies goods or services on terms you want in writing: what, when, price, delivery and what happens if it goes wrong."
questions:
  - key: delivery
    question: "How is it delivered?"
    must_ask: true
    options:
      - label: "One delivery"
        description: "All at once on a date"
        recommended: true
      - label: "Scheduled deliveries"
        description: "Several dates"
      - label: "As ordered"
        description: "Each order is delivered separately"
  - key: payment
    question: "When is the vendor paid?"
    must_ask: true
    options:
      - label: "On delivery"
        description: "Within a few days of receiving it"
        recommended: true
      - label: "Net 30"
        description: "Thirty days after the invoice"
      - label: "Half up front"
        description: "Half now, half on delivery"
checklist:
  - "names the vendor and the buyer"
  - "lists what is supplied and the price"
  - "states the delivery and acceptance terms"
  - "says what happens with a late or faulty delivery"
flags:
  - topic: "Warranty and remedies"
    note: "What happens when goods or services fall short is the clause people argue about most."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [payment-terms]
---


