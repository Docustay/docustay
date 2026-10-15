---
name: photo-release
template: photo-release
use: document
title: "Photo and media release"
description: "Use to get permission to take and use someone's photos or video, and say where they may appear."
when_not: "For a child, use the media consent for a minor so a parent or guardian signs."
questions:
  - key: use
    question: "Where may it be used?"
    must_ask: true
    multiSelect: true
    options:
      - label: "Our website and social media"
        description: "Public online use"
        recommended: true
      - label: "Print and marketing"
        description: "Brochures, posters, ads"
      - label: "Internal use only"
        description: "Never published outside the organization"
  - key: duration
    question: "For how long?"
    must_ask: true
    options:
      - label: "No end date"
        description: "Until the person withdraws in writing"
        recommended: true
      - label: "One year"
        description: "Then it lapses"
      - label: "This event only"
        description: "Not for later use"
checklist:
  - "names the person and the organization"
  - "says where the pictures may be used"
  - "says how long"
  - "says how to withdraw permission"
flags:
  - topic: "Use of a person's image"
    note: "Image rights vary; for ads or paid use, check what applies where you are."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


