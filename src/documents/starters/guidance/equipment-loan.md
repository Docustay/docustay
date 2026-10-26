---
name: equipment-loan
template: equipment-loan
use: document
title: "Equipment loan agreement"
description: "Use when you lend an item to someone and want its condition, return date and what happens if it is damaged on paper."
questions:
  - key: deposit
    question: "Is a deposit held?"
    must_ask: true
    options:
      - label: "No"
        description: "No deposit"
        recommended: true
      - label: "Yes"
        description: "A deposit is held until it is returned"
  - key: damage
    question: "Who pays for damage or loss?"
    must_ask: true
    options:
      - label: "The borrower"
        description: "Repair or replacement cost"
        recommended: true
      - label: "Normal wear is accepted"
        description: "Only damage beyond normal use"
checklist:
  - "describes the item and its condition"
  - "gives the return date"
  - "says who pays for damage or loss"
  - "has both signatures"
flags:
  - topic: "Liability for damage or loss"
    note: "What a borrower must pay and when depends on the item's value and where you are."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [payment-terms]
---


