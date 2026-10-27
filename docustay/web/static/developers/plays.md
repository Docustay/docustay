---
title: Plays and Playbooks API
description: List the built-in Plays, draft from one or customize it, and manage your own Plays and Playbooks over the API. Built-in templates are free; your own Plays and Playbooks are on Pro.
---

# Plays and Playbooks API

List the built-in templates, draft from one, and publish your own Plays and Playbooks.

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

The built-in templates, with what each asks and who signs.

```
curl https://app.docustay.app/api/v1/templates/library \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"
```

## Which scope does which job.

| Scope | Lets the key |
| --- | --- |
| plays:read | Read skills and playbooks |
| plays:write | Make and change skills and playbooks |
| templates:read | Read the template library |
| templates:write | Make a draft from, or customize, a built-in template |
| drafts:write | Make drafts only; nothing in it sends a document |

Reading and using the template library is on every plan; skills and playbooks of your own are on Pro.

## It asks its questions, then drafts.

Each built-in template carries its own questions. Pick one and answer them; you review the draft before anything is sent.

**Free to use.** Built-in templates and skills are free. Your own skills and playbooks are on Pro.

## The calls, by what you want to do.

| You want to | Call | Scope |
| --- | --- | --- |
| List the built-in templates | GET /api/v1/templates/library | templates:read |
| One built-in with its fields and guidance | GET /api/v1/templates/library/{slug} | templates:read |
| A draft from a built-in | POST /api/v1/templates/library/{slug}/documents | templates:write |
| Your own copy of a built-in | POST /api/v1/templates/library/{slug}/customize | templates:write |
| A draft that asks the template's questions | POST /api/v1/drafts | drafts:write |

documents:read and documents:write open the same routes.

## Draft from a built-in, or make a copy.

Drafting from a built-in makes no copy, so it does not count toward the Free plan's new templates. Customizing makes your own template, which does.

```
const { templates } = await docustay.listLibraryTemplates();
const draft = await docustay.draftFromLibraryTemplate("mutual-nda");   // not a new template
const mine = await docustay.customizeLibraryTemplate("mutual-nda", { name: "Our NDA" });   // a new template
```

## Start a draft that asks its own questions.

POST /api/v1/drafts replies needs_input with up to four questions, each with two to four options, until the must-ask ones are answered. Then it replies draft. Nothing is sent.

```
curl -X POST https://app.docustay.app/api/v1/drafts \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
  -d '{ "template": "services-agreement", "people": [{ "name": "Ana Client", "email": "ana@example.com", "role": "Client" }] }'
```

## Skills and playbooks.

| Topic | Detail |
| --- | --- |
| Skill | Guides how a document is written, such as a late fee or Plain English. It never picks a template. Served at /api/v1/plays. |
| Playbook | A pack of templates and skills for one job. The built-in packs are free to switch on; your own are Pro. Served at /api/v1/playbooks. |

## What uses up the Free plan's new templates.

| Action | Counts? |
| --- | --- |
| Customize a built-in into your own copy | Yes, it is a new template |
| Send or draft straight from a built-in | No, no copy is made (the sent document counts as a document) |
| A new version of a template you have | No |
| Deleting a template | Does not give one back |
| On Pay as you go, Pro, Lifetime or a self-hosted install | No template limit |

At the limit the API answers 403 with error.detail.code plan_template_limit.

## Every built-in is an ordinary template.

|  | A built-in template |
| --- | --- |
| Who it goes to | The people you name |
| How you use it | Send straight from it, or draft from it |
| Where the list is | GET /api/v1/templates/library |
| Same list in | The SDKs, the CLI and the MCP server |

An owner or admin can hide the built-in library in Settings, Templates; a built-in that you already use keeps working.

## Where to go from here.

| Next | Why | Page |
| --- | --- | --- |
| Hand it to an assistant | The same library is available as tools. | Agents: /developers/agents |
| Pick the right scope | plays:read, plays:write and drafts:write are separate scopes, so a key can do one job. | Keys and security: /developers/keys-and-security |
| Send what you drafted | A draft becomes a document through the send call. | REST API: /developers/api |

## The same library, in two commands.

Useful when you want a template without opening the app.

**templates library.** Lists the built-in templates. Add --json for something a script can read.

**templates customize.** Makes your own copy of a built-in template, by its slug, with a name you choose. The original never changes, and the copy is a new template.

**playbooks on and off.** playbooks list shows the packs of templates and skills, and playbooks on or off switches one by name. Your own skills and playbooks are on Pro.

## Questions

**What is a skill?**

A reusable instruction for how a document is written, such as a late-fee clause or Plain English. Templates carry their own questions.

**Which are free?**

The built-in templates, add-ons and house styles are free to list and use on every plan. Your own skills and playbooks are on Pro.


## Keep reading

- [Scribe](/features/scribe)
- [Agents](/developers/agents)
- [REST API](/developers/api)
