// COMPANY (T12 and the licensing page): About, the source page, Licensing, the plain guide, and the acceptable-use text. Voice V4 Maker for About and the source page, V3 Straight for Licensing and legal, V1 for the guide.
const sec = (eyebrow, h2, paras) => ({ t: "prose", eyebrow, h2, paras });
export const COMPANY_PAGES = [
  { path: "/about", tpl: "T12", voice: "V4", hooks: "P O", seo: "About Docustay and the facts", meta: "We build Docustay, we read every message sent to hello@docustay.app, and we say plainly what we will not do. The facts, in one place: plans and prices, limits, licence, SDKs, security basics and hosting.", eyebrow: "ABOUT",
    h1: "About Docustay", sub: "Docustay is an open source e-signature API and app (AGPL-3.0): it sends documents for signature and keeps the proof. We build it, and we read every message. The facts, last checked __FACTS_CHECKED__, are further down.",
    actions: [["Get started free", "/signup", "main", "F-FREEPLAN"], ["Write to us", "/contact", "alt"]], fine: "Open source under AGPL-3.0 · Every number is checked against the code on every build",
    hero: { kind: "papers", sheets: [{ meta: "About Docustay", title: "What we build", lines: 3, tilt: -2.5 }, { meta: "Our promises", list: [["Sell your data", "NEVER"], ["Read your documents", "NEVER"], ["Claim what we lack", "NEVER"]], tilt: 3 }] },
    blocks: [
      sec("What it is", "A signing tool with its work shown.", ["Docustay is a way to send a document, get it signed on any device, and keep the signed copy with a certificate of who signed when. {{F-SEND}}", "The code is licensed under the AGPL-3.0. The repository will be public when we publish it, and this site will link to it then. {{F-LICENCE}}"]),
      sec("How we build it", "With checks.", ["We write what a page says from a list of things the product does, and the build fails when a page names something that is not on the list.", "Every code sample on this site was run before it was published."]),
      sec("What we will not do", "Five promises.", ["We will not sell your data. We will not read your documents. We will not claim a certification we do not hold. We will not show social proof we do not have. We will not make you talk to a salesperson to see a price."]),
      { t: "matrix", id: "facts", eyebrow: "The facts: plans and prices", h2: "What each plan costs.", caption: "FIG. · PLANS AND PRICES", head: ["Item", "Detail"], rows: [
        ["Free", "$0, for one person. __FREE_DOCS__ documents and __FREE_TEMPLATES__ new templates a month, and __FREE_CREDITS__ AI drafts a month. API, webhooks and test mode included. {{F-FREEPLAN}}"],
        ["Pay as you go", "__PAYG_PERSON__ per team member a month. __PAYG_DOCS__ documents a month included, then __PAYG_DOC_OVER__ each. __PAYG_DRAFTS__ AI drafts included, then __DRAFT_OVER__ each. {{F-PAYG}}"],
        ["Pro", "__PRO_PRICE__ a month, flat for the whole workspace, with unlimited team members, signers, documents and templates. __PRO_CREDITS__ AI drafts a month, then __DRAFT_OVER__ each. {{F-PRO}}"],
        ["Founders price", "__FOUNDERS_PRICE__ a month for as long as the subscription stays active, for anyone who subscribes by __FOUNDERS_LAST_DAY__ (Pacific time). {{F-FOUNDERS}}"],
        ["Lifetime", "__LIFETIME_PRICE__ once, for the first __LIFETIME_N__ workspaces. Pro for as long as Docustay runs the hosted service, with __LIFETIME_DRAFTS__ AI drafts a month. {{F-LIFETIME}}"],
        ["Your budget", "__BUDGET__ a month unless you change it, with alerts at 50%, 80% and 100%. Sending and AI drafting pause at 100%. {{F-BUDGET}}"],
        ["Self-host Community", "Free under the AGPL-3.0, on your own server. {{F-SELFHOST}}"],
        ["Self-host Pro", "__SELFHOST_PRICE__ per install, for your own business. {{F-SELFHOSTPRO}}"],
        ["Commercial licence", "From about __COMMERCIAL_FROM__ a year, to embed, white-label, resell or keep a private fork. {{F-LICENCE}}"],
        ["Payments in a document", "Docustay adds __FREE_FEE__ on Free and Pay as you go and __PRO_FEE__ on Pro and Lifetime, on top of Stripe's fees. {{F-FEE}}"]] },
      { t: "matrix", eyebrow: "The facts: limits", h2: "What the plans allow.", caption: "FIG. · LIMITS", head: ["Item", "Detail"], rows: [
        ["Documents a month", "Free: __FREE_DOCS__, then sending stops. Pay as you go: __PAYG_DOCS__ included, then __PAYG_DOC_OVER__ each. Pro and Lifetime: unlimited. A document counts when it is sent. {{F-PAYG}}"],
        ["New templates a month", "Free: __FREE_TEMPLATES__. Every other plan and self-hosted installs: no limit. {{F-TEMPLATES}}"],
        ["Sending to a list", "On every plan. Free sends to up to __BULK_FREE__ people at a time. {{F-BULK}}"],
        ["Team members", "Free: one, the owner. Pay as you go: __PAYG_PERSON__ per team member a month. Pro and Lifetime: unlimited. {{F-ONEUSER}}"],
        ["Emails a day", "Free and Pay as you go: __FREE_EMAILS__. Pro and Lifetime: __PRO_EMAILS__."],
        ["Upload size", "Free and Pay as you go: __FREE_MB__ MB. Pro and Lifetime: __PRO_MB__ MB."],
        ["API", "__API_RATE__ requests a minute for each key. {{F-API}}"],
        ["AI drafts a month", "Free: __FREE_CREDITS__, then drafting stops. Pay as you go: __PAYG_DRAFTS__, then __DRAFT_OVER__ each. Pro: __PRO_CREDITS__, then __DRAFT_OVER__ each. Lifetime: __LIFETIME_DRAFTS__, then __DRAFT_OVER__ each. A failed or empty draft is never charged. {{F-AICREDITS}}"],
        ["Language", "The app, the signing page, the emails and this website are in English."]] },
      { t: "matrix", eyebrow: "The facts: licence", h2: "Two licences.", caption: "FIG. · LICENCE", head: ["Item", "Detail"], rows: [
        ["Server and app", "AGPL-3.0. {{F-LICENCE}}"],
        ["SDKs, signing element, MCP server, CLI, OpenAPI file", "MIT."],
        ["Embedding, white-label, resale, private fork", "Needs a commercial licence."]] },
      { t: "matrix", eyebrow: "The facts: developers", h2: "How to build on it.", caption: "FIG. · DEVELOPERS", head: ["Item", "Detail"], rows: [
        ["REST API", "OpenAPI 3.1 at https://docustay.app/openapi.json, with idempotency keys, key scopes, key expiry, an address allowlist and an API log. {{F-API}}"],
        ["SDKs", "JavaScript, TypeScript and Python. Clients for Go, PHP and C# are generated from the API description. {{F-SDK}}"],
        ["Command line", "Login, send --test, listen, verify and logs. {{F-CLI}}"],
        ["Webhooks", "Seven signed document events, replay from the log and secret rotation. {{F-WEBHOOKS}}"],
        ["Test mode", "Test keys send nothing except to the sender, and carry a TEST watermark. {{F-TESTMODE}}"]] },
      { t: "matrix", eyebrow: "The facts: security basics", h2: "What protects a signed document.", caption: "FIG. · SECURITY BASICS", head: ["Item", "Detail"], rows: [
        ["Seal", "The finished PDF is sealed with a digital signature over the whole file. {{F-SEAL}}"],
        ["Certificate", "A certificate of completion as the last page: who signed, when, and a hash of the file. {{F-CERT}}"],
        ["Audit log", "Every step on a document, with a CSV export. {{F-AUDIT}}"],
        ["Sign-in", "Two-step sign-in with an authenticator app or a passkey, which an owner can require for the whole team. {{F-TWOSTEP}}"],
        ["What a signature is", "A simple electronic signature with a strong record and a digital seal. No qualified signatures, no identity checks, no legal advice. {{F-VERIFYDOC}}"],
        ["Certifications", "Docustay holds no security certification and claims none."]] },
      { t: "matrix", eyebrow: "The facts: hosting", h2: "Where it runs.", caption: "FIG. · HOSTING", head: ["Item", "Detail"], rows: [
        ["Hosted service", "The United States, on Railway. You cannot yet choose a region."],
        ["Self-hosted", "Wherever you run it. {{F-SELFHOST}}"],
        ["Sub-processors", "Listed on the trust page, with what each one handles."]] },
      { t: "faq", items: [["Who is behind it?", "The people who answer hello@docustay.app. We build it and we read every message."], ["How do I reach a person?", "Write to hello@docustay.app. We read every message."], ["Where do the numbers come from?", "From the same files the product reads. The build compares each number on this page with the value the code enforces, and fails when they differ."], ["Can I quote this page?", "Yes. It is written to be quoted. A plain Markdown copy is at /about.md."]] },
    ], closing: { title: "Say hello.", label: "Contact us", href: "/contact" }, keep: [["Open source", "/open-source"], ["Trust", "/trust"], ["Changelog", "/changelog"]] },

  { path: "/open-source", tpl: "T12", voice: "V4", hooks: "O", seo: "Docustay is open source (AGPL-3.0)", meta: "The server and app are AGPL-3.0 and the SDKs, element and MCP server are MIT. Run it yourself, read it, and ask for a commercial licence only to embed or resell it.", eyebrow: "OPEN SOURCE",
    h1: "Open source and roadmap", sub: "The server and app are AGPL-3.0. The pieces you put inside your own software are MIT. {{F-LICENCE}}",
    actions: [["Self-host it", "/self-host", "main", "F-SELFHOST"], ["Read the licensing page", "/licensing", "alt"]], fine: "The source repository opens with the self-hosted release",
    blocks: [
      { t: "twofig", eyebrow: "What is open", h2: "Two licences, one line between them.", a: { caption: "FIG. 01 · AGPL-3.0", rows: [["Server", "The API, the signing service and the worker"], ["App", "The web app and this site"], ["Asks", "Offer your changed version's source to people who use it over a network"]] }, b: { caption: "FIG. 02 · MIT", rows: [["SDKs", "@docustay2026/sdk and docustay for Python"], ["Element", "<docustay-sign> and its React, Vue and Angular wrappers"], ["Tools", "The MCP server, the agent skills, the CLI and the OpenAPI file"]] } },
      sec("Community and Pro", "Run it free, or pay for the extras.", ["Self-host Community is free: unlimited documents and templates, everything in the hosted Free plan, on your server. Self-host Pro adds the paid features for one business. {{F-SELFHOSTPRO}}"]),
      sec("How to contribute", "Keep your copyright.", ["People who send changes keep their copyright and give the Docustay project a licence to use the change under any licence. That is what lets us offer a commercial licence next to the open one."]),
      sec("The roadmap", "What we are working on.", ["Passkey sign-in is behind a flag. Single sign-on through OpenID Connect is built for self-hosted installs. {{F-OIDC}}", "The SDKs are built and tested and will move to the public registries; the changelog will say when."]),
    ], closing: { title: "Run it yourself.", label: "Read the self-host guide", href: "/self-host" }, keep: [["Licensing", "/licensing"], ["Changelog", "/changelog"], ["Developers", "/developers"]] },

  { path: "/licensing", tpl: "T10", voice: "V3", hooks: "O F", seo: "Licensing: AGPL or commercial licence", meta: "Docustay is open source under AGPL-3.0. Run it for your own business free, or with Self-host Pro. Embed, white-label, resell or fork it privately with a commercial licence.", eyebrow: "LICENSING",
    h1: "Licensing: AGPL or commercial.", sub: "Docustay is open source under AGPL-3.0. Most people never need anything else. If AGPL does not fit how you ship, there is a commercial licence. General information, not legal advice. {{F-LICENCE}}",
    actions: [["Talk to us", "/contact", "main"], ["Self-host", "/self-host", "alt", "F-SELFHOST"]], fine: "Commercial licence from about $3,000 a year",
    blocks: [
      { t: "tree", eyebrow: "Which licence fits", h2: "Which licence fits?", selfPro: "__SELFPRO__", commercial: "__COMMERCIAL__" },
      { t: "matrix", eyebrow: "At a glance", h2: "Three ways to use it.", caption: "FIG. · AT A GLANCE", head: ["Item", "Detail"], rows: [["Hosted by us", "Free and Pro, used under the Terms. There is no code to license."], ["Run it yourself", "Self-host Community is free under the AGPL-3.0. Self-host Pro adds the paid features for your own business, per install."], ["Ship it in a product", "A commercial licence covers embedding, white-label, resale and a private fork."]] },
      { t: "twofig", eyebrow: "The two licences", h2: "What each one asks and gives.", a: { caption: "FIG. 02 · WHAT AGPL ASKS OF YOU", rows: [["Use", "You may run, study, change and share the code"], ["Change it", "If you change the code and let others use your version over a network, offer them the source of your version"], ["Run it unchanged", "For your own business there is nothing to publish"], ["The text", "The LICENSE file is the authority; this is a summary"]] }, b: { caption: "FIG. 03 · WHAT A COMMERCIAL LICENCE GIVES YOU", rows: [["Embed", "Ship Docustay inside a product you sell or offer to others"], ["White-label", "Your name and logo"], ["Resell", "Offer it to your customers"], ["Private fork", "Keep your changes without publishing them"]], note: "FROM ABOUT $3,000 A YEAR, QUOTED FOR YOUR VOLUME." } },
      sec("The line", "Using the API is not copying the code.", ["A customer who calls the Docustay API over HTTP, or uses the SDKs, is not making a derivative work of the server, and their software does not become AGPL. A customer who copies or modifies server code and lets other people use it over a network is, and the AGPL applies to that code. Showing the signing page inside your site in a frame is using a service. The SDKs, the signing element, the MCP server and the CLI are MIT."]),
      { id: "name", ...sec("The name", "The code is yours to use; the name is not.", ["“Docustay” and the logo are marks of the Docustay project. The licences give you the right to use the code, not the name or the logo. If you fork the code, choose your own name and logo."]) },
      { t: "faq", items: [["Does Self-host Pro cover embedding?", "No. It is for your own business. Embedding, white-labelling, resale and a private fork need a commercial licence."], ["What if our server cannot reach yours?", "A Pro licence key keeps working for up to 30 days offline. It is a commercial honour system, not copy protection."], ["Does using the API make my software AGPL?", "No. Calling the API or using the SDKs does not."], ["Who owns contributions?", "Contributors keep their copyright and give the Docustay project a licence to use the change under any licence. That is what lets us offer a commercial licence next to the open one."]] },
    ], closing: { title: "Talk to us.", label: "Talk to us", href: "/contact" }, keep: [["Open source", "/open-source"], ["Pricing", "/pricing"], ["Self-host", "/self-host"]] },

  { path: "/guides/how-to-sign-a-pdf", claimUntilProven: true, tpl: "T11 guide", voice: "V1", hooks: "T P", seo: "How to sign a PDF", meta: "Sign a PDF three ways: type or draw your signature on a phone or computer, from a link someone sent you, or by sending your own PDF out for signature with Docustay.", eyebrow: "GUIDE",
    h1: "How to sign a PDF", sub: "Three ways, from the quickest to the one that keeps proof. {{F-SIGN}}",
    actions: [["Sign a PDF free", "/tools/sign-pdf", "main"], ["Send a PDF to sign", "/signup", "alt", "F-UPLOAD"]], fine: "Free · No account to sign",
    blocks: [
      { t: "steps", eyebrow: "Three ways", h2: "Pick the one that fits.", items: [{ h: "Someone sent you a link", p: "Open it, fill in your fields, type or draw your signature, tick that you agree to sign electronically and finish. You do not need an account. {{F-SIGN}}" }, { h: "You need to sign your own file", p: "Upload the PDF, place your signature field and sign it yourself, then send it on. {{F-UPLOAD}}" }, { h: "You need others to sign", p: "Upload the PDF, name who signs, and send it. Everyone gets the sealed copy with its certificate. {{F-SEND}}" }] },
      { t: "cols", h2: "What a good signed PDF has.", cols: [{ h: "Every signature", p: "Each person's name and the time they signed, on the page. {{F-CERT}}" }, { h: "A seal", p: "A digital signature over the whole file, so a later change shows. {{F-SEAL}}" }, { h: "A way to check", p: "Anyone can drop the file on the verify page with no account. {{F-VERIFY}}" }] },
      { t: "faq", items: [["Is a typed signature valid?", "It is a simple electronic signature with a record of intent. Whether it is enough for a given document depends on the document and the place. See legal validity. {{F-VERIFYDOC}}"], ["Can I sign on my phone?", "Yes. The signing page works on any phone or computer. {{F-SIGN}}"], ["Can I sign a Word file?", "Save it as a PDF first. Docustay only accepts PDF files. {{F-UPLOAD}}"]] },
    ], closing: { title: "Sign or send a PDF.", label: "Get started free", href: "/signup" }, keep: [["Sign a PDF", "/tools/sign-pdf"], ["Signature generator", "/tools/signature-generator"], ["Verify a PDF", "/verify"], ["Legal validity", "/trust/legal-validity"]] },

  { path: "/legal/acceptable-use", tpl: "T10", voice: "V3", hooks: "T", seo: "Acceptable use", meta: "What you may and may not send through Docustay: no unlawful, deceptive or harmful use, no attempt to break the service, and what we do when a rule is broken.", eyebrow: "LEGAL",
    h1: "Acceptable use", sub: "What you may and may not do with Docustay. This text is general information, not legal advice.", fine: "Version 1 · 8 October 2026",
    blocks: [
      sec("What this covers", "Anything you send or store.", ["These rules apply to every workspace, signer and API key. They sit beside the terms of service."]),
      sec("Do not", "Six things.", ["Do not use Docustay to send anything unlawful, to deceive a signer about what they are signing, or to forge a signature or an identity.", "Do not send spam or bulk email to people who did not expect it.", "Do not try to break, probe or overload the service, or reach another workspace's data.", "Do not use another person's name or email to sign for them.", "Do not upload malware or content you have no right to share.", "Do not resell or embed the hosted service without a commercial licence."]),
      sec("What we do", "A warning first, when we can.", ["If a rule is broken we may pause a send, remove content, or end the account. Where we can, we say why first. To report a problem, write to abuse@docustay.app."]),
      sec("Changes", "Told before they apply.", ["When these rules change we update this page, and tell workspace owners when the change matters to them."]),
    ], closing: { title: "Read the terms.", label: "Terms", href: "/legal/terms" }, keep: [["Privacy policy", "/legal/privacy-policy"], ["Cookies", "/legal/cookies"], ["Data processing addendum", "/legal/dpa"], ["Refunds and cancellation", "/legal/refunds"], ["Renewal terms", "/legal/renewal"]] },

];
