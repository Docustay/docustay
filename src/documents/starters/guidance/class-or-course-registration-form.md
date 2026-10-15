---
name: class-or-course-registration-form
template: class-or-course-registration
use: form
title: "Class or course registration form (link)"
description: "Use to publish class or course registration as one link: enroll students with everything you need before the first class."
questions:
  - key: check
    question: "Should people confirm their email before they sign?"
    must_ask: true
    options:
      - label: "Yes, check the email"
        description: "You know each address is real"
        recommended: true
      - label: "No, just sign"
        description: "Quickest for the person"
checklist:
  - "asks for about you"
  - "asks for the course"
  - "asks for participant"
defaults:
  expiry_days: 1
  verification: "email_code"
  order: "parallel"
---

Publish this ready-made form as one link anyone can open, fill in and sign. Every response is its own signed document and the person is saved to People.
