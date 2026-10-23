// pass 4 (13 Oct 2026): short gap-fill blocks written by hand, each from something checked in the code, the docs or the CLI's own --help output.
export const ADD4_EXTRA = {
  "/product/payments": [
    { t: "cols", eyebrow: "The money side", h2: "What happens to the payment after the signature.", sub: "Paying is the last step of signing, and it goes to your own Stripe account.", cols: [
      { h: "One set amount", p: "A payment field holds one fixed amount, so one template can cover a deposit or a fee. {{F-PAYMENTS}}" },
      { h: "Every payment in one list", p: "The Payments page lists each payment taken while signing, with who paid, for which document and its status, and the same facts are available from the API and the command line. {{F-PAYPAGE}}" },
      { h: "Refunds go through Stripe", p: "A refund is made from Docustay and goes through Stripe: leave out an amount to refund what is left, or give one to refund part. The reason is required. {{F-PAYMENTS}}" },
      { h: "What it costs", p: "Docustay's own fee on a payment taken in a document is __FREE_FEE__ on Free and Pay as you go and __PRO_FEE__ on Pro and Lifetime, on top of Stripe's fees. Docustay does not charge per API call on any plan. {{F-FEE}}" },
      { h: "Where the money goes", p: "A payment is taken through your own Stripe account, so the money goes to you and your Stripe dashboard shows it as it would any other charge. {{F-PAYMENTS}}" },
    ] },
  ],
  "/developers/webhooks": [
    { t: "cols", eyebrow: "On your laptop", h2: "Three commands that stand in for a public server.", sub: "From the command line, with a test key.", cols: [
      { h: "listen", p: "docustay listen forwards real, signed webhook deliveries to an address on your own computer, such as http://localhost:3000/webhooks, so you never have to open a port. {{F-CLI}}" },
      { h: "trigger", p: "docustay trigger sends a test event to the listening endpoint. Choose the event with --topic, for example documents.document.executed. {{F-CLI}}" },
      { h: "verify", p: "docustay verify checks a signature the way your server should, from the secret, the webhook-id, the timestamp, the signature and the body. {{F-CLI}}" },
    ] },
  ],
  "/developers/cli": [
    { t: "cols", eyebrow: "Everything it can do", h2: "The commands, as the command line itself lists them.", sub: "Run docustay help for the full text and flags.", cols: [
      { h: "Sign in and check", p: "login saves your API key, readable only by you, and whoami checks it. DOCUSTAY_API_KEY and DOCUSTAY_URL override what is saved. {{F-CLI}}" },
      { h: "Send and listen", p: "send --test sends a test document from a template, listen forwards webhooks to your computer, trigger sends a test event and verify checks a signature. {{F-CLI}}" },
      { h: "Look things up", p: "search finds documents, templates and people, best first. documents lists, shows, reminds and voids. logs shows the recent email log or a webhook's deliveries. {{F-CLI}}" },
      { h: "Templates and playbooks", p: "templates library lists the built-in templates and templates customize makes your own copy of one. playbooks lists what is on and switches a playbook on or off. {{F-CLI}}" },
      { h: "Payments", p: "payments lists payments taken while signing and can refund one with a reason. {{F-CLI}}" },
      { h: "Fields and AI", p: "detect finds the fields on a PDF without storing anything, and ai usage shows the AI drafts used, the drafts left and when they reset. {{F-CLI}}" },
    ] },
  ],
  "/developers/plays": [
    { t: "cols", eyebrow: "From the command line", h2: "The same library, in two commands.", sub: "Useful when you want a template without opening the app.", cols: [
      { h: "templates library", p: "Lists the built-in templates. Add --json for something a script can read. {{F-PLAYSAPI}}" },
      { h: "templates customize", p: "Makes your own copy of a built-in template, by its slug, with a name you choose. The original never changes, and the copy is a new template. {{F-PLAYSAPI}}" },
      { h: "playbooks on and off", p: "playbooks list shows the packs of templates and skills, and playbooks on or off switches one by name. Your own skills and playbooks are on Pro. {{F-PLAYS}}" },
    ] },
  ],
  "/guides/how-to-sign-a-pdf": [
    { t: "cols", eyebrow: "Three ways", h2: "Which way to sign a PDF fits you.", sub: "The right one depends on who else has to sign.", cols: [
      { h: "Only you", p: "Put a picture of your signature on a copy of the file with the free sign a PDF tool. It runs in your browser and the file is never uploaded, so it suits a form that only needs your name. {{F-SIGNTOOL}}" },
      { h: "You and others", p: "Upload the PDF, say who signs and in what order, and send it. Each person signs on their own device with no account, and everyone gets the sealed copy. {{F-SEND}}" },
      { h: "From your own software", p: "If your system already holds the document, send it from code with a template and a list of signers, and hear about the result through a signed webhook. {{F-API}}" },
    ] },
    { t: "cols", eyebrow: "What a signed PDF should carry", h2: "The record matters as much as the picture.", sub: "A signature image proves very little on its own.", cols: [
      { h: "A seal over the whole file", p: "The finished PDF is sealed with a digital signature over the whole file, so any later change shows. {{F-SEAL}}" },
      { h: "A certificate of completion", p: "The last page lists who signed and when, the address each act came from, and a hash of the file. {{F-CERT}}" },
      { h: "A check anyone can run", p: "The verify page checks a signed PDF in the browser with no account, so you can hand it to the other side or an adviser. {{F-VERIFY}}" },
    ] },
    { t: "cols", eyebrow: "Common snags", h2: "Eight things people ask when a PDF will not cooperate.", sub: "Each answer is about what the free tool and the app actually do.", cols: [
      { h: "It is a scan", p: "A scan is a picture of a page, so you place your signature on top of it like any other page. It works in the free tool and when sending. {{F-SIGNTOOL}}" },
      { h: "I am on a phone", p: "Choose the file, draw your signature with a finger and tap the page where it goes. Signers who receive a document sign the same way, with nothing to install. {{F-SIGN}}" },
      { h: "The file is large", p: "The free tool opens files up to 150 MB, because it never uploads them. When sending, uploads are limited to __FREE_MB__ MB on Free and __PRO_MB__ MB on Pro. {{F-UPLOAD}}" },
      { h: "It is not a PDF", p: "Docustay only accepts PDF files, so save or export a Word or image file as a PDF first. You can also write a document as HTML and make a template from it. {{F-UPLOAD}}" },
      { h: "Several people must sign", p: "Name each person and choose whether they sign one at a time or all at once. Each box on the page belongs to one person, so nobody fills in someone else's part. {{F-ORDER}}" },
      { h: "I need proof later", p: "Keep the sealed copy with its certificate. The audit log records every step and exports as a CSV if you are ever asked for the history. {{F-AUDIT}}" },
      { h: "The form needs filling first", p: "Use the free fill a PDF tool to type into the form's own fields, then add your signature with the sign a PDF tool. Both run in your browser. {{F-FILLTOOL}}" },
      { h: "I made a mistake", p: "Both tools write a new copy and never change the file you chose, so you can go back to the original and start again whenever you like. {{F-SIGNTOOL}}" },
    ] },
  ],
};
