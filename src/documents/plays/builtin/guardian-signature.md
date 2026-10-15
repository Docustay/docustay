---
name: guardian-signature
title: "Guardian signature"
description: "Use when a child takes part: adds a parent or guardian as the person who signs for them."
kind: addon
category: addons
questions:
  - key: who
    question: "Who signs for the child?"
    must_ask: true
    options:
      - label: "A parent"
        description: "Either parent"
        recommended: true
      - label: "A legal guardian"
        description: "Someone with guardianship"
      - label: "Either"
        description: "A parent or a legal guardian"
checklist:
  - "adds the guardian as a signer"
  - "names the child"
  - "says the guardian signs on the child's behalf"
flags:
  - topic: "Who may sign for a child"
    note: "Who counts as a guardian can depend on local law and on custody arrangements."
---

Add a second person to sign: the parent or guardian, with their own signature and date. Name the child in the text and say the guardian signs for the child.
