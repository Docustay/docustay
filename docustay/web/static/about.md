---
title: About Docustay and the facts
description: We build Docustay, we read every message sent to hello@docustay.app, and we say plainly what we will not do. The facts, in one place: plans and prices, limits, licence, SDKs, security basics and hosting.
---

# About Docustay

Docustay is an open source e-signature API and app (AGPL-3.0): it sends documents for signature and keeps the proof. We build it, and we read every message. The facts, last checked 12 October 2026, are further down.

## A signing tool with its work shown.

Docustay is a way to send a document, get it signed on any device, and keep the signed copy with a certificate of who signed when.

The code is licensed under the AGPL-3.0. The repository will be public when we publish it, and this site will link to it then.

## With checks.

We write what a page says from a list of things the product does, and the build fails when a page names something that is not on the list.

Every code sample on this site was run before it was published.

## Five promises.

We will not sell your data. We will not read your documents. We will not claim a certification we do not hold. We will not show social proof we do not have. We will not make you talk to a salesperson to see a price.

## What each plan costs.

| Item | Detail |
| --- | --- |
| Free | $0, for one person. 15 documents and 5 new templates a month, and 10 AI drafts a month. API, webhooks and test mode included. |
| Pay as you go | $5 per team member a month. 15 documents a month included, then $0.50 each. 10 AI drafts included, then $0.30 each. |
| Pro | $39 a month, flat for the whole workspace, with unlimited team members, signers, documents and templates. 100 AI drafts a month, then $0.30 each. |
| Founders price | $25 a month for as long as the subscription stays active, for anyone who subscribes by January 27, 2027 (Pacific time). |
| Lifetime | $299 once, for the first 200 workspaces. Pro for as long as Docustay runs the hosted service, with 50 AI drafts a month. |
| Your budget | $50 a month unless you change it, with alerts at 50%, 80% and 100%. Sending and AI drafting pause at 100%. |
| Self-host Community | Free under the AGPL-3.0, on your own server. |
| Self-host Pro | $390 per install, for your own business. |
| Commercial licence | From about $3,000 a year, to embed, white-label, resell or keep a private fork. |
| Payments in a document | Docustay adds 2% on Free and Pay as you go and 0% on Pro and Lifetime, on top of Stripe's fees. |

## What the plans allow.

| Item | Detail |
| --- | --- |
| Documents a month | Free: 15, then sending stops. Pay as you go: 15 included, then $0.50 each. Pro and Lifetime: unlimited. A document counts when it is sent. |
| New templates a month | Free: 5. Every other plan and self-hosted installs: no limit. |
| Sending to a list | On every plan. Free sends to up to 15 people at a time. |
| Team members | Free: one, the owner. Pay as you go: $5 per team member a month. Pro and Lifetime: unlimited. |
| Emails a day | Free and Pay as you go: 25. Pro and Lifetime: 500. |
| Upload size | Free and Pay as you go: 25 MB. Pro and Lifetime: 100 MB. |
| API | 600 requests a minute for each key. |
| AI drafts a month | Free: 10, then drafting stops. Pay as you go: 10, then $0.30 each. Pro: 100, then $0.30 each. Lifetime: 50, then $0.30 each. A failed or empty draft is never charged. |
| Language | The app, the signing page, the emails and this website are in English. |

## Two licences.

| Item | Detail |
| --- | --- |
| Server and app | AGPL-3.0. |
| SDKs, signing element, MCP server, CLI, OpenAPI file | MIT. |
| Embedding, white-label, resale, private fork | Needs a commercial licence. |

## How to build on it.

| Item | Detail |
| --- | --- |
| REST API | OpenAPI 3.1 at https://docustay.app/openapi.json, with idempotency keys, key scopes, key expiry, an address allowlist and an API log. |
| SDKs | JavaScript, TypeScript and Python. Clients for Go, PHP and C# are generated from the API description. |
| Command line | Login, send --test, listen, verify and logs. |
| Webhooks | Seven signed document events, replay from the log and secret rotation. |
| Test mode | Test keys send nothing except to the sender, and carry a TEST watermark. |

## What protects a signed document.

| Item | Detail |
| --- | --- |
| Seal | The finished PDF is sealed with a digital signature over the whole file. |
| Certificate | A certificate of completion as the last page: who signed, when, and a hash of the file. |
| Audit log | Every step on a document, with a CSV export. |
| Sign-in | Two-step sign-in with an authenticator app or a passkey, which an owner can require for the whole team. |
| What a signature is | A simple electronic signature with a strong record and a digital seal. No qualified signatures, no identity checks, no legal advice. |
| Certifications | Docustay holds no security certification and claims none. |

## Where it runs.

| Item | Detail |
| --- | --- |
| Hosted service | The United States, on Railway. You cannot yet choose a region. |
| Self-hosted | Wherever you run it. |
| Sub-processors | Listed on the trust page, with what each one handles. |

## Six things you can do with it.

