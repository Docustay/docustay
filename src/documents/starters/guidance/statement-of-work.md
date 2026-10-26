---
name: statement-of-work
template: statement-of-work
use: document
title: "Statement of work"
description: "Use to describe one piece of work in detail — objectives, scope, deliverables, schedule and acceptance — usually under an existing agreement."
questions:
  - key: under
    question: "Is this under an existing agreement?"
    must_ask: true
    options:
      - label: "Yes"
        description: "It refers to a signed agreement"
        recommended: true
      - label: "No"
        description: "It stands on its own"
  - key: accept
    question: "How is the work accepted?"
    must_ask: false
    options:
      - label: "Written approval"
        description: "The client approves in writing"
        recommended: true
      - label: "Automatic after review"
        description: "Accepted unless the client objects in a set time"
checklist:
  - "lists the deliverables and the dates"
  - "says what is out of scope"
  - "says how the work is accepted"
  - "states the fee or refers to where it is set"
flags:
  - topic: "Scope and what is not included"
    note: "Vague scope is the usual source of disputes; check every deliverable is named."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
addons: [payment-terms]
---


