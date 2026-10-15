---
name: volunteer-agreement
template: volunteer-agreement
use: document
title: "Volunteer agreement"
description: "Use when an organization takes on a volunteer and wants the role, hours, expectations and ending written down."
questions:
  - key: hours
    question: "How often will they volunteer?"
    must_ask: true
    options:
      - label: "Occasionally"
        description: "Now and then, as needed"
        recommended: true
      - label: "Regular hours"
        description: "Set days each week"
      - label: "For one event"
        description: "A single occasion"
  - key: minor
    question: "Is the volunteer under 18?"
    must_ask: true
    options:
      - label: "No"
        description: "An adult volunteer"
        recommended: true
      - label: "Yes"
        description: "A guardian must also sign"
checklist:
  - "names the volunteer and the organization"
  - "describes the role and the hours"
  - "says it is unpaid"
  - "says either side can end it"
flags:
  - topic: "Volunteer or employee"
    note: "If a volunteer is paid or expected like staff, the law may treat them as an employee."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


