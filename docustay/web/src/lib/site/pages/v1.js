// VERSION 1 PAGES (17 Oct 2026): What's next, Help and the Legal index. Built from sections the site already has. Voice V1 (plain, short). Capability sentences end with {{F-ID}}; numbers are tokens filled from the one price list.
const sec = (eyebrow, h2, paras) => ({ t: "prose", eyebrow, h2, paras });
export const V1_PAGES = [
  { path: "/whats-next", tpl: "T12", voice: "V4", hooks: "O", seo: "What's next for Docustay", meta: "Version 1 does one thing well: documents written, sent, signed and sealed, with the whole platform for developers and self-hosters. Here is what we are looking at for later. Nothing is promised or dated.", eyebrow: "WHAT IS NEXT", crumbs: [["What is next", "/whats-next"]],
    h1: "What is *next* for Docustay.", sub: "Version 1 does one thing well: it gets your documents written, sent, signed and sealed, and it gives developers and self-hosters the whole platform. Here is what we are looking at for later versions. Nothing here is promised or dated; tell us what you would use first.",
    actions: [["Tell us what you need", "/contact", "main"], ["See what is here now", "/features", "alt"]], fine: "No dates · No promises",
    hero: { kind: "papers", sheets: [{ meta: "Being considered", title: "Later versions", lines: 3, tilt: -2.5 }, { meta: "Your say", list: [["Tell us", "FIRST"], ["We read", "EVERY ONE"]], tilt: 3 }] },
    blocks: [
      { t: "cards", eyebrow: "Being considered", h2: "Thirteen ideas. Five are next up.", cols: 3, items: [
        { h: "Reports", p: "Next up. See and export what was sent, signed and paid." },
        { h: "Sign in person", p: "Next up. Kiosk mode and QR codes." },
        { h: "Your own email domain", p: "Next up. Email from your own address." },
        { h: "Public forms", p: "Next up. Share a link anyone can fill in and sign." },
        { h: "Edit email wording", p: "Next up. Change the words of the emails Docustay sends for you." },
        { h: "Automations", p: "Send the next document automatically when one is signed." },
        { h: "More languages", p: "Signing pages, emails and certificates in other languages." },
        { h: "Contract dates", p: "Key dates and renewal reminders." },
        { h: "Smart fields", p: "Fields that appear on conditions, calculated fields and sections." },
        { h: "Signing links on your domain", p: "Signers open links that carry your name." },
        { h: "Payment plans", p: "Instalments and subscriptions inside a signed document." },
        { h: "Custom roles and permissions", p: "Roles beyond owner, admin and member." },
        { h: "Connections", p: "Cloud storage, calendars and chat apps." }] },
      sec("How we choose", "What you tell us decides the order.", ["We build what people use. Every message to hello@docustay.app is read, and the ideas that come up most often move up."]),
      { t: "faq", items: [["Are these promised?", "No. Nothing on this page is promised or dated. It is a list of what we are looking at."], ["Can I ask for something that is not here?", "Yes. Write to hello@docustay.app and say what you would use it for."], ["Is anything here in the product today?", "No. Everything listed is not part of version 1."]] },
    ], closing: { title: "Tell us what you need first.", label: "Write to us", href: "/contact" }, keep: [["Features", "/features"], ["Pricing", "/pricing"], ["Changelog", "/changelog"]] },

  { path: "/help", tpl: "T12", voice: "V1", hooks: "P", seo: "Help: send, sign, pay and manage your workspace", meta: "Help in plain words: how to send and sign a document, how plans, budgets and bills work, how to take payments, and who to write to when it is not enough.", eyebrow: "HELP", crumbs: [["Help", "/help"]],
    h1: "Help, in plain *words.*", sub: "How to send and sign, how plans and bills work, how to take payments, and who to write to when this is not enough.",
    actions: [["Try the demo", "/demo", "main", "F-DEMO"], ["Write to us", "/contact", "alt"]], fine: "We read every message",
    hero: { kind: "papers", sheets: [{ meta: "Help", title: "Start here", lines: 3, tilt: -2.5 }, { meta: "Need a person?", list: [["Write to", "hello@"]], tilt: 3 }] },
    blocks: [
      { t: "steps", id: "start", eyebrow: "Getting started", h2: "Four steps to your first signed document.", items: [
        { h: "Make an account", p: "Enter your email, then the code we send you. There is no card to give and nothing to install. {{F-FREEPLAN}}" },
        { h: "Pick or write a document", p: "Start from one of __TEMPLATES__ templates, upload a PDF, or tell Scribe what you need. Scribe drafts it; you read it. {{F-TEMPLATES}}" },
        { h: "Say who signs and send", p: "Add names and emails, choose the order and press send. A document counts when it is sent. {{F-SEND}}" },
        { h: "Keep the sealed copy", p: "Everyone gets the sealed PDF with its certificate. Anyone can check a copy on the verify page. {{F-CERT}}" }] },
      { t: "cols", id: "sending", eyebrow: "Sending and signing", h2: "What happens after you press send.", cols: [
        { h: "Reminders", p: "Reminders go out until each person signs, on every plan. Reminders are never charged. {{F-REMIND}}" },
        { h: "Sending to a list", p: "Upload a spreadsheet and each row gets its own copy. Free sends to up to __BULK_FREE__ at a time. {{F-BULK}}" },
        { h: "Signing", p: "The signer opens the link on a phone or a computer and signs. No account, no app. {{F-SIGN}}" }] },
      { t: "cols", id: "billing", eyebrow: "Plans, bills and your budget", h2: "What you pay, and how to keep it in check.", cols: [
        { h: "What counts", p: "A document counts when it is sent. Reminders, drafts, signers and test mode never count. Free includes __FREE_DOCS__ a month. {{F-PAYG}}" },
        { h: "Your budget", p: "__BUDGET__ a month unless you change it. You get an email at 50%, 80% and 100%. At 100% sending and AI drafting pause until you raise it. Nothing is deleted. {{F-BUDGET}}" },
        { h: "Cancel any time", p: "Cancel from the Billing page. Your plan stays on until the end of the period you paid for. Docustay does not give refunds. {{F-PRO}}" }] },
      { t: "cols", id: "payments", eyebrow: "Payments inside a document", h2: "Take money as part of signing.", cols: [
        { h: "Set up payments", p: "In Billing, Payments, choose Set up payments and Stripe creates an account in your name, or choose I already have Stripe and sign in to the one you use. {{F-PAYMENTS}}" },
        { h: "What it costs", p: "Stripe's own fees go to Stripe. Docustay adds __FREE_FEE__ on Free and Pay as you go and __PRO_FEE__ on Pro and Lifetime. {{F-FEE}}" },
        { h: "Refunds are yours", p: "Refunds and disputes are handled in your own Stripe account. Docustay never holds the money. {{F-PAYMENTS}}" }] },
      { t: "cols", id: "brand", eyebrow: "Your brand and your team", h2: "Make it yours, and add the people who send.", cols: [
        { h: "Logo and colour", p: "Add your logo, colour, welcome note, sender name and reply-to address under Settings, Branding. It is on every plan. {{F-BRANDING}}" },
        { h: "Team members", p: "Free is for one team member. On Pay as you go each team member you add is __PAYG_PERSON__ a month; Pro and Lifetime have unlimited team members. Signers are free on every plan. {{F-ONEUSER}}" },
        { h: "Roles", p: "Owner, admin and member roles decide who can send and who can change settings. {{F-TEAMS}}" }] },
      { t: "faq", id: "fix", items: [
        ["A signer did not get the email", "Ask them to check their spam folder, then open the document and send a reminder. A reminder is free. If the address was wrong, void the document and send it again to the right one. {{F-REMIND}}"],
        ["Sending says it is paused", "Your monthly budget has been reached, or the Free limit of __FREE_DOCS__ documents has. Open Billing: raise the budget, or switch to Pay as you go. Nothing is lost. {{F-BUDGET}}"],
        ["I need my documents out of Docustay", "Open any document and download the sealed PDF and its audit log. You can export everything at any time, also after you cancel. {{F-AUDIT}}"],
        ["Is a signature from Docustay legal?", "It is a simple electronic signature with a strong record and a digital seal. Whether it is enough depends on the document and the place. Read the legal validity page. {{F-VERIFYDOC}}"],
        ["I forgot how I signed in", "Docustay signs you in with an emailed code, a passkey or a password. Choose Sign in and ask for a code. {{F-TWOSTEP}}"],
        ["I need a person", "Write to hello@docustay.app, or support@docustay.app if something is broken. Include what you did and what you saw. We read every message."]] },
    ], closing: { title: "Still stuck? Write to us.", label: "Contact us", href: "/contact" }, keep: [["Pricing", "/pricing"], ["Features", "/features"], ["Trust", "/trust"]], claimUntilProven: true },

  { path: "/legal", tpl: "T10", voice: "V3", hooks: "T", seo: "Legal: terms, privacy and the rest", meta: "Every legal document in one place: the terms, the privacy policy, cookies, the data processing addendum, refunds, renewal terms, acceptable use and third-party notices.", eyebrow: "LEGAL", crumbs: [["Legal", "/legal"]],
    h1: "Legal, in one place.", sub: "The terms, the privacy policy and every other legal text. General information, not legal advice.", fine: "Drafts for review by a lawyer",
    blocks: [
      { t: "tiles", eyebrow: "The documents", h2: "Read the one you need.", items: [
        { h: "Terms of service", p: "The rules for using Docustay, plans, billing and cancelling.", href: "/legal/terms", icon: "file-text", feature: "F-FREEPLAN" },
        { h: "Privacy policy", p: "What Docustay collects, who sees it and how long it stays.", href: "/legal/privacy-policy", icon: "shield", feature: "F-VERIFYDOC" },
        { h: "Cookies", p: "The cookies this website uses, and how to choose.", href: "/legal/cookies", icon: "layers", feature: "F-VERIFYDOC" },
        { h: "Data processing addendum", p: "How Docustay processes data for a workspace.", href: "/legal/dpa", icon: "file-text", feature: "F-VERIFYDOC" },
        { h: "Refunds and cancellation", p: "How to cancel, and the no-refunds rule.", href: "/legal/refunds", icon: "card", feature: "F-PRO" },
        { h: "Renewal terms", p: "How plans renew and the self-host licence.", href: "/legal/renewal", icon: "clock", feature: "F-PRO" },
        { h: "Acceptable use", p: "What you may and may not send through Docustay.", href: "/legal/acceptable-use", icon: "lock", feature: "F-API" },
        { h: "Third-party notices", p: "The open-source software Docustay includes, with its licences.", href: "/legal/notices", icon: "code", feature: "F-LICENCE" },
        { h: "Sub-processors", p: "The companies that handle data for Docustay.", href: "/trust#sub-processors", icon: "server", feature: "F-VERIFYDOC" },
        { h: "Legal validity", p: "What an electronic signature is, and what it is not.", href: "/trust/legal-validity", icon: "seal", feature: "F-VERIFYDOC" }] },
      { t: "faq", items: [["Is this legal advice?", "No. These texts describe how Docustay works. For advice about your own documents, ask a lawyer."], ["Who runs Docustay?", "Docustay is a product of GLRS LLC. To reach us, use the contact page."]] },
    ], closing: { title: "Questions about a document?", label: "Contact us", href: "/contact" }, keep: [["Trust", "/trust"], ["Pricing", "/pricing"], ["About", "/about"]] },
];
