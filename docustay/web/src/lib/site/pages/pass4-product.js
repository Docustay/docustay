// pass 4 (13 Oct 2026, site rebuild): extra blocks for the product family, keyed by page path. Same block types as pass3 (see ../desk/Blocks.svelte).
// Every fact below was read from docustay/docs/*.md, sdk/openapi/openapi.json, sdk/mcp/SCOPES.md, the CLI's --help or src/documents/*.mjs. Capability sentences end with their {{F-ID}}.
// Numbers that are plan limits are placeholders the registry fills (__FREE_DOCS__ and friends).

const REL = (items) => ({ t: "tiles", eyebrow: "Related", h2: "Keep going with the next piece.", items });

export const ADD4_PRODUCT = {







  "/product/proof": [
    { t: "spec", eyebrow: "The verifier", h2: "Three checks, and what they do not prove.", sub: "The verify page re-reads the signature inside the PDF. A forger who only copies the right digest into a fake signature fails the second check. {{F-VERIFY}}", rows: [
      ["1 · The digest", "The digest the signer signed must equal the digest of the file's signed byte ranges."],
      ["2 · The signature value", "The signature over the signed attributes must verify with the public key of the certificate inside the file."],
      ["3 · The end of the file", "The last signed range must reach the end of the file, or what follows is only Docustay's own validation material. A page appended after sealing fails."],
      ["Whose seal", "The verifier reports the certificate that sealed the file and says known when its fingerprint is on Docustay's published list, unknown otherwise."],
      ["What it does not say", "The seal is a self-signed certificate. A pass means this exact signature was made by that key over this exact file. It does not mean an outside authority vouches for who signed. {{F-VERIFYDOC}}"],
    ] },
    { t: "matrix", eyebrow: "On the last page", h2: "What the certificate can show, and what you can leave off.", caption: "FIG. 09 · THE CERTIFICATE'S PARTS", head: ["Part", "What is printed", "Owner setting"], rows: [
      ["Timeline", "Each step in time order: sent, opened, reminded, agreed to sign, signed, completed. {{F-CERT}}", "On or off"],
      ["Network address", "The address each signer opened and signed from. {{F-CERT}}", "On or off"],
      ["Device and browser", "The device each signer used. {{F-CERT}}", "On or off"],
      ["Document fingerprints", "A hash of the original file. {{F-CERT}}", "On or off"],
      ["Consent record", "That each person agreed to sign electronically: the version, time, address and device. {{F-CERT}}", "On or off"],
      ["Closing statement", "A sentence at the bottom saying the document was sealed with a digital signature when the last party signed. {{F-CERT}}", "Editable, up to 600 characters"],
    ], foot: "Also on it when they apply: the reason a person gave, who a seat was passed on from, what each signer paid with Stripe's reference, and a signature ID. The certificate is the last pages of the PDF, or a second sealed PDF if you switch that setting. {{F-CERT}}" },
    { t: "cards", eyebrow: "Keep the record", h2: "Evidence you can hand to someone else.", items: [
      { icon: "archive", h: "The evidence package", p: "Once a document is executed, a team member can download one zip: original.pdf, signed.pdf, audit-log.csv, evidence.json and a README. evidence.json lists every signature with its hashes and every file with its SHA-256. {{F-AUDIT}}" },
      { icon: "hash", h: "A signature ID", p: "The first 12 characters of a signature record's own hash, in three groups of four, printed beside the signature when the owner turns it on. Anyone can recompute it from the record. {{F-CERT}}" },
      { icon: "clock", h: "How long it is kept", p: "Signed documents stay in your workspace, and you can download the sealed copy and its audit log at any time. {{F-AUDIT}}" },
    ] },
    { t: "code", eyebrow: "Fetch it", h2: "Download the sealed copy from your own code.", tabs: [
      { label: "Signed PDF", code: "curl https://docustay.app/api/v1/documents/DOCUMENT_ID/signed.pdf \\\n  -H \"Authorization: Bearer $DOCUSTAY_API_KEY\" -o signed.pdf" },
      { label: "Audit log CSV", code: "curl https://app.docustay.app/api/v1/documents/DOCUMENT_ID/audit-log.csv \\\n  -H \"Authorization: Bearer $DOCUSTAY_API_KEY\"" },
    ], after: "Until the sealed copy exists the call answers 404 saying it is being made. Ask again after a moment, or wait for the documents.document.executed webhook. {{F-SEAL}}" },
    { t: "prose", eyebrow: "Self-hosting", h2: "On your own server, the seal is yours.", paras: [
      "A self-hosted install makes a signing certificate for itself at first run. Set your own to use one from a trusted authority, and point it at a timestamp authority so finished documents carry a trusted timestamp. {{F-SELFHOST}}",
      "A Docustay signature is a simple electronic signature with a strong record and a digital seal. There are no qualified signatures, no identity checks and no legal advice. {{F-VERIFYDOC}}",
    ] },
    REL([
      { h: "Tracking", p: "The same events as a list and a CSV.", href: "/features/how-it-works#prove", icon: "list-checks", feature: "F-AUDIT" },
      { h: "Signing", p: "Settings that decide what ends up on the certificate.", href: "/features/how-it-works#sign", icon: "pen-line", feature: "F-SIGN" },
      { h: "Check a PDF", p: "Drop a signed file on the verify page.", href: "/verify", icon: "shield-check", feature: "F-VERIFY" },
    ]),
  ],

  "/product/payments": [
    { t: "matrix", eyebrow: "The Payments list", h2: "Every payment has one status.", caption: "FIG. 04 · PAYMENT STATUSES", head: ["Status", "Means"], rows: [
      ["paid", "Stripe took the money. {{F-PAYPAGE}}"],
      ["waiting", "The person has signed and the signature is kept, for up to 7 days, while they pay. {{F-PAYLAST}}"],
      ["started", "They opened the payment and did not finish it. {{F-PAYPAGE}}"],
      ["refunded or partially_refunded", "Some or all of it was given back. {{F-PAYPAGE}}"],
      ["disputed", "The payer's bank opened a dispute. You answer it in Stripe. {{F-PAYPAGE}}"],
    ], foot: "This month's figures sit above the list: money in, Stripe's own fees and refunds. Stripe's fee can show as pending for a few minutes while Stripe settles it." },
    { t: "spec", eyebrow: "The amount", h2: "The amount is set on the server.", rows: [
      ["Fixed", "amount=150.00 with a currency. From 0.50 to 999,999.99. {{F-PAYMENTS}}"],
      ["Never the browser", "The server reads the amount from the document you sent. The browser never sends an amount."],
      ["Card details", "Typed on Stripe's page. Docustay never receives or stores them."],
    ] },
    { t: "code", eyebrow: "Refunds", h2: "Give money back from your own code.", sub: "A refund goes through Stripe on your own account. Leave out the amount to refund the rest. A reason is required: the payer sees it on their receipt and it goes in the document's audit trail. {{F-PAYPAGE}}", tabs: [
      { label: "JavaScript", code: "const r = await docustay.refundPayment(paymentId, { amountMinor: 500, reason: \"Charged twice\" });" },
      { label: "Python", code: "docustay.refund_payment(payment_id, reason=\"Charged twice\")   # the rest of the payment" },
      { label: "Command line", code: "docustay payments list\ndocustay payments refund PAYMENT_ID --reason \"Charged twice\" --amount-minor 500 --yes" },
    ], after: "A refund moves money, so it needs an Idempotency-Key, and the same key never refunds twice. The command line never runs without --yes. The MCP server has no tool to refund, so only a person does. {{F-API}}" },
    { t: "limits", eyebrow: "Before the first payment", h2: "What has to be true to send a document with a payment field.", items: [
      ["Stripe connected", "Billing, Payments: set up payments, and Stripe's own sign-up page creates an account in your name, or choose I already have Stripe and sign in to the account you use. The status reads connected, needs_attention or not_connected."],
      ["Only when connected", "A document with a payment field can only be sent when the status is connected; otherwise Send answers with a plain reason."],
      ["The fee", "Docustay's fee is __FREE_FEE__ on Free and Pay as you go and __PRO_FEE__ on Pro and Lifetime, on top of Stripe's fees, decided when the payment starts. A refund returns the fee with it."],
      ["Test mode", "Does not test payments against real cards."],
    ] },
    { t: "prose", eyebrow: "On the record", h2: "The payment is part of the proof.", paras: [
      "The certificate lists what each signer paid, by Stripe's own reference, and only money that actually arrived. {{F-CERT}}",
      "The payments list on GET /api/v1/documents/{id} shows each payment's status, amount, Stripe receipt link, refunds and the Docustay fee. {{F-API}}",
    ] },
    REL([
      { h: "Templates", p: "The payment tag, and the other field types.", href: "/free-templates", icon: "file-text", feature: "F-TEMPLATES" },
      { h: "Signing", p: "Paying is the last step of signing.", href: "/features/how-it-works#sign", icon: "pen-line", feature: "F-SIGN" },
      { h: "Proof", p: "What the certificate shows about a payment.", href: "/features/proof", icon: "shield-check", feature: "F-CERT" },
    ]),
  ],


  "/product/scribe": [
    { t: "matrix", eyebrow: "The questions", h2: "What Scribe asks before it writes a word.", caption: "FIG. 06 · THE WIZARD'S FIRST EIGHT QUESTIONS", head: ["Question", "How you answer"], rows: [
      ["What is this for, in plain words?", "Free text. {{F-SCRIBE}}"],
      ["Who are the parties, and who signs?", "Free text. {{F-SCRIBE}}"],
      ["Who signs first?", "No order, or one after another in the order listed. {{F-ORDER}}"],
      ["What does each side provide?", "Free text. {{F-SCRIBE}}"],
      ["Money terms and dates", "Free text. Amounts and dates come from you only; anything left out becomes a blank someone fills in. {{F-SCRIBE}}"],
      ["Which state or country's law applies?", "Free text. Left blank, it becomes a blank to fill in. {{F-SCRIBE}}"],
      ["What does the signer fill in?", "Free text. {{F-SCRIBE}}"],
      ["How long do they have, and when to remind?", "Free text. {{F-SCRIBE}}"],
    ], foot: "Then the questions for the kind of document: an NDA, a lease addendum, a photo release, a services agreement, a contractor agreement, a consent or waiver form, an offer letter or a deposit agreement. {{F-SCRIBE}}" },
    { t: "spec", eyebrow: "Limits on the assistant", h2: "What Scribe never does.", rows: [
      ["Send, pay, sign", "Scribe never sends a document, never pays and never signs. Over MCP, nothing is emailed until send_draft is called again with confirm set to true. {{F-SCRIBE}}"],
      ["Changes are proposals", "An edit request returns proposed changes (replace_text, insert_block, replace_block or remove_block) for a person to accept. It never returns an edited document. {{F-SCRIBE}}"],
      ["Money is yours", "The amount of a payment comes only from the person. Plain code, not the model, checks every amount it proposes against yours and places one payment field for the payer. {{F-SCRIBE}}"],
      ["Progress", "A draft job moves from queued to writing, checking and ready, or failed. It can be cancelled, and a job whose worker died is put back and finished by itself."],
      ["Off by default", "An owner switches AI drafting on for the workspace, and can set a second reader for each draft, require the sender to read it before sending, add house rules and cap drafts a day and a month."],
    ] },
    { t: "code", eyebrow: "From your code", h2: "Ask for a draft and poll for the result.", sub: "A draft is a suggestion for a person to read: nothing is saved or sent. {{F-SCRIBE}}", tabs: [
      { label: "Ask", code: "curl -X POST https://docustay.app/api/v1/documents/ai/draft \\\n  -H \"Authorization: Bearer $DOCUSTAY_API_KEY\" -H \"Content-Type: application/json\" \\\n  -d '{ \"prompt\": \"A one-page services agreement with a client signature\", \"mode\": \"template\" }'" },
      { label: "Poll", code: "curl https://docustay.app/api/v1/documents/ai/jobs/$JOB_ID -H \"Authorization: Bearer $DOCUSTAY_API_KEY\"" },
      { label: "In your page", code: "<script type=\"module\" src=\"https://docustay.app/embed/index.js\"></script>\n<docustay-scribe url=\"…the url…\" height=\"720\"></docustay-scribe>" },
    ], after: "The ask answers 202 with a job id. When the job is done, source is the draft and patches.notes lists what to check. The embedded panel uses a draft-only key that allows 50 drafts a day and ends in an hour. {{F-EMBED}}" },
    { t: "cards", eyebrow: "Your say", h2: "Pick a writer, see the price.", items: [
      { h: "Three writers", p: "Plain-language writer (short sentences, no jargon), Careful contract drafter (precise terms, defined words, every risk named) and Quick forms (short forms and notices, fast). {{F-SCRIBE}}" },
      { h: "Drafts", p: "Free includes __FREE_CREDITS__ AI drafts a month and Pro includes __PRO_CREDITS__. Past that a draft is __DRAFT_OVER__ on a paid plan, shown before you use it. {{F-AICREDITS}}" },
      { h: "Ten currencies for payments", p: "The wizard offers usd, eur, gbp, cad, aud, nzd, chf, sek, nok and dkk. A document with a payment can only be sent when Stripe is connected. {{F-PAYMENTS}}" },
    ] },
    REL([
      { h: "Templates", p: "Scribe finds the right built-in template and reads its guidance.", href: "/free-templates", icon: "file-text", feature: "F-TEMPLATES" },
      { h: "Payments", p: "Payment terms are set once Stripe is connected.", href: "/features/payments", icon: "credit-card", feature: "F-PAYMENTS" },
      { h: "Developers: agents", p: "The MCP server and the connector.", href: "/developers/agents", icon: "terminal", feature: "F-MCP" },
    ]),
  ],
};
