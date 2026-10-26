---
name: event-waiver
template: event-waiver
use: document
title: "Event waiver"
description: "Use when a participant acknowledges the risks of an activity and agrees to take part at their own risk."
questions:
  - key: risk
    question: "How risky is the activity?"
    must_ask: true
    options:
      - label: "Low"
        description: "Light exercise or a social event"
        recommended: true
      - label: "Moderate"
        description: "Sport, workshop with equipment"
      - label: "High"
        description: "Adventure, climbing, contact sports"
  - key: minors
    question: "Will children take part?"
    must_ask: true
    options:
      - label: "No"
        description: "Adults only"
        recommended: true
      - label: "Yes"
        description: "A guardian signs for each child"
checklist:
  - "names the organizer and the event"
  - "describes the activity and its risks"
  - "says the person takes part at their own risk"
  - "has a signature and date"
flags:
  - topic: "Enforceability of the waiver"
    note: "Courts treat waivers differently, especially for children and for negligence."
  - topic: "Governing law and venue"
    note: "Governing law and where disputes are heard are the two clauses that most often matter later. Consider having someone who knows your state look at them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


