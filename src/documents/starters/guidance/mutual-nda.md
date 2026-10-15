---
name: mutual-nda
template: mutual-nda
use: document
title: "Mutual non-disclosure agreement"
description: "Use when two sides will share private information and each must keep the other's secret."
questions:
  - key: length
    question: "How long must secrets be kept?"
    must_ask: true
    options:
      - label: "Two years"
        description: "A common period"
        recommended: true
      - label: "Five years"
        description: "For more sensitive information"
      - label: "For as long as it stays secret"
        description: "No end date"
  - key: purpose
    question: "What is it for?"
    must_ask: true
    options:
      - label: "Exploring a deal or partnership"
        description: "Talks that may or may not lead to a contract"
        recommended: true
      - label: "A project already agreed"
        description: "Information shared to do the work"
      - label: "Hiring or investing"
        description: "A candidate or investor sees private information"
checklist:
  - "names both sides"
  - "describes what counts as confidential"
  - "lists what is not confidential"
  - "states how long the duty lasts"
  - "says what happens to the information at the end"
flags:
  - topic: "Length of the duty"
    note: "A very long duty can be harder to enforce; pick the shortest period that protects you."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


