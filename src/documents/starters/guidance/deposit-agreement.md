---
name: deposit-agreement
template: deposit-agreement
use: document
title: "Deposit agreement"
description: "Use when a customer pays a deposit to hold a booking, item or place."
questions:
  - key: refund
    question: "Is the deposit refundable?"
    must_ask: true
    options:
      - label: "Refundable until a date"
        description: "Returned if they cancel in time"
        recommended: true
      - label: "Non-refundable"
        description: "Kept once paid"
      - label: "Credited to the final price"
        description: "Counts towards what they owe"
  - key: amount
    question: "How is the deposit set?"
    must_ask: true
    options:
      - label: "A fixed amount"
        description: "A stated amount"
        recommended: true
      - label: "A percentage"
        description: "A share of the price"
checklist:
  - "states the amount and what it holds"
  - "says when and how it is refunded or kept"
  - "says when the balance is due"
  - "has both signatures"
flags:
  - topic: "Refund rules"
    note: "Rules on keeping a deposit differ by place and by what you are selling."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [payment-terms, cancellation-policy]
---


