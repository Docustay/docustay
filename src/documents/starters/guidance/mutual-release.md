---
name: mutual-release
template: mutual-release
use: document
title: "Mutual release"
description: "Use when two sides settle a matter and each releases the other from claims about it."
when_not: "Not for disputes that involve a court case already filed or a minor."
questions:
  - key: payment
    question: "Does money change hands?"
    must_ask: true
    options:
      - label: "No"
        description: "Each side simply releases the other"
        recommended: true
      - label: "Yes, one side pays"
        description: "An amount is paid for the release"
  - key: scope
    question: "What is released?"
    must_ask: true
    options:
      - label: "One named matter"
        description: "Only the dispute described"
        recommended: true
      - label: "All claims up to today"
        description: "Everything between them until the signing date"
checklist:
  - "names the sides and describes the matter"
  - "states exactly what is released"
  - "states any payment and when"
  - "has a signature and date for every side"
flags:
  - topic: "What is released"
    note: "A general release can give up claims you have not thought of yet; check the scope carefully."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


