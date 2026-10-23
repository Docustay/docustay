// pass 4 (13 Oct 2026, site rebuild): extra blocks for the seven use-case pages and their index. Two kinds, both honest:
//  1. generated from the template data (usecase-templates.gen.json, written by scripts/build-usecase-data.mjs from the same files the template pages use), so a use-case page can never disagree with the template it names;
//  2. hand-written practice notes: what to do before sending, while it is out and after it is signed, for that use. Every capability sentence ends with a {{F-ID}} marker that is in features.json.
import T from "./usecase-templates.gen.json" with { type: "json" };

const dot = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : s.trim() + ".");
const list = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a.at(-1));
const detail = (use) => T.filter((t) => t.use === use).map((t) => ({ h: t.title, p: `${dot(t.line)} ${list(t.roles)} ${t.roles.length > 1 ? "each sign their own boxes" : "signs"}, over ${t.pages} ${t.pages === 1 ? "page" : "pages"} and ${t.fields} fields, about ${t.minutes} minutes in all. {{F-TEMPLATES}}` }));
const checks = (use) => T.filter((t) => t.use === use).map((t) => ({ h: `Before you send: ${t.title.replace(/ template$/i, "").toLowerCase()}`, p: `${t.when.map(dot).join(" ")} ${t.check.map((c, i) => `${i + 1}. ${dot(c)}`).join(" ")}` }));
const asks = (use) => T.filter((t) => t.use === use).map((t) => ({ h: `What the ${t.title.replace(/ template$/i, "").toLowerCase()} asks for`, p: `${t.labels.join(", ")}${t.fields > t.labels.length ? `, and ${t.fields - t.labels.length} more` : ""}. Each box sits where it belongs on the page and belongs to one person, so nobody fills in a part that is not theirs. {{F-TEMPLATES}}` }));
const block = (use, t) => [
  { t: "cols", eyebrow: "The templates", h2: t.templatesH, sub: t.templatesSub, cols: detail(use) },
  { t: "cols", eyebrow: "The fields", h2: "What the document asks for.", sub: "Read from the template itself, so this list is what the signer will see.", cols: asks(use) },
  { t: "cols", eyebrow: "Before you send", h2: t.beforeH, sub: t.beforeSub, cols: t.before },
  { t: "cols", eyebrow: "While it is out", h2: t.whileH, sub: t.whileSub, cols: t.while },
  { t: "cols", eyebrow: "After it is signed", h2: t.afterH, sub: t.afterSub, cols: t.after },
];

