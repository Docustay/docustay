// THE PAYMENTS SUITE AND THE NEW FEATURE PAGES (26 Oct 2026, the Pages chat). Every sentence was checked against the code before it was written:
//   guided setup + states + pause/disconnect  docustay/web/src/lib/payments/PayWizard.svelte, StripeAccount.svelte, src/product/docustayStripeAccount.mjs (country is fixed to US)
//   the payment field                         src/documents/engine/ai/payment.mjs, src/documents/flowDefinition.mjs (PAYMENT_CURRENCIES), src/documents/pdfPayments.mjs, pdfSigning.mjs (HOLD_DAYS = 7)
//   fees                                      src/product/docustayFee.mjs (a self-hosted install has no plan row: 0)
//   the signer's side                         src/documents/pdfSigning.mjs, docustay/web/src/routes/sign/pdf/+page.svelte, SignaturePad.svelte
//   the API                                   sdk/openapi/openapi.json (payments paths), sdk/cli/bin/docustay.mjs, sdk/mcp/src/tools.js, src/developer/webhookTopics.mjs
// Prices and fees are tokens (__FREE_FEE__, __PRO_FEE__); nothing is typed by hand. Words like "flat" and "0% fee" only ever sit in a sentence that says Pro.
const KEEP = (...x) => x;
const feat = (o) => ({ tpl: "T3", voice: "V1", hooks: "P", ...o });
const devp = (o) => ({ tpl: "T7", voice: "V2", hooks: "O F A", crumbs: [["Developers", "/developers"], [o.crumb, o.path]], ...o });
const hostp = (o) => ({ tpl: "T7", voice: "V2", hooks: "O F A", crumbs: [["Self-host", "/self-host"], [o.crumb, o.path]], ...o });

const STATUS_CURL = `curl https://app.docustay.app/api/v1/payments/status \\
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"`;
const STATUS_RESP = `{ "status": "connected", "mode": "live" }`;
const LIST_CURL = `curl "https://app.docustay.app/api/v1/payments?limit=20" \\
  -H "Authorization: Bearer $DOCUSTAY_API_KEY"`;
const REFUND_CURL = `curl -X POST "https://app.docustay.app/api/v1/payments/$DOCUSTAY_PAYMENT_ID/refund" \\
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{ "amountMinor": 500, "reason": "Charged twice" }'`;
const PAYMENT_SHAPE = `{ "id": "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e",
  "fieldId": null,
  "person": "Rosa Alvarez",
  "status": "partially_refunded",
  "amountMinor": 15000,
  "currency": "usd",
  "paidAt": "2026-10-26T17:04:11Z",
  "receiptUrl": "https://pay.stripe.com/receipts/…",
  "refundedMinor": 500,
  "fee": { "basisPoints": 200, "amountMinor": 300, "refundedMinor": 10, "plan": "docustay_free" },
  "test": false }`;
const TAG = "Deposit: {{Deposit;type=payment;role=Client;amount=600.00;currency=usd}}";

