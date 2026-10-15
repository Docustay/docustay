---
name: media-consent-minors
template: media-consent-minors
use: document
title: "Media consent for a minor"
description: "Use when a parent or guardian chooses where photos and video of their child may be used."
questions:
  - key: choices
    question: "Where may the child appear?"
    must_ask: true
    multiSelect: true
    options:
      - label: "Website and social media"
        description: "Public online use"
        recommended: true
      - label: "Printed materials"
        description: "Brochures and posters"
      - label: "Internal use only"
        description: "Not published"
checklist:
  - "names the child and the guardian"
  - "lists each place the guardian agreed to"
  - "says the guardian can withdraw permission"
  - "has the guardian's signature and date"
flags:
  - topic: "Children's images"
    note: "Rules on publishing images of children are stricter than for adults; keep the choices exactly as the guardian made them."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


