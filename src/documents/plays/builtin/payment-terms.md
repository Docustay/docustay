---
name: payment-terms
title: "Payment terms"
description: "Use to add clear payment terms to any agreement: the amount, what it covers, when it is due and how it is paid."
kind: addon
category: addons
questions:
  - key: when
    question: "When is payment due?"
    must_ask: true
    options:
      - label: "When signing"
        description: "The payer enters their card while signing"
        recommended: true
      - label: "Within 14 days"
        description: "After the invoice"
      - label: "Within 30 days"
        description: "After the invoice"
  - key: what
    question: "What does the payment cover?"
    must_ask: true
    options:
      - label: "One session or service"
        description: "A single item"
        recommended: true
      - label: "A package"
        description: "A set number of sessions"
      - label: "A month"
        description: "A recurring period"
checklist:
  - "states the amount and currency"
  - "says what it covers"
  - "says when and how it is paid"
  - "says what happens if it is late"
flags:
  - topic: "Refunds and late payment"
    note: "Rules on refunds and late fees differ by place; check yours."
defaults:
  payment_terms: "The payer pays the stated amount for the stated service by the due date, by card through the signing page."
---

Write the payment terms in plain words: who pays, how much, what for, when it is due and how. If the person asked for a payment at signing, add a payment block for the person who pays with the exact amount they gave, and say the card is entered during signing.