| What | In short |
| --- | --- |
| Send a document | Upload a PDF or start from a template, place the fields, and send it by email. |
| Sign on any device | The signing page works on a phone or a computer, with no account for the signer. |
| Keep the proof | Every finished document is sealed, and the last page is a certificate: who signed, when, and a hash of the file. |
| Start from a template | More than 50 built-in templates, with their roles and fields already placed. |
| Build on the API | A REST API with an OpenAPI file, SDKs, a command line, signed webhooks and a test mode. |
| Run it yourself | The same software on your own server, under the AGPL-3.0, with your own database and files. |

## Words are checked against the product.

- **A list of capabilities**: Each thing the product does has an entry with a state. A page may name a capability only if it is on the list.
- **A build that fails**: The build fails when a page names something that is not on the list, or names one that is not ready yet.
- **Numbers**: Each number in the facts above is compared with the value the code enforces, and a difference fails the build.

- **Code**: Every code sample on this site was run before it was published.
- **Commands**: A command line example is shown only after its flags were checked against the tool's own help.
- **Output**: We do not write output we did not see.

## Things that are not true today, so we do not say them.

- **Certifications**: Docustay holds no security certification and claims none.
- **Health data**: Docustay is not for protected health information yet.
- **Customer numbers**: We do not publish customer counts or logos.

- **The signature**: A simple electronic signature with a strong record and a digital seal.
- **Not included**: Qualified signatures, identity checks and legal advice.
- **Where it runs**: The hosted service runs in the United States. You cannot yet choose a region.

## One address for each kind of message.

| Address | Use it for |
| --- | --- |
| hello@docustay.app | Anything. We build Docustay and we read every message. |
| support@docustay.app | Something is wrong. Include the request id from the error. |
| security@docustay.app | A security problem, privately. We reply within three working days. |
| privacy@docustay.app | Privacy requests. |
| abuse@docustay.app | Reporting misuse of the service. |
| conduct@docustay.app | A problem with how someone behaved in the project. |

Never send a password or an API key in a message.

## You can read what you are trusting.

The server and the app are under the AGPL-3.0, and the pieces you put inside your own software are MIT. You can run Docustay on your own machine and see every query it makes. The repository opens with the self-hosted release.

The work does not stop at the licence. The self-host guides say how to back up, how to restore, how to upgrade and how to check that a restore worked, because a signed record is only useful if you can still open it later.

## Counts that other pages point back to.

- **62** API operations: From the OpenAPI file. Checked 12 October 2026.
- **12** API key scopes: Offered to a workspace. Checked 12 October 2026.
- **39** MCP tools: In @docustay2026/mcp. Checked 12 October 2026.
- **6** self-host containers: From the compose file. Checked 12 October 2026.

## Every number, its source and its date.

| Fact | Value | Source | Checked |
| --- | --- | --- | --- |
| Operations in the REST API | 62 | sdk/openapi/openapi.json, through facts.gen.json | 12 October 2026 |
| OpenAPI version | 3.1.0 | the same file | 12 October 2026 |
| API version | 2026-10-07 | the same file | 12 October 2026 |
| Built-in templates | 54, all ordinary templates | docs/template-library.md and the starters index | 12 October 2026 |
| MCP tools | 39 | sdk/mcp, through facts.gen.json | 12 October 2026 |
| Requests a minute for each key | 600 | docs/errors-and-limits.md and the plans file | 12 October 2026 |
| Idempotency-Key length | 8 to 200 characters | docs/errors-and-limits.md | 12 October 2026 |
| Webhook delivery attempts | 6, after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours | docs/webhooks.md | 12 October 2026 |
| Free documents a month | 15 | the price list (prices.json) | 12 October 2026 |
| Pro price a month | $39 | the price list (prices.json) | 12 October 2026 |
| Self-host containers | 6 | docustay/docker-compose.yml | 12 October 2026 |
| Pro key grace after a payment | 14 days; 30 days offline | docs/self-host-licence.md | 12 October 2026 |

Numbers that depend on a plan come from the same price list the pricing page reads, so the two cannot disagree.

## What this page does not say.

| Item | What to know |
| --- | --- |
| Certifications | Docustay holds no security certification and claims none. |
| Health data | Docustay is not for protected health information yet, hosted or self-hosted. |
| Customer counts | No customer counts or logos are published. |
| Server size | No minimum server size is published for self-hosting. Two measurements exist: the image build needs more than 3.8 GB of memory and a pulled image idles at about 1 GiB. |
| Region choice | The hosted service runs in the United States. You cannot yet choose a region. |
| Package registries | The SDKs are not published to npm or PyPI yet. Install them from the repository. |

## Questions

**Who is behind it?**

The people who answer hello@docustay.app. We build it and we read every message.

**How do I reach a person?**

Write to hello@docustay.app. We read every message.

**Where do the numbers come from?**

From the same files the product reads. The build compares each number on this page with the value the code enforces, and fails when they differ.

**Can I quote this page?**

Yes. It is written to be quoted. A plain Markdown copy is at /about.md.


## Keep reading

- [Open source](/open-source)
- [Trust](/trust)
- [Changelog](/changelog)
