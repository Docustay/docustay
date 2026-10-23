# The template library

Every workspace has 54 built-in templates beside its own. They are on the Templates page, and the same list is on the API, the SDKs, the CLI and the MCP server.

A built-in is a **read-only master**. There are two ways to use one:

- **Send straight from it.** A draft is made from the built-in with no copy, so it does **not** count toward Free's 5 new templates a month. The document counts toward the month's documents when it is sent, like any other.
- **Customize it.** You get your own editable copy. That is a new template, so it counts toward the monthly limit on Free (Pay as you go, Pro, Lifetime and self-hosted installs have none). On a workspace that asks for approval, a member's copy waits for an owner or admin.

A new version of a template never counts. A built-in can never be edited, renamed, retired or replaced by hand: ask for a copy instead.

| You want to | Call | Scope |
|---|---|---|
| List the built-in templates | `GET /api/v1/templates/library` | `templates:read` |
| One built-in with its fields and guidance | `GET /api/v1/templates/library/{slug}` | `templates:read` |
| A draft from a built-in | `POST /api/v1/templates/library/{slug}/documents` | `templates:write` |
| Your own copy of a built-in | `POST /api/v1/templates/library/{slug}/customize` | `templates:write` |
| Start a draft that asks the template's own questions | `POST /api/v1/drafts` with `{ "template": "services-agreement", "people": [...] }` | `drafts:write` |

`documents:read` and `documents:write` open the same routes.

```js
import { Docustay } from "@docustay2026/sdk";
const docustay = new Docustay(process.env.DOCUSTAY_API_KEY);
const { templates } = await docustay.listLibraryTemplates({ kind: "document" });
const draft = await docustay.draftFromLibraryTemplate("mutual-nda");   // not a new template
const mine = await docustay.customizeLibraryTemplate("mutual-nda", { name: "Our NDA" }); // a new template
```

From the command line: `docustay templates library` and `docustay templates customize mutual-nda`. The MCP server has `list_library_templates`, `get_library_template` and `draft_from_library_template`.

## Skills and playbooks

- A **skill** (the Plays page; `/api/v1/plays`) guides how a document is written: a built-in add-on such as a late fee, a house style such as Plain English, or your own (Pro). A skill never picks a template. Each template carries its own questions, facts and checklist as guidance, which Scribe reads after it finds the template.
- A **playbook** (`/api/v1/playbooks`) is a pack of templates and skills for one job, such as a new-tenant pack. Switching one on puts its templates first on the Templates page and for Scribe. The built-in packs are free to switch on; making your own is Pro. `POST /api/v1/playbooks/{name}/enable` with `{ "enabled": true }` switches one.

## Draft from a template with its own questions

`POST /api/v1/drafts` (part of Docustay Pro; a Free workspace gets a 403 that says so) starts from a built-in Document template and asks that template's questions first (up to four at a time, each with two to four options). Answer them with `POST /api/v1/drafts/{draftRef}/answers`. Nothing is ever sent: a draft is a draft.

```bash
curl -X POST https://app.docustay.app/api/v1/drafts \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
  -d '{ "template": "services-agreement", "people": [{ "name": "Ana Client", "email": "ana@example.com", "role": "Client" }] }'
```

## Settings → Templates

An owner or admin can ask that a member's templates wait for approval (on by default) and can hide the built-in library. Hiding it removes the built-in tabs and refuses new use and customizing; a built-in that a document already uses keeps working. Self-hosted installs print every built-in on install and bring them up to date on upgrade.
