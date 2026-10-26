---
name: invoice-approval
template: invoice-approval
use: document
title: "Invoice approval"
description: "Use to record an invoice, what it is for and the approver's decision."
questions:
  - key: who
    question: "Who approves?"
    must_ask: true
    options:
      - label: "One approver"
        description: "A single named person"
        recommended: true
      - label: "Two approvers"
        description: "Both must approve"
checklist:
  - "names the invoice and the amount"
  - "says what it is for"
  - "has the approver's decision and signature"
flags:
  - topic: "Approval authority"
    note: "Check the approver is allowed to approve this amount under your own rules."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