export const ADD4_USECASE = {
  "/use-cases": [
    { t: "cols", eyebrow: "Seven places people start", h2: "Pick the one closest to your job.", sub: "Each page names the templates for that work, what to check before you send, and what you keep afterwards.", cols: [
      { h: "Contracts", p: "Services agreements, contractor agreements and the paperwork around a job. Two parties sign, in order or together, and both keep a sealed copy. {{F-ORDER}}" },
      { h: "NDAs", p: "A mutual NDA and a non-solicitation agreement for the start of a deal. Both sides sign from a link on any device, with no account. {{F-SIGN}}" },
      { h: "Waivers and consent", p: "Liability waivers, photo and media releases and permission slips, sent to each person on a list, with a record for everyone who signs. {{F-BULK}}" },
      { h: "HR and onboarding", p: "Offer letters and a first-day pack the new person fills in on a phone before they arrive, with one signed copy for the file. {{F-SEND}}" },
      { h: "Real estate", p: "Lease addenda, rental applications and deposit agreements, sent to each applicant or tenant on their own, with the deposit paid inside the document. {{F-TEMPLATES}}" },
      { h: "Education", p: "Permission slips and consent paperwork sent to every family from a list, so you can see at a glance who has answered and who has not. {{F-BULK}}" },
      { h: "Agencies", p: "Statements of work and change orders, so each job and each change has its own signed scope and price. {{F-TEMPLATES}}" },
    ] },
    { t: "cols", eyebrow: "What stays the same", h2: "The same sealed record, whichever one you use.", sub: "Every use case ends the same way, so you only learn it once.", cols: [
      { h: "A sealed PDF", p: "When everyone has signed, the finished PDF is sealed with a digital signature over the whole file, so a later change shows. {{F-SEAL}}" },
      { h: "A certificate on the last page", p: "It lists who signed and when, and carries a hash of the file, so the copy can be checked on the verify page without an account. {{F-CERT}}" },
      { h: "An audit trail you can export", p: "Every step on a document is recorded, from sent to opened to signed, and the trail exports as a CSV. {{F-AUDIT}}" },
    ] },
  ],

  "/use-cases/contracts": block("contracts", {
    templatesH: "Six templates that cover most agreements.", templatesSub: "Each one has its roles and fields placed already. Start from the one that fits and change anything that does not.",
    beforeH: "Check these before an agreement goes out.", beforeSub: "Most delays come from a missing name, a wrong date or the wrong person receiving it.",
    before: [
      { h: "Who signs, and in what order", p: "Decide whether the signers go one at a time or all at once. One at a time suits an agreement the client reviews after you have signed; all at once is quicker when nothing depends on order. {{F-ORDER}}" },
      { h: "Fields only you can fill", p: "Some boxes, such as your own name and the date of the agreement, are filled in by you before sending, so the other side never has to. The template marks them as yours. {{F-TEMPLATES}}" },
    ],
    whileH: "While the agreement is out.", whileSub: "You can see where it stands without asking anyone.",
    while: [
      { h: "See who has opened it", p: "Each document shows whether it was sent, opened or signed, and by whom. If a signer has not opened it, you know before you chase them. {{F-AUDIT}}" },
      { h: "Let reminders do the chasing", p: "Reminders go out on their own until everyone has signed, so a forgotten email does not hold up the start date. {{F-REMIND}}" },
      { h: "Signers need no account", p: "The signer opens the link on a phone or a computer, reads, draws or types a signature and finishes. There is nothing to install and no password. {{F-SIGN}}" },
    ],
    afterH: "Once it is signed, it is findable.", afterSub: "The record does not end at the last signature.",
    after: [
      { h: "Everyone keeps a copy", p: "Both parties receive the sealed PDF with its certificate. You can download it again from the document at any time. {{F-SEAL}}" },
      { h: "Send the same agreement again", p: "Save your own copy of the template with your wording and fields, and the next client starts from that. Free makes up to __FREE_TEMPLATES__ new templates a month; the paid plans have no limit. {{F-TEMPLATECAP}}" },
    ],
  }),

  "/use-cases/ndas": block("ndas", {
    templatesH: "An NDA and a promise not to recruit.", templatesSub: "The two documents most deals start with, both already set up for two signers.",
    beforeH: "The three decisions an NDA turns on.", beforeSub: "An NDA is short, so the details that matter are few. Settle them before you send.",
    before: [
      { h: "One-way or mutual", p: "A mutual NDA binds both sides to the same promise, which is easier to ask for and quicker to agree. If only one side will share secrets, change the wording so it says so before you send it. {{F-TEMPLATES}}" },
      { h: "Where the other side signs", p: "Many NDAs are signed by someone who is travelling or between meetings. The signing page works on a phone with no account, so you are not waiting for a laptop. {{F-SIGN}}" },
    ],
    whileH: "While you wait for the other side.", whileSub: "An NDA is usually urgent: the conversation cannot start until it is signed.",
    while: [
      { h: "Send in your own name", p: "The email carries your logo and goes out under your name, so the other side sees a message from you and not from a stranger. {{F-BRANDING}}" },
      { h: "Choose the order", p: "You can have the other side sign first, or both sign at once. Everyone at once is the fastest way to get the document back. {{F-ORDER}}" },
      { h: "Know when it is opened", p: "The document shows when it was opened and by whom, so a quiet signer is a reminder you can send, not a mystery. {{F-AUDIT}}" },
    ],
    afterH: "What you keep after both sides sign.", afterSub: "If a dispute ever comes up, the record is what you will want.",
    after: [
      { h: "A sealed copy with a certificate", p: "The signed PDF is sealed so a later change shows, and its last page records who signed and when, with a hash of the file. {{F-CERT}}" },
      { h: "Proof anyone can check", p: "The verify page checks a signed PDF in the browser, with no account. You can give it to the other side or an adviser. {{F-VERIFY}}" },
      { h: "A note on what it is", p: "A Docustay signature is a simple electronic signature with a strong record and a digital seal. The template is a starting point in plain words and is not legal advice. {{F-VERIFYDOC}}" },
    ],
  }),

  "/use-cases/waivers-and-consent": block("waivers-and-consent", {
    templatesH: "Four documents for activities, pictures and children.", templatesSub: "Each can be sent to a whole list, so every person gets their own copy to sign.",
    beforeH: "Before you send it.", beforeSub: "A waiver is only as useful as the record behind it, so decide what you will keep.",
    before: [
      { h: "A list, not one at a time", p: "Upload the guest list and send the waiver to everyone at once. Each person gets their own copy and signs it, and each signature becomes its own signed record. {{F-BULK}}" },
      { h: "Minors need a guardian", p: "For anyone under 18, use the media release or permission slip, where a parent or guardian signs on the child's behalf. Say clearly in the document whose permission is being given." },
    ],
    whileH: "While people sign.", whileSub: "The busy moment is the half hour before an event, and the signing page is built for it.",
    while: [
      { h: "Any phone, no account", p: "People sign on their own phone in a minute, with nothing to install and no password to forget. {{F-SIGN}}" },
      { h: "See who is missing", p: "The document list shows who has signed and when, so you can check it against the attendee list before the activity starts. {{F-AUDIT}}" },
    ],
    afterH: "Keeping the record.", afterSub: "The point of a waiver is being able to show it later.",
    after: [
      { h: "One sealed record per person", p: "Every signature is sealed on its own PDF with a certificate, so you can find one person's waiver without sorting through a pile. {{F-SEAL}}" },
      { h: "Export what happened", p: "The audit log records each step and exports as a CSV, which is handy for an insurer or a venue that asks for proof. {{F-AUDIT}}" },
      { h: "Counted when sent", p: "Each document counts when it is sent, so plan for the number of people you expect. Free includes __FREE_DOCS__ a month; Pay as you go is __PAYG_DOC_OVER__ for each one past __PAYG_DOCS__. {{F-PAYG}}" },
    ],
  }),

  "/use-cases/hr-and-onboarding": block("hr-and-onboarding", {
    templatesH: "An offer letter and a first-day pack.", templatesSub: "One goes to a candidate to accept, the other to a new hire to fill in before day one.",
    beforeH: "Before you send the paperwork.", beforeSub: "Paperwork should not be the first thing a new person does on their first morning.",
    before: [
      { h: "Send early, send once", p: "The new hire pack gathers the usual paperwork into one send, so the person gets one email and fills everything in from a phone before they start. {{F-SEND}}" },
      { h: "Keep the offer simple", p: "An offer letter states the role, the pay and the start date and asks for one signature. Anything long belongs in the agreement that follows, not in the offer." },
    ],
    whileH: "While the person decides.", whileSub: "A candidate with an offer is waiting on you as much as you are waiting on them.",
    while: [
      { h: "Nothing to install", p: "The candidate opens the link, reads the offer and signs, on a phone or a computer, without making an account. {{F-SIGN}}" },
      { h: "Reminders that are not awkward", p: "Reminders go out automatically until the person has signed, so you are not the one who has to ask twice. {{F-REMIND}}" },
      { h: "Send a batch", p: "When several people start together, send one template to a list from a CSV and each person gets their own copy to sign. {{F-BULK}}" },
    ],
    afterH: "After the person signs.", afterSub: "Hand off the signed copy and move on to the first day.",
    after: [
      { h: "A sealed copy for the file", p: "The signed PDF is sealed and carries a certificate of completion, ready to go into the person's file. {{F-SEAL}}" },
      { h: "Hear about it in your own tools", p: "A signed document can raise a signed webhook event, so your own systems know to start the next step. {{F-WEBHOOKS}}" },
      { h: "Team roles", p: "Give the people who send offers a role, and keep who can see what under control. Pro is one flat price for the whole workspace, and Pay as you go is __PAYG_PERSON__ per team member a month. {{F-TEAMS}}" },
    ],
  }),

  "/use-cases/real-estate": block("real-estate", {
    templatesH: "Applications and addenda for property work.", templatesSub: "The paperwork that passes between a landlord, a manager and the person who rents.",
    beforeH: "Before you send it to a tenant or applicant.", beforeSub: "Two different documents, two different ways of sending.",
    before: [
      { h: "An application goes to one applicant", p: "Send the rental application to each applicant, who fills in their details and signs from a phone. Each application is saved on its own, so you are not sorting a shared inbox. {{F-TEMPLATES}}" },
      { h: "An addendum goes to named people", p: "A lease addendum goes to the tenants on a lease, each by email, with the signing order you choose. Put the names and addresses in before sending so they only have to read and sign. {{F-ORDER}}" },
    ],
    whileH: "While tenants sign.", whileSub: "People sign at home in the evening, so make it easy on a phone.",
    while: [
      { h: "Sign from the sofa", p: "The signing page works on a phone with no app and no account, and the signer can draw a signature with a finger. {{F-SIGN}}" },
      { h: "Reminders until it is back", p: "Reminders go out automatically until everyone on the lease has signed. {{F-REMIND}}" },
      { h: "Collect a fee in the same step", p: "A payment field can take an application fee or a deposit as the last step of signing, through your own Stripe account. Paying comes after the signature. {{F-PAYLAST}}" },
    ],
    afterH: "After the lease is signed.", afterSub: "A lease runs for a year or more, so the record matters.",
    after: [
      { h: "Payments in one list", p: "Every payment taken while signing appears on the Payments page with who paid, for which document, and its status. {{F-PAYPAGE}}" },
      { h: "A record for every step", p: "The audit log shows when each tenant received, opened and signed, which settles most questions about who saw what and when. {{F-AUDIT}}" },
    ],
  }),

  "/use-cases/education": block("education", {
    templatesH: "Documents for trips and activities.", templatesSub: "Built to be sent to a whole class or a whole club in one go.",
    beforeH: "Before you send it home.", beforeSub: "A permission slip works best when it is specific and arrives early.",
    before: [
      { h: "Say what, when and who to call", p: "A good slip names the activity, the date and a person to call. The template has a place for each, so a parent can answer in one read. {{F-TEMPLATES}}" },
      { h: "One list for the whole class", p: "Upload the class list and send the slip to every family at once. Each parent gets their own copy and signs it on their own phone. {{F-BULK}}" },
    ],
    whileH: "While the slips come back.", whileSub: "The question every teacher asks is who has not answered yet.",
    while: [
      { h: "No paper to chase", p: "A parent opens the email, signs with a finger and is done. There is no account, no app and nothing to print or send back in a bag. {{F-SIGN}}" },
      { h: "See the gaps", p: "The document list shows who has signed and when, so you can follow up with the families who have not answered. {{F-AUDIT}}" },
    ],
    afterH: "Keeping the record.", afterSub: "A signed slip is the answer to a question you may be asked months later.",
    after: [
      { h: "A sealed copy for each child", p: "Each signed slip is its own sealed PDF with a certificate of completion, so one family's answer is easy to find. {{F-CERT}}" },
      { h: "An export for the office", p: "The audit log exports as a CSV, so the school office can keep the list with the trip file. {{F-AUDIT}}" },
      { h: "Free to start", p: "A document counts when it is sent, and the Free plan includes __FREE_DOCS__ documents a month, with a list send of up to __BULK_FREE__ at a time. {{F-FREEPLAN}}" },
    ],
  }),

  "/use-cases/agencies": block("agencies", {
    templatesH: "A scope for the job and a record for each change.", templatesSub: "Two documents agencies reach for again and again, one for the work and one for when the work moves.",
    beforeH: "Before you send the scope.", beforeSub: "Disputes about extra work almost always start with a scope that was never written down.",
    before: [
      { h: "One scope per job", p: "Use the statement of work for each job under a larger agreement, so every job has its own deliverables, dates and price, signed by the client. {{F-TEMPLATES}}" },
      { h: "Describe it instead of filling it in", p: "If a job does not fit a template, describe it in plain words and Scribe writes the document and places the fields; you review it before it is sent. Scribe never sends on its own. {{F-SCRIBE}}" },
    ],
    whileH: "While the client reviews.", whileSub: "The client is often busy, and the quicker the scope is signed the sooner the work can start.",
    while: [
      { h: "The client signs anywhere", p: "A link on a phone or a computer, no account, and a signature drawn or typed. {{F-SIGN}}" },
      { h: "Reminders on autopilot", p: "Reminders keep going until the client has signed, without you writing the third nudge. {{F-REMIND}}" },
      { h: "Send from your own system", p: "If your project tool already knows the client and the job, send the template from code and hear about the result through a signed webhook. {{F-API}}" },
    ],
    afterH: "When the scope changes.", afterSub: "The change order is the document that keeps the first agreement honest.",
    after: [
      { h: "Name the agreement it changes", p: "A change order records what changes, what it costs and when, and refers back to the agreement it changes. Send it before the extra work begins, not after. {{F-TEMPLATES}}" },
      { h: "Get paid inside the document", p: "A payment field can take a deposit as the last step of signing, through your own Stripe account. The fee is __FREE_FEE__ on Free and Pay as you go and __PRO_FEE__ on Pro, on top of Stripe's. {{F-FEE}}" },
      { h: "One price for the studio", p: "Pro is __PRO_PRICE__ a month flat for the whole workspace, so adding another account manager never changes the bill. {{F-PRO}}" },
    ],
  }),
};
