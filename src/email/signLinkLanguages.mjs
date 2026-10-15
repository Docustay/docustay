// The signing email's fixed wording in the languages a send can use (QUEUE §23.5.6): en, es, fr, de here; the ten added in Part 30 item 9 come from the Documents front door. Pure data apart from that one import.
// ★ MACHINE-WRITTEN: Spanish, French and German need a native speaker's review before they are relied on (recorded on the board).
// The sender's own message is never translated — only the fixed frame around it.
const EN = {
  hello: (n) => `Hello ${n || "there"},`,
  reminder: "Reminder:",
  sentBy: (who, org) => (who && who !== org ? `Sent by ${who} via ${org}. If the button above does not work, copy and paste this link: ` : `Sent by ${org}. If the button above does not work, copy and paste this link: `),
  sentYou: (org, doc, to) => `${org} sent you ${doc} ${to}`,
  sentWith: (product) => `Sent with ${product}`,
  verbs: {
    sign:    { button: "Review and sign",    to: "to sign",                       waiting: "is waiting for your signature",   note: "Nothing is signed until you choose to sign it, and you can read the whole document first.", body: (w) => `${w} has sent you a document to review and sign.` },
    approve: { button: "Review and approve", to: "for your approval",             waiting: "is waiting for your approval",    note: "Nothing is approved until you choose to approve it, and you can read the whole document first.", body: (w) => `${w} needs your approval on a document before it goes to be signed.` },
    view:    { button: "Open the document",  to: "to look at",                    waiting: "is waiting for you to look at it", note: "You are only asked to confirm that you have seen it — you are not signing anything.", body: (w) => `${w} would like you to look at a document.` },
    assist:  { button: "Fill in details",    to: "for you to fill in details for someone", waiting: "is waiting for the details you were asked to fill in", note: "You are filling in details only. The person who signs will check them and sign it themselves.", body: (w) => `${w} asked you to fill in some details on a document before someone else signs it.` },
  },
};
const TABLE = { en: EN };
import { EMAIL_LANGUAGE_WORDS } from "../documents/frontDoor.mjs";
export const emailWords = (lang) => TABLE[lang] ?? EMAIL_LANGUAGE_WORDS[lang] ?? EN;