export const SUITE_PAGES = [
  // ───────────────────────────── /features/payments (the main page, for businesses)
  feat({ path: "/features/payments", seo: "Get paid inside the signature, powered by Stripe", meta: "Add a payment field and the signer pays by card as the last step of signing. Payments are powered by Stripe and go straight to your own Stripe account. Docustay never holds the money.", eyebrow: "FEATURES · PAYMENTS",
    h1: "Get *paid* inside the signature.", sub: "Add a payment field to a document. The signer signs, then pays by card on the same page. Payments are powered by Stripe, and the money goes straight to your own Stripe account. Docustay never holds it. {{F-PAYMENTS}}",
    actions: [["Get started free", "/signup", "main"], ["See pricing", "/pricing", "alt"]], fine: "Your own Stripe account · One amount, paid while signing · Ten currencies",
    blocks: [
      { t: "flow", id: "path", eyebrow: "Where the money goes", h2: "From the signer to your Stripe account.", caption: "FIG. 01 · THE PATH OF A PAYMENT", nodes: [{ label: "Signer", sub: "Signs, then pays by card" }, { label: "Docustay", sub: "Works out the amount on the server" }, { label: "Your Stripe account", sub: "Takes the money", red: true }], foot: "DOCUSTAY NEVER HOLDS THE SIGNER'S MONEY. REFUNDS AND DISPUTES ARE YOURS, IN YOUR OWN STRIPE ACCOUNT." },
      { t: "twofig", id: "setup", eyebrow: "Two ways to set up", h2: "Start from nothing, or bring your Stripe account.", sub: "Only Admins and Owners set up payments. It is under Billing, Payments. {{F-PAYSETUP}}",
        a: { caption: "FIG. 02 · SET UP PAYMENTS (RECOMMENDED)", rows: [["Stripe account", "You do not need one. Stripe makes it for you at the end."], ["The form", "Company or individual, your name, what you will collect for, and your country. The form shows United States."], ["Then", "Stripe's own secure page asks for the rest."], ["You need", "A photo ID, a bank account, and an EIN or the last 4 of an SSN."], ["How long", "Setup takes about 5 minutes. You can stop and come back."], ["Privacy", "Docustay never sees your ID or your bank details."]], note: "THE GUIDED SETUP MAKES A UNITED STATES ACCOUNT." },
        b: { caption: "FIG. 03 · I ALREADY HAVE A STRIPE ACCOUNT", rows: [["Choose", "I already have a Stripe account. Connect it instead."], ["What happens", "You sign in at Stripe and allow Docustay to take payments for you."], ["Your money", "Stays in the account you already use."], ["Your dashboard", "The same Stripe dashboard you know."]], note: "SAME PAYMENTS, SAME PAYOUTS, YOUR OWN ACCOUNT." } },
      { t: "matrix", id: "states", eyebrow: "Your account, at a glance", h2: "Six states, and what each one means.", caption: "FIG. 04 · THE STATE OF YOUR STRIPE ACCOUNT", head: ["State", "What it means", "What you do"], rows: [
        ["Ready", "Stripe is connected and can take payments.", "Nothing."],
        ["Verifying", "Stripe is checking your details. It usually takes a few minutes and sometimes up to a day.", "Wait. Stripe emails you when it is done."],
        ["Needs attention", "Stripe needs a little more from you. It shows a deadline when it has one.", "Choose Continue on Stripe."],
        ["Restricted", "Stripe has restricted the account until it has what it asked for.", "Choose Continue on Stripe."],
        ["Paused by you", "You turned Take payments off. Payment boxes say payments are paused and people can still sign. Nothing is refunded.", "Turn it back on whenever you like."],
        ["Disconnected", "Docustay no longer has access to a Stripe account. Payment boxes cannot be paid until you connect again.", "Reconnect. Your Stripe account stays yours."]] },
      { t: "cols", id: "control", eyebrow: "Always in your hands", h2: "Pause it, disconnect it, open your dashboard.", cols: [
        { h: "Pause payments", p: "Payment boxes say payments are paused, and people can still sign. Nothing is refunded. Turn it back on when you want. {{F-PAYSETUP}}" },
        { h: "Disconnect", p: "The Stripe account stays yours. Payment boxes cannot be paid until you connect again, and your history stays visible. {{F-PAYSETUP}}" },
        { h: "Open your Stripe dashboard", p: "One link from Billing, Payments takes you to your own Stripe dashboard, where payouts and the bank details live. {{F-PAYSETUP}}" }] },
      { t: "matrix", id: "field", eyebrow: "The payment field", h2: "One amount, one currency, one card payment.", caption: "FIG. 05 · WHAT YOU SET ON A PAYMENT FIELD", head: ["You set", "Options"], rows: [
        ["Amount", "One fixed amount, from 0.50 to 999,999.99. A deposit is just a smaller amount. {{F-PAYMENTS}}"],
        ["Currency", "USD, EUR, GBP, CAD, AUD, NZD, CHF, SEK, NOK or DKK. {{F-PAYMENTS}}"],
        ["Who pays", "One of the people on the document."],
        ["What it is for", "A line of text the signer sees next to the amount."],
        ["A Stripe Price or Payment Link", "Instead of typing an amount, point the field at a one-time Price or a Payment Link on your own Stripe account."],
        ["Instalments", "Write them in the document as a note. They are a note, not a charge: the field takes one payment."]] },
      { t: "screen", id: "signer", kind: "phone-pay", eyebrow: "What the signer sees", h2: "They sign, then pay on the same page.", sub: "The link opens on any device, with no account. The signer signs, then pays by card as the last step. The amount is worked out on the server and never taken from the browser. {{F-PAYLAST}}", caption: "FIG. 06 · THE SIGNING PAGE ON A PHONE",
        notes: [["Held for 7 days", "Their signature is held for 7 days while they pay. If the payment does not arrive in time, the signature is not kept, and you and the signer are told. {{F-PAYLAST}}"], ["The receipt", "The receipt comes with the signed copy. If your Stripe account already emails receipts, signers may get two. {{F-PAYLAST}}"]] },
      { t: "split", id: "after", eyebrow: "After they pay", h2: "Every payment in one place.", sub: "Billing, Payments shows your balance and payouts, who paid for which document, Stripe's fees, and this month's money in, fees and refunds. {{F-PAYPAGE}}",
        points: ["Refund in full or in part, with a reason the payer sees. {{F-PAYREFUND}}", "A dispute opens in Stripe, where you answer it. {{F-PAYREFUND}}", "Owners get an email when Stripe asks for more information, when a payout fails and when a payment is disputed. {{F-PAYREFUND}}", "Switch on Payments in your notification settings to hear when a payment arrives or one does not go through, in the app and by email."], sheets: [{ meta: "Payments", list: [["Deposit · Services agreement", "$600.00"], ["Refund · Charged twice", "−$5.00"]] }] },
      { t: "limits", id: "fees", eyebrow: "What it costs", items: [["Free and Pay as you go", "__FREE_FEE__ fee on top of Stripe's"], ["Pro and Lifetime", "__PRO_FEE__ fee on top of Stripe's"], ["Stripe's own fees", "Go to Stripe, from your Stripe account"]] },
      { t: "split", id: "scribe", eyebrow: "Scribe and payments", h2: "Say what you are collecting. Review what Scribe drafts.", sub: "Once Stripe is connected, Scribe's wizard asks for the amount, the currency, who pays and what it is for. The terms are written around your values, and you review everything before it is sent. {{F-SCRIBE}}", points: ["Scribe never decides an amount. The one you typed is the one that is charged."], actions: [["How Scribe collects a payment", "/features/scribe#payment", "alt"]], rev: true, sheets: [{ meta: "Scribe", list: [["Amount", "You type it"], ["Payment field", "Placed by code"]] }] },
      { t: "cards", id: "try", eyebrow: "Try it", h2: "The demo has no Stripe. Test mode does.", cols: 3, items: [
        { h: "The demo", p: "The demo has no Stripe account, so it cannot take a payment. You can still see a payment box in a document. {{F-DEMO}}", href: "/demo", link: "Open the demo" },
        { h: "With a test card", p: "Where a server is in Stripe's test mode, Docustay says so, and a Stripe test card pays without moving real money. {{F-PAYMENTS}}", href: "/self-host/payments", link: "Run it with test keys" },
        { h: "For developers", p: "The technical side: the API, webhooks, the command line and test mode. {{F-API}}", href: "/developers/payments", link: "Payments for developers" }] },
      { t: "faq", items: [
        ["Does Docustay hold my money?", "No. The payment goes to your own Stripe account, and Stripe pays your bank on the schedule you see in Billing, Payments. {{F-PAYMENTS}}"],
        ["What does it cost?", "Stripe's own fees go to Stripe. Docustay adds __FREE_FEE__ on Free and Pay as you go and __PRO_FEE__ on Pro and Lifetime. {{F-FEE}}"],
        ["Which countries can set up payments?", "The guided setup makes a United States Stripe account, and its form shows United States. If you already have a Stripe account, you can connect it instead. A payment can be in USD, EUR, GBP, CAD, AUD, NZD, CHF, SEK, NOK or DKK. {{F-PAYSETUP}}"],
        ["What if Stripe needs more information?", "The state changes to Needs attention, and Owners get an email. Choose Continue on Stripe and give it what it asks for. {{F-PAYREFUND}}"],
        ["Can I take a deposit?", "Yes. A deposit is a payment field with a smaller amount. A payment field takes one amount, so a balance later is a second document or an invoice from your own Stripe. {{F-PAYMENTS}}"],
        ["Can I refund a payment?", "Yes, in full or in part, from Billing, Payments or the API. Give a reason; the payer sees it. {{F-PAYREFUND}}"],
        ["What about disputes?", "A dispute opens in Stripe, in your own account, and you answer it there. Owners get an email when one is opened. {{F-PAYREFUND}}"],
        ["Who can set it up?", "Admins and Owners. Members can see who runs payments. {{F-PAYSETUP}}"]] },
    ], closing: { title: "Add a payment field.", label: "Get started free", href: "/signup" }, keep: KEEP(["Payments for developers", "/developers/payments"], ["Payments when you self-host", "/self-host/payments"], ["Scribe", "/features/scribe"], ["Pricing", "/pricing"]), claimUntilProven: true }),

  // ───────────────────────────── /features/signing
  feat({ path: "/features/signing", seo: "Signing on any device, with no account", meta: "The person you send to opens a link on a phone or a computer, with no account. They draw or type a signature, or decline. Reminders and a deadline keep it moving.", eyebrow: "FEATURES · SIGNING",
    h1: "Signing that needs *no account.*", sub: "The person you send to opens a link on a phone or a computer, reads the document, signs and is done. They do not make an account. {{F-SIGN}}",
    actions: [["Try the demo", "/demo", "main", "F-DEMO"], ["How it works", "/features/how-it-works", "alt"]], fine: "Any device · No account · Drawn or typed signature",
    blocks: [
      { t: "cols", id: "signer", eyebrow: "The signer's side", h2: "Open the link. Sign. Done.", cols: [
        { h: "Any device", p: "The link opens in the browser on a phone, a tablet or a computer. Nothing to install and no account to make. {{F-SIGN}}" },
        { h: "Draw or type", p: "A signature is drawn with a finger or a mouse, or typed. Initials and dates are fields on the page. {{F-SIGN}}" },
        { h: "Keep going later", p: "A signer can save their place and come back to the same link. {{F-SIGN}}" }] },
      { t: "cards", id: "options", eyebrow: "What the signer can do", h2: "Sign, decline, or pass it on.", cols: 3, items: [
        { h: "Remember my signature", p: "On the same browser, a signature can be remembered under the signer's name, so the next one takes a tap. A different name on that browser is never offered someone else's. {{F-SIGN}}", n: "01" },
        { h: "Decline", p: "A person can decline. You can ask them to say why, and you are told at once. The decline is part of the record. {{F-SIGN}}", n: "02" },
        { h: "Pass it to someone else", p: "A signer who is not the right person can pass the document to another name and email. {{F-SIGN}}", n: "03" },
        { h: "A reason for signing", p: "You can ask each signer to say why they are signing, for example their role. The reason is kept with the signature. {{F-SIGN}}", n: "04" },
        { h: "Check who is signing", p: "Ask for an email code or an access code you share before the document opens. {{F-SIGN}}", n: "05" },
        { h: "Payment, if you added one", p: "If the document has a payment field, the signer pays as the last step. {{F-PAYLAST}}", n: "06" }] },
      { t: "matrix", id: "keep", eyebrow: "Keeping it moving", h2: "Reminders and a deadline.", caption: "FIG. 01 · REMINDERS AND EXPIRY", head: ["You choose", "Options"], rows: [
        ["Reminders", "None; after 3 and 7 days; every week for three weeks; every day for three days; or after 2, 5 and 10 days. {{F-REMIND}}"],
        ["Expiry", "Never, or in 7, 14, 30, 60 or 90 days. The sender is told when a document lapses unsigned. {{F-REMIND}}"],
        ["Stopping", "Reminders stop once everyone has signed. A reminder is never charged. {{F-REMIND}}"]] },
      { t: "faq", items: [
        ["Does the signer need an account?", "No. They need the link, and an email code or access code if you asked for one. {{F-SIGN}}"],
        ["Can a signer decline?", "Yes. They can decline and say why, and you are told at once. {{F-SIGN}}"],
        ["Can I remind someone by hand?", "Yes. Open the document and send a reminder. Reminders are free. {{F-REMIND}}"],
        ["What proves who signed?", "Every signed copy carries a certificate with the record of each signature. See Proof. {{F-CERT}}"]] },
    ], closing: { title: "See it with no sign-up.", label: "Try the demo", href: "/demo" }, keep: KEEP(["Templates and sending", "/features/templates-and-sending"], ["Proof", "/features/proof"], ["How it works", "/features/how-it-works"]), claimUntilProven: true }),

  // ───────────────────────────── /features/templates-and-sending
  feat({ path: "/features/templates-and-sending", seo: "Templates, text tags and sending to a list", meta: "Write fields into your text with tags, let Docustay find them in a PDF, start from the template library, send to a list from a spreadsheet, and set the signing order, reminders and expiry.", eyebrow: "FEATURES · TEMPLATES AND SENDING",
    h1: "Make a template once. Send it *as often* as you like.", sub: "Put fields in with a text tag or let Docustay find them. Keep the result as a template, send it to one person or a list, and choose the order, the reminders and the deadline. {{F-TEMPLATES}}",
    actions: [["Browse the templates", "/free-templates", "main"], ["Try the demo", "/demo", "alt", "F-DEMO"]], fine: "Text tags · Field detection · Send to a list",
    blocks: [
      { t: "code", id: "tags", eyebrow: "Text tags", h2: "A field is a line of text.", sub: "Write the field where it belongs. The first part is its name; the rest are key=value pairs. {{F-TEMPLATES}}", tabs: [{ label: "Signature", code: "{{Buyer signature;type=signature;role=Buyer}}" }, { label: "Payment", code: TAG }], after: "The first role you write is the first person to sign, the next role is the second. A payment tag takes one fixed amount and a currency. {{F-PAYMENTS}}" },
      { t: "split", id: "detect", eyebrow: "Find fields", h2: "Upload a PDF. Press Find fields.", sub: "Uploading never places boxes by itself. Press Find fields and Docustay reads the page the way a person would, then proposes signature lines, dates, initials and text lines. Nothing is placed until you accept it. {{F-UPLOAD}}", points: ["A scanned page is read by character recognition on the server, in English.", "The optional Find fields with AI button is shown only where AI is turned on."], rev: true, sheets: [{ meta: "Found 14 fields", list: [["Signature", "Buyer"], ["Date", "Buyer"]] }] },
      { t: "cols", id: "library", eyebrow: "Start from something", h2: "A library, your own templates, or a sentence.", cols: [
        { h: "The template library", p: "More than 50 free templates, from an NDA to a lease addendum. Make your own copy and change it. {{F-TEMPLATES}}" },
        { h: "Your templates", p: "Keep a document as a template with its people and fields in place. Send it again with one click or one API call. {{F-TEMPLATES}}" },
        { h: "Scribe", p: "Describe the document in plain words and review what Scribe builds. {{F-SCRIBE}}" }] },
      { t: "cols", id: "send", eyebrow: "Sending", h2: "One person, many people, in order or all at once.", cols: [
        { h: "Send to a list", p: "Upload a spreadsheet and each row gets its own copy and its own signed record. Free sends to up to __BULK_FREE__ at a time. {{F-BULK}}" },
        { h: "Signing order", p: "Name each person and choose whether they sign one at a time or all at once. Each box belongs to one person. {{F-ORDER}}" },
        { h: "Reminders and expiry", p: "Pick when reminders go out and when the document expires. Reminders stop once everyone has signed. {{F-REMIND}}" }] },
      { t: "faq", items: [
        ["Do I have to use text tags?", "No. You can place boxes by hand in the editor, or press Find fields. Tags are for when you write the document yourself or send it from code. {{F-TEMPLATES}}"],
        ["Can the sender fill in a box before sending?", "Yes. A box marked filled by sender is answered before you send, and the signer sees the answer and cannot change it. {{F-TEMPLATES}}"],
        ["Is sending to a list on every plan?", "Yes. Free sends to up to __BULK_FREE__ at a time. {{F-BULK}}"]] },
    ], closing: { title: "Send your first document.", label: "Get started free", href: "/signup" }, keep: KEEP(["Signing", "/features/signing"], ["Scribe", "/features/scribe"], ["Free templates", "/free-templates"]), claimUntilProven: true }),

  // ───────────────────────────── /features/team-and-roles
  feat({ path: "/features/team-and-roles", seo: "Teams, roles and who pays for what", meta: "Three roles: Owner, Admin and Member. Teams, invites, and the price: Pay as you go is per person, and Pro is one price for the whole workspace.", eyebrow: "FEATURES · TEAM AND ROLES",
    h1: "Give people *the right* access.", sub: "A workspace has three roles. You invite people, put them in teams, and the price is simple: Pay as you go is per person, and Pro is one price for the whole workspace. {{F-TEAMS}}",
    actions: [["See pricing", "/pricing", "main"], ["Try the demo", "/demo", "alt", "F-DEMO"]], fine: "Owner · Admin · Member",
    blocks: [
      { t: "matrix", id: "roles", eyebrow: "Roles", h2: "Owner, Admin, Member.", caption: "FIG. 01 · WHAT EACH ROLE CAN DO", head: ["Role", "What it can do"], rows: [
        ["Owner", "Everything, including deleting the workspace and resetting a teammate's two-step sign-in. An Owner can make someone else an Owner. {{F-TEAMS}}"],
        ["Admin", "Everything except deleting the workspace and resetting a teammate's two-step. Admins set up and manage payments. {{F-TEAMS}}"],
        ["Member", "Makes, sends and tracks their own documents, and uses the templates and plays that are switched on. {{F-TEAMS}}"]] },
      { t: "cols", id: "people", eyebrow: "People and teams", h2: "Invite, group, change a role.", cols: [
        { h: "Invites", p: "Invite a person by email and choose their role. You can change a role later or remove the person. {{F-PEOPLE}}" },
        { h: "Organise into teams", p: "Put people into teams so a team sees its own documents. {{F-TEAMS}}" },
        { h: "Sign-in", p: "An Owner can require two-step sign-in for the whole team. {{F-TWOSTEP}}" }] },
      { t: "limits", id: "price", eyebrow: "What it costs", items: [["Free", "One person, the Owner"], ["Pay as you go", "__PAYG_PERSON__ per team member a month"], ["Pro", "One price for the whole workspace, with unlimited team members"]] },
      { t: "faq", items: [
        ["Do signers count as team members?", "No. A signer is anyone you send to, and signers are free on every plan. {{F-ONEUSER}}"],
        ["Is Pro really one price for everyone?", "Yes. Pro is one price for the whole workspace, with unlimited team members, signers and documents. {{F-PRO}}"],
        ["Who can set up payments?", "Admins and Owners. {{F-PAYSETUP}}"]] },
    ], closing: { title: "Start free.", label: "Get started free", href: "/signup" }, keep: KEEP(["Pricing", "/pricing"], ["Payments", "/features/payments"], ["Signing", "/features/signing"]), claimUntilProven: true }),

  // ───────────────────────────── /developers/payments
  devp({ path: "/developers/payments", crumb: "Payments", seo: "Payments API, webhooks and CLI", meta: "Check Stripe status, list payments and refund them over the API. Payment webhooks, the docustay payments command, an MCP tool and how test mode treats a payment field.", eyebrow: "DEVELOPERS · PAYMENTS",
    h1: "Payments, from code.", sub: "Read the state of Stripe, list the payments taken through documents and refund them. Three events tell you when a payment arrives, fails or runs out of time. {{F-PAYMENTS}}",
    actions: [["API reference", "/docs/api-reference", "main"], ["Payments for businesses", "/features/payments", "alt"]], fine: "Three operations · Three events · One CLI command",
    blocks: [
      { t: "code", id: "status", eyebrow: "Is Stripe ready?", h2: "GET /api/v1/payments/status", sub: "Answers whether payments can be taken now. A document with a payment field can only be sent when it is connected. {{F-API}}", tabs: [{ label: "curl", code: STATUS_CURL }], response: STATUS_RESP, responseLabel: "RESPONSE · 200" },
      { t: "code", id: "list", eyebrow: "List payments", h2: "GET /api/v1/payments", sub: "Payments taken through documents, newest first: who paid, for which document, the amount and the status (paid, waiting, started, refunded, partially_refunded or disputed), and this month's figures. Page with before and limit. {{F-API}}", tabs: [{ label: "curl", code: LIST_CURL }], after: "The status waiting means the person has signed and the signature is kept while they pay." },
      { t: "code", id: "shape", eyebrow: "On a document", h2: "A payment, as GET /api/v1/documents/{id} shows it.", sub: "Each payment on a document carries its status, the amount in the smallest unit of its currency, the Stripe receipt, what was refunded and the Docustay fee. {{F-API}}", tabs: [{ label: "JSON", code: PAYMENT_SHAPE }] },
      { t: "matrix", id: "scopes", eyebrow: "Keys and scopes", h2: "What a key needs.", caption: "FIG. 00 · SCOPES", head: ["Operation", "Scope"], rows: [["GET /api/v1/payments/status", "account:read"], ["GET /api/v1/payments", "documents:read"], ["POST /api/v1/payments/{id}/refund", "documents:write"]] },
      { t: "code", id: "refund", eyebrow: "Refund", h2: "POST /api/v1/payments/{id}/refund", sub: "Refund in full or in part. The reason is required, and the payer sees it. Leave out amountMinor to refund the rest. Needs an Idempotency-Key. {{F-PAYREFUND}}", tabs: [{ label: "curl", code: REFUND_CURL }], after: "A refund goes through Stripe, on your own Stripe account." },
      { t: "matrix", id: "events", eyebrow: "Webhooks", h2: "Three payment events.", caption: "FIG. 01 · PAYMENT EVENTS", head: ["Event", "Means"], rows: [
        ["documents.payment.received", "A payment arrived."],
        ["documents.payment.failed", "A payment attempt failed."],
        ["documents.payment.hold_lapsed", "A payment hold ran out before the signer paid."]] },
      { t: "console", id: "cli", eyebrow: "Command line", h2: "docustay payments", notes: [["list", "Lists the payments taken while signing."], ["refund", "Refunds one payment. It moves money, so it asks you to confirm, or you add --yes."]], title: "docustay · payments", lines: [{ k: "cmd", t: "npx docustay payments list" }, { k: "cmd", t: "npx docustay payments refund $DOCUSTAY_PAYMENT_ID --reason \"Charged twice\" --amount-minor 500 --yes" }] },
      { t: "cols", id: "more", eyebrow: "Also", h2: "An MCP tool, and test mode.", cols: [
        { h: "MCP", p: "The get_payments_status tool reports whether Stripe is ready. It needs the account:read scope. {{F-MCP}}" },
        { h: "Test mode", p: "A seat with a payment field cannot be test-signed. Pay it with a Stripe test card. {{F-TESTMODE}}" },
        { h: "Fees", p: "Each payment carries the Docustay fee decided when it started: 200 basis points on Free, 0 on Pro. Stripe's fees are separate. {{F-FEE}}" }] },
      { t: "faq", items: [
        ["Can the API set up Stripe?", "No. Setup is in the app, under Billing, Payments, by an Admin or Owner. The API reads the state. {{F-PAYSETUP}}"],
        ["Does a payment field work from the send call?", "Yes, when the template has one and Stripe is connected. The amount is worked out on the server. {{F-PAYMENTS}}"]] },
    ], closing: { title: "Create a test key.", label: "Create an API key", href: "/signup" }, keep: KEEP(["Payments for businesses", "/features/payments"], ["Payments when you self-host", "/self-host/payments"], ["Webhooks", "/developers/webhooks"], ["Test mode", "/developers/test-mode"]), claimUntilProven: true }),

  // ───────────────────────────── /self-host/payments
  hostp({ path: "/self-host/payments", crumb: "Payments", seo: "Take payments on a self-hosted server", meta: "Use your own Stripe keys, the charges switch, staging and what is and is not available compared with the hosted service.", eyebrow: "SELF-HOST · PAYMENTS",
    h1: "Payments on your own server.", sub: "Put your own Stripe keys in the settings file and payment fields work. The money goes to your Stripe account, and no Docustay fee applies to it. {{F-SELFHOST}}",
    actions: [["Settings reference", "/docs/settings-reference", "main"], ["Payments for businesses", "/features/payments", "alt"]], fine: "Your keys · Your account · Charges are off until you switch them on",
    blocks: [
      { t: "matrix", id: "keys", eyebrow: "Settings", h2: "Four settings for payments.", caption: "FIG. 01 · STRIPE SETTINGS", head: ["Setting", "What it does"], rows: [
        ["KEYSTONE_STRIPE_SECRET_KEY", "Your own Stripe secret key. Needed for payment fields."],
        ["KEYSTONE_STRIPE_PUBLISHABLE_KEY", "The matching publishable key. With it the signer pays inside the signing page; without it, on Stripe's own page, and comes back."],
        ["KEYSTONE_STRIPE_CHARGES_ENABLED", "Off by default. Live charges are refused until it is on."],
        ["KEYSTONE_ENVIRONMENT", "Set to staging and the server refuses live Stripe keys."]] },
      { t: "cols", id: "different", eyebrow: "Compared with hosted", h2: "What is and is not the same.", cols: [
        { h: "No Docustay fee", p: "A self-hosted install has no Docustay plan, so no Docustay fee is added to a payment. Stripe's own fees still apply. {{F-SELFHOST}}" },
        { h: "No guided setup", p: "The hosted Set up payments and Stripe connect pages are not available. The app says Connecting is not switched on for this server yet. You use your own keys. {{F-SELFHOST}}" },
        { h: "Every payment is checked", p: "A payment counts only when Stripe says it is paid. Docustay reads it back from Stripe before it records it. {{F-PAYMENTS}}" }] },
      { t: "faq", items: [
        ["Does Docustay trust the browser about a payment?", "No. When the payer comes back to the signing page, Docustay asks Stripe whether the payment was made and records it only if Stripe says it was paid. {{F-PAYMENTS}}"],
        ["How do I try it without real money?", "Use Stripe test keys. The app then says the server is in Stripe's test mode, and a Stripe test card pays without moving real money. {{F-SELFHOST}}"],
        ["Can I use live keys on a staging server?", "No. With KEYSTONE_ENVIRONMENT set to staging, live Stripe keys are refused. {{F-SELFHOST}}"]] },
    ], closing: { title: "Read the settings reference.", label: "Settings reference", href: "/docs/settings-reference" }, keep: KEEP(["Payments for businesses", "/features/payments"], ["Payments for developers", "/developers/payments"], ["Install and run", "/self-host"]), claimUntilProven: true }),
];
