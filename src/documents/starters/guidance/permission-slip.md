---
name: permission-slip
template: permission-slip
use: document
title: "Permission slip"
description: "Use when a parent or guardian allows a child to take part in an activity or trip."
questions:
  - key: what
    question: "What is the permission for?"
    must_ask: true
    options:
      - label: "A trip or outing"
        description: "A day or overnight outing"
        recommended: true
      - label: "A regular activity"
        description: "Something that happens every week"
      - label: "Medical or first aid"
        description: "Treatment in an emergency"
  - key: contact
    question: "Do you need an emergency contact?"
    must_ask: false
    options:
      - label: "Yes"
        description: "A phone number and name"
        recommended: true
      - label: "No"
        description: "Not needed"
checklist:
  - "names the child and the guardian"
  - "describes the activity, date and place"
  - "has the guardian's signature and date"
  - "has an emergency contact if there is a trip"
flags:
  - topic: "Medical and emergency permission"
    note: "If the slip allows treatment, make sure the wording matches what the activity really needs."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


