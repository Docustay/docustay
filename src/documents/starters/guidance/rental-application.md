---
name: rental-application
template: rental-application
use: document
title: "Rental application"
description: "Use to collect an applicant's details, address and income history for a rental."
when_not: "Not a lease; a separate agreement is signed if the application is accepted."
questions:
  - key: fee
    question: "Is there an application fee?"
    must_ask: false
    options:
      - label: "No"
        description: "No fee"
        recommended: true
      - label: "Yes"
        description: "A fee is collected separately"
checklist:
  - "asks for the applicant's contact details and current address"
  - "asks for income and references"
  - "says the information will be checked"
  - "has the applicant's signature"
flags:
  - topic: "Screening and fair housing"
    note: "Rules about what you may ask and how you may decide are set by law; keep the questions to what you really need."
defaults:
  expiry_days: 30
  verification: "none"
  order: "sequential"
---


