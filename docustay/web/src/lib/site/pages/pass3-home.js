// Site pass 3: the home page's extra sections. Plan numbers come from plans.js through the page's own `p`.
import { dollars } from "../plans.js";
export const homeDescribe = () => [
  { t: "story", eyebrow: "Describe it", h2: "Say what you need. Review what comes back.", caption: "FIG. 04 · A SCRIBE DRAFT", steps: [{ h: "You say it in words", kind: "scribe", p: "Describe the document. Scribe asks a few questions you answer with a click. {{F-SCRIBE}}" }, { h: "Every field is placed", kind: "fields", p: "Signature, date and the rest, each given to the right person. {{F-SCRIBE}}" }, { h: "You approve, then it sends", kind: "email", p: "Nothing goes out until you say so. Reminders stop once everyone has signed. {{F-REMIND}}" }] },
];
export const homeOrder = () => [
  { t: "scene", kind: "route", eyebrow: "In the order you choose", h2: "Each person gets it when it is their turn.", sub: "Add the order if it matters. The next person is emailed once the one before has signed. {{F-ORDER}}", caption: "FIG. 05 · ONE DOCUMENT, SEVERAL SIGNERS", notes: [["No account", "Everyone signs on a phone or a computer from the link. {{F-SIGN}}"], ["The end", "Everyone gets the sealed copy and its certificate. {{F-CERT}}"]] },
];
export const homeBuild = (p) => [
  { t: "console", eyebrow: "For the people building it", h2: "The e-signature API you can own.", title: "docustay · sample session", lines: [{ k: "cmd", t: "npx docustay send --test TEMPLATE_ID --party signer_1=\"Pat Example <pat@example.com>\"" }, { k: "ok", t: "✔ sent — document 01a11f5c-d36e-70a8-b480-9b41971eb943 (test), 1 email sent" }, { k: "cmd", t: "npx docustay listen --forward-to http://localhost:3000/webhooks" }, { k: "out", t: "09:31:40  documents.document.signed  → 200 (9 ms)" }], rev: true,
    notes: [["Test mode", "A test key emails only you. {{F-TESTMODE}}"], ["Open source", "AGPL-3.0, free to self-host. {{F-LICENCE}}"], ["No per-call fees", "The API is on every plan. {{F-API}}"]] },
  { t: "strip", eyebrow: "The numbers", h2: "What you pay, and what you get.", items: [[String(p.free.docsPerMonth), "documents a month, free", "One person, the owner. {{F-FREEPLAN}}"], [dollars(p.pro.monthlyMinor), "a month, flat", "Unlimited users and documents on Pro. {{F-PRO}}"], ["24", "templates", "In 14 languages. {{F-TEMPLATES}}"], ["13", "key scopes", "Give each integration only what it needs. {{F-SCOPES}}"]] },
];
