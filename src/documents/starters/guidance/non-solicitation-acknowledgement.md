---
name: non-solicitation-acknowledgement
template: non-solicitation-acknowledgement
use: document
title: "Non-solicitation acknowledgement"
description: "Use when an employee acknowledges and agrees not to solicit the company's customers or staff."
when_not: "Check the rules where the employee lives before using it for roles in states that limit these terms."
questions:
  - key: duration
    question: "For how long?"
    must_ask: true
    options:
      - label: "Twelve months after leaving"
        description: "A common period"
        recommended: true
      - label: "Six months"
        description: "A lighter restriction"
      - label: "Twenty-four months"
        description: "A heavier restriction"
checklist:
  - "names the employee and the company"
  - "says who and what may not be solicited"
  - "states the period"
  - "has a signature and date"
flags:
  - topic: "Whether it is enforceable where the person works"
    note: "Rules on restricting what people may do after leaving a job differ a lot by state and country."
  - topic: "Duration"
    note: "Longer periods are less likely to hold up."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


