---
title: Docustay is open source (AGPL-3.0)
description: The server and app are AGPL-3.0 and the SDKs, element and MCP server are MIT. Run it yourself, read it, and ask for a commercial licence only to embed or resell it.
---

# Open source and roadmap

The server and app are AGPL-3.0. The pieces you put inside your own software are MIT.

## Two licences, one line between them.

- **Server**: The API, the signing service and the worker
- **App**: The web app and this site
- **Asks**: Offer your changed version's source to people who use it over a network

- **SDKs**: @docustay2026/sdk and docustay for Python
- **Element**: <docustay-sign> and its React, Vue and Angular wrappers
- **Tools**: The MCP server, the agent skills, the CLI and the OpenAPI file

## Run it free, or pay for the extras.

Self-host Community is free: unlimited documents and templates, everything in the hosted Free plan, on your server. Self-host Pro adds the paid features for one business.

## Keep your copyright.

People who send changes keep their copyright and give the Docustay project a licence to use the change under any licence. That is what lets us offer a commercial licence next to the open one.

## What we are working on.

Passkey sign-in is behind a flag. Single sign-on through OpenID Connect is built for self-hosted installs.

The SDKs are built and tested and will move to the public registries; the changelog will say when.

## Every part and the licence it carries.

| Part | Licence | Where |
| --- | --- | --- |
| Server, worker, migrations, web app, this site | AGPL-3.0-or-later | LICENSE at the top of the repository |
| JavaScript SDK and Python SDK | MIT | sdk/js and sdk/python, each with its own LICENSE |
| The signing element and the React, Vue and Angular wrappers | MIT | sdk/embed, sdk/react, sdk/vue, sdk/angular |
| MCP server, Claude Code plugin, agent skills | MIT | sdk/mcp and sdk/claude-plugin |
| Command line | MIT | sdk/cli |
| OpenAPI file | MIT | sdk/openapi |

Every package carries its own LICENSE file, so a package you install is licensed on its own, wherever you install it from. This is general information, not legal advice.

## Four things a change has to have.

| Step | What happens |
| --- | --- |
| 1. Your agreement | Read the short contributor agreement. You keep your copyright, and you give the project a licence to use your change under any licence. Agree by adding a Signed-off-by line to the commit. |
| 2. A licence header | A new server or app file starts with a one-line SPDX header for the AGPL-3.0-or-later. A new file under sdk starts with the MIT one. |
| 3. A test that fails without it | Every change comes with a test that fails without the change. A test is never weakened to make it pass. Run the site check and the tests for the area you touched. |
| 4. Respect the Documents wall | The Documents code is a separate island. Nothing outside it names its tables or imports its files except through its two doors, and a gate fails on a new crossing. |

## Sign off a commit.

The sign-off line is how you agree to the contributor agreement. git adds it for you with the -s flag.

```
git commit -s -m "Fix the reminder wording"
```

## Welcome as it is, and talk first.

- **Bug fixes**: With a test that fails without the fix.
- **Documentation**: Documentation fixes.
- **Accessibility**: Accessibility fixes.
- **Templates**: New starters written in plain language, with every field placed on its blank.

- **New dependencies**: The licence must be MIT, ISC, BSD, Apache-2.0 or similar, and compatible with the AGPL-3.0.
- **Pricing, plans, limits**: Anything that changes what a plan includes.
- **Signing and sealing**: Anything that touches signing, sealing or the audit trail.
- **Security problems**: Do not open a public issue. Write to security@docustay.app.

## Read it, run it, and know what it sends.

| Point | In short |
| --- | --- |
| Nothing of ours inside | There is no key, certificate or password of ours in the self-hosted release. Every secret is created on your machine the first time it starts. |
| One daily ping | The worker sends one anonymous usage ping a day: a random install id, the version and five counts. Switch it off with DOCUSTAY_TELEMETRY=off. |
| A licence check on your machine | A Pro key is checked against a public key shipped with the install, on your machine, and keeps working up to 30 days offline. |

## Today, said plainly.

| Item | What to know |
| --- | --- |
| The repository | Opens with the self-hosted release. This site links to it then. |
| Packages | The SDKs, the signing element, the CLI and the MCP server are on the public package registries. |
| Single sign-on | OpenID Connect is built for self-hosted installs. |
| Passkeys | Behind a flag, with KEYSTONE_PASSKEYS=1. |
| Certifications | Docustay holds no security certification and claims none. |
| Protected health information | Docustay is not for protected health information yet. |

## The code is open; the name and logo are not.

The licences give you the right to use, change and share the code. They do not give you the right to use the name or the logo. You may say your product works with Docustay, uses the Docustay API or is compatible with it, in plain words, and you may run an unmodified copy and call it Docustay.

If you fork the code, choose your own name and logo, and do not use the name in a company, product, domain or app-store name. A commercial licence can include permission to use the name. This is how the project treats its name; it is not legal advice and not a registered-trademark claim.

## Three addresses for the AGPL-3.0 side.

| What | In short |
| --- | --- |
| Security | security@docustay.app. Include what you found, how to reproduce it and what you think it could do. We reply within three working days and credit you if you want. |
| Conduct | conduct@docustay.app. The code of conduct is short: discuss the work, not the person, and no harassment, personal attacks or sharing other people's private details. |
| Licensing | The contact form, with Licensing chosen, for a commercial licence, a question about the line between the two licences or permission to use the name. |


## Keep reading

- [Licensing](/licensing)
- [Changelog](/changelog)
- [Developers](/developers)
