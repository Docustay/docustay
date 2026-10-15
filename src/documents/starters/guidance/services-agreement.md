---
name: services-agreement
template: services-agreement
use: document
title: "Services agreement"
description: "Use when one person or business will do ongoing or project work for another and you want the scope, fee, term and ending written down."
questions:
  - key: fee_basis
    question: "How is the work paid for?"
    must_ask: true
    options:
      - label: "Fixed fee"
        description: "One price for the whole job"
        recommended: true
      - label: "Hourly"
        description: "An hourly rate with a cap or estimate"
      - label: "Monthly retainer"
        description: "The same amount every month"
  - key: term
    question: "How long does it run?"
    must_ask: true
    options:
      - label: "Until the work is finished"
        description: "Ends when the deliverables are accepted"
        recommended: true
      - label: "A fixed term"
        description: "For example six or twelve months"
      - label: "Month to month"
        description: "Either side can end it with notice"
  - key: ip
    question: "Who owns the finished work?"
    must_ask: false
    options:
      - label: "The client, once paid"
        description: "Typical for work made to order"
        recommended: true
      - label: "The provider"
        description: "The client gets a license to use it"
      - label: "Shared"
        description: "Each keeps what it brought; the new work is shared"
checklist:
  - "names both sides and their roles"
  - "states what is delivered and by when"
  - "states the fee and when it is due"
  - "says how either side can end it"
  - "has a signature and date for each side"
flags:
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
  - topic: "Limit of liability"
    note: "Caps on what either side can claim are enforceable differently in different places."
  - topic: "Ownership of the work"
    note: "If the work matters commercially, how ownership transfers is worth confirming for your situation."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [payment-terms, cancellation-policy, confidentiality-addon]
---


