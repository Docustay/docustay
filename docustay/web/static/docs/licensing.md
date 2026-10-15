# Licensing

The licences are split on purpose: the server and app are under the **GNU Affero General Public License, version 3 or later**, and the pieces you put inside your own software are under the **MIT licence**. This page is general information, not legal advice; the licence texts in the repository are what apply.

## Which licence covers what

| Part | Licence | Where to find it |
|---|---|---|
| Server, worker, migrations, web app, public site | AGPL-3.0-or-later | `LICENSE` at the top of the repository |
| JavaScript SDK `@docustay2026/sdk`, Python SDK `docustay` | MIT | `sdk/js/LICENSE`, `sdk/python/LICENSE` |
| `<docustay-sign>` element and the React, Vue and Angular wrappers | MIT | `sdk/embed`, `sdk/react`, `sdk/vue`, `sdk/angular` |
| MCP server, Claude Code plugin, agent skills | MIT | `sdk/mcp`, `sdk/claude-plugin` |
| OpenAPI file | MIT | `docustay/web/static/api/openapi.json` |

Every package carries its own `LICENSE` file, so a package you install is licensed on its own, wherever you install it from.

## The line between the two

Calling the Docustay API over HTTP, or using the SDKs, does **not** make your application AGPL. Your code is not a derivative work of the server. Copying or modifying **server code** and letting other people use that code over a network does bring the AGPL-3.0 into play for that code: you offer those people the source of your version. Showing the Docustay signing page inside your site in a frame is using a service, not copying code. See [embedding](/docs/embedding) for how the frame is set up.

## Which of three paths you are on

1. **Hosted by us.** Nothing to license. You use the service under the [Terms](/legal/terms).
2. **Self-host under the AGPL-3.0.** Community is free. A Pro licence key is $390 a year per install, for your own business only, and is described on [Self-host](/self-host).
3. **Commercial licence.** From about $3,000 a year, quoted for your volume, for embedding Docustay in a product, white-labelling it, reselling it, or keeping a private fork without publishing your changes. Use the [contact form](/contact) and choose "Licensing".

### When a commercial licence is needed

You need one if you want to:

- embed Docustay in a product you offer to others;
- white-label it;
- resell it;
- keep a private fork without publishing your changes.

## What counts as an install

One install is one running Docustay with one database.

- A staging or backup copy of the same install does not count as a separate install.
- A development copy on a developer's own machine does not count as a separate install.
- Two production databases are two installs.

## After you cancel

Cancelling Pro moves the workspace to Free.

- Documents already sent or signed stay readable and downloadable.
- You can export everything at any time.
- Sending is then limited by the Free limits (see [Errors, retries and limits](/docs/errors-and-limits.md)).

## For people who contribute

New server and app files start with a one-line licence header, and every SDK file starts with the MIT one:

```
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-License-Identifier: MIT
```

A change is accepted from someone who agrees to the short contributor agreement, which lets the owner offer a commercial licence next to the open one. Add your agreement to the commit:

```
git commit -s -m "Fix the reminder wording"
```

The full explanation, in plain words, is on the [Licensing page](/licensing).
