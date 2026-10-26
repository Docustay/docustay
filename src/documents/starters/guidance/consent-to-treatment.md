---
name: consent-to-treatment
template: consent-to-treatment
use: document
title: "Consent to treatment"
description: "Use when a client agrees to a service after reading what it is, what to expect, the risks and what it costs."
when_not: "Not a substitute for medical consent forms required by law for treatment."
questions:
  - key: service
    question: "What kind of service?"
    must_ask: true
    options:
      - label: "Coaching or counselling"
        description: "Sessions with a coach or counsellor"
        recommended: true
      - label: "Wellness or fitness"
        description: "Training or bodywork"
      - label: "Other professional service"
        description: "Describe it in your own words"
  - key: cancel
    question: "What is the cancellation rule?"
    must_ask: true
    options:
      - label: "24 hours' notice"
        description: "Late changes are charged"
        recommended: true
      - label: "48 hours' notice"
        description: "A longer window"
      - label: "No charge"
        description: "Cancel any time"
checklist:
  - "describes the service and what to expect"
  - "states the fee and cancellation rule"
  - "says the client can stop at any time"
  - "has the client's and the provider's signature"
flags:
  - topic: "Professional rules"
    note: "Some professions have their own consent rules; check what applies to yours before relying on this."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [cancellation-policy, payment-terms]
---


