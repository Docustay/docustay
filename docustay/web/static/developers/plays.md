---
title: Template library API for documents
description: List the 54 built-in templates, draft from one or customize it, and manage skills and playbooks over the API. Built-in templates are free; your own skills and playbooks are on Pro.
---

# Templates and skills API

List the built-in templates, draft from one, and publish your own skills and playbooks.

## The routes.

- **GET**: /api/v1/templates/library: the built-in templates
- **GET**: /api/v1/templates/library/{slug}
- **POST**: /api/v1/templates/library/{slug}/documents
- **POST**: /api/v1/templates/library/{slug}/customize

- **GET**: /api/v1/plays: skills
- **POST**: /api/v1/plays: publish your own
- **GET**: /api/v1/playbooks: packs of templates and skills
- **POST**: /api/v1/drafts: a draft from a template

## List the built-in templates.

The 24 Document templates and 30 Form templates, with what each asks and who signs.

```
curl https://app.docustay.app/api/v1/templates/library \
  -H "Authorization: Bearer $DOCUSTAY_KEY"
```

## Questions

**What is a skill?**

A reusable instruction for how a document is written, such as a late-fee clause or Plain English. Templates carry their own questions.

**Which are free?**

The built-in templates, add-ons and house styles are free to list and use on every plan. Your own skills and playbooks are on Pro.


## Keep reading

- [Scribe](/product/scribe)
- [Agents](/developers/agents)
- [REST API](/developers/api)
