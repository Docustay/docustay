---
name: referral-agreement
template: referral-agreement
use: document
title: "Referral agreement"
description: "Use when one company rewards another person for sending customers it wins."
questions:
  - key: reward
    question: "What is the reward?"
    must_ask: true
    options:
      - label: "A percentage of the first sale"
        description: "For example 10% of the first order"
        recommended: true
      - label: "A fixed amount"
        description: "The same amount per referral"
      - label: "A percentage while they stay a customer"
        description: "Ongoing, for a set period"
  - key: when
    question: "When does the reward become payable?"
    must_ask: true
    options:
      - label: "After the customer pays"
        description: "Not before money arrives"
        recommended: true
      - label: "After the customer signs"
        description: "As soon as the deal is signed"
checklist:
  - "defines what counts as a referral"
  - "states the reward and when it is paid"
  - "says how long the agreement runs"
  - "says either side can end it"
flags:
  - topic: "How rewards are calculated and paid"
    note: "Rewards tied to sales can have rules about disclosure and licensing in some industries."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [payment-terms]
---


