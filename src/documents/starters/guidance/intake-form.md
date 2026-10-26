---
name: intake-form
template: intake-form
use: document
title: "Client intake form"
description: "Use when a new client gives their details and agreement before a first appointment."
questions:
  - key: collect
    question: "What do you need to collect?"
    must_ask: true
    multiSelect: true
    options:
      - label: "Contact details only"
        description: "Name, email, phone"
        recommended: true
      - label: "Contact and background"
        description: "Plus goals or history"
      - label: "Contact and consent"
        description: "Plus agreement to your terms"
checklist:
  - "asks only for what you need"
  - "says how the information will be used and kept"
  - "has the client's signature and date"
flags:
  - topic: "Sensitive information"
    note: "If you collect health or other sensitive details, check the rules for storing and sharing them where you work."
defaults:
  expiry_days: 14
  verification: "none"
  order: "parallel"
---


