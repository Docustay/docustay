---
name: offer-letter
template: offer-letter
use: document
title: "Offer letter"
description: "Use to offer someone a job: the role, start date, pay, hours and benefits."
questions:
  - key: type
    question: "What kind of job?"
    must_ask: true
    options:
      - label: "Full time"
        description: "Regular full-time hours"
        recommended: true
      - label: "Part time"
        description: "Fewer hours"
      - label: "Fixed term"
        description: "Ends on a set date"
  - key: pay
    question: "How is pay stated?"
    must_ask: true
    options:
      - label: "Annual salary"
        description: "A yearly amount"
        recommended: true
      - label: "Hourly rate"
        description: "An amount per hour"
  - key: atwill
    question: "Is employment at will?"
    must_ask: false
    options:
      - label: "Yes"
        description: "Either side can end it at any time"
        recommended: true
      - label: "No, with notice"
        description: "A notice period applies"
checklist:
  - "names the employer and the person"
  - "states the role, start date and pay"
  - "says whether employment is at will"
  - "says what the offer depends on, if anything"
  - "has a signature and date"
flags:
  - topic: "Employment terms and local law"
    note: "Employment law differs by state and country; at-will wording and benefits rules in particular."
  - topic: "Offer conditions"
    note: "If the offer depends on checks or references, they should be named here."
defaults:
  expiry_days: 7
  verification: "none"
  order: "sequential"
---


