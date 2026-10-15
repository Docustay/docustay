// The clauses most agreements share, written once in plain words so every starter says the same thing the same way. Each returns the items of one section (see legal.mjs `sections`).
// A and B are the defined names of the two sides ("the Provider", "the Client"); `mutual` makes a clause bind both sides alike.
import { pick, STATES } from "./helpers.mjs";

/** Confidentiality between two sides. `one` = only B's information is protected (A receives it); otherwise mutual. */
export const confidentiality = (A, B, { mutual = true } = {}) => mutual ? [
  `<strong>What is confidential.</strong> “Confidential Information” means any non-public information that one side (the “Discloser”) gives the other (the “Recipient”) in connection with this document, in any form, that is marked confidential or that a reasonable person would understand to be confidential from its nature or the way it was shared. It includes plans, prices, customer and supplier details, financial figures, designs, software and the terms of this document.`,
  `<strong>What is not.</strong> Information is not Confidential Information if the Recipient can show that it was already public when received or became public without the Recipient’s fault, was already known to the Recipient without a duty of confidence, was received from someone free to share it, or was developed by the Recipient without using the Discloser’s information.`,
  `<strong>What the Recipient will do.</strong> The Recipient will use Confidential Information only for the purpose of this document; keep it as safe as it keeps its own confidential information, and never with less than reasonable care; and share it only with its own staff, advisers and subcontractors who need it for that purpose and who are bound by duties of confidence at least as strict as these.`,
  `<strong>When disclosure is required.</strong> If the law or a court requires the Recipient to disclose Confidential Information, the Recipient will, where it is lawful to do so, tell the Discloser first so that the Discloser can seek protection, and will disclose only what is required.`,
  `<strong>When this ends.</strong> When the Discloser asks, or when this document ends, the Recipient will return or securely delete the Confidential Information, except for copies it must keep by law or that sit in routine backups, which stay protected for as long as they are kept. These duties continue for three years after this document ends, and for trade secrets for as long as they remain trade secrets.`,
] : [
  `<strong>What is confidential.</strong> ${cap(B)}’s “Confidential Information” means any non-public information that ${B} gives ${A} in connection with this document, in any form, that is marked confidential or that a reasonable person would understand to be confidential, including business plans, prices, customer details, financial figures, access details and the terms of this document. It does not include information that is or becomes public without ${A}’s fault, was already known to ${A} without a duty of confidence, was received from someone free to share it, or was developed independently.`,
  `<strong>What ${A} will do.</strong> ${cap(A)} will use ${B}’s Confidential Information only to carry out this document, keep it as safe as it keeps its own and never with less than reasonable care, and share it only with people who need it for that purpose and are bound by duties of confidence at least as strict as these.`,
  `<strong>Disclosure required by law.</strong> If the law or a court requires ${A} to disclose Confidential Information, ${A} will, where lawful, tell ${B} first and disclose only what is required.`,
  `<strong>When this ends.</strong> When ${B} asks, or when this document ends, ${A} will return or securely delete the Confidential Information, except for copies it must keep by law, which stay protected. These duties continue for three years after this document ends.`,
];

/** Notices (a section). */
export const notices = (A, B, aRole, bRole) => [
  `A notice under this document must be in writing and sent by email to the address ${A} and ${B} have written below their names on the signature page or in the details at the top of this document, or by a courier that records delivery to the postal address given there.`,
  `A notice sent by email is treated as received on the next business day after it is sent, unless the sender receives a message that it was not delivered. A notice sent by courier is treated as received when the courier records delivery.`,
  `Either side may change where notices are sent by giving notice of the new details to the other.`,
];

/** Governing law with a state dropdown, filled by `role`. Use once per document (the field name is fixed). */
export const governingLaw = (role, { court = true } = {}) => [
  `This document, and any dispute arising out of it, is governed by the laws of the State of ${pick(role, "Governing law state", STATES, "Governing law (state)")}, without regard to its rules about conflicts of laws.`,
  ...(court ? [`Before starting any court case, each side will first give the other written notice of the dispute and will talk in good faith, by video or in person, for at least thirty days to try to settle it. If that fails, the courts in that State, and the federal courts that sit there, have exclusive authority over the dispute, and each side agrees to their jurisdiction and venue. Either side may ask a court at any time for an urgent order to protect its confidential information or intellectual property.`] : []),
];

/** The ordinary closing clauses. */
export const general = (what = "this document") => [
  `<strong>The whole agreement.</strong> ${cap(what)} is the entire agreement between the sides on its subject. It replaces everything said or written before about the same subject, and neither side has relied on any promise that is not written here.`,
  `<strong>Changes in writing.</strong> A change to ${what} is effective only if it is in writing and signed by both sides. An email exchange does not change it unless each side expressly says that it is a change and signs it electronically.`,
  `<strong>Assignment.</strong> Neither side may transfer its rights or duties under ${what} without the other’s written consent, which will not be unreasonably withheld. A side may transfer it without consent to a successor that takes over all of its business, if it gives notice.`,
  `<strong>If part of it fails.</strong> If a court finds that any part of ${what} cannot be enforced, that part is limited to the smallest extent needed and the rest stays in effect.`,
  `<strong>No waiver.</strong> A side that does not insist on a right straight away has not given it up. A waiver is effective only if it is written and signed.`,
  `<strong>Things outside a side’s control.</strong> Neither side is in breach because of a delay or failure caused by something beyond its reasonable control, such as severe weather, a power or network failure, or an act of government, if it tells the other promptly and does what it reasonably can to carry on. This does not excuse a duty to pay.`,
  `<strong>Counterparts and electronic signatures.</strong> ${cap(what)} may be signed in separate copies, which together are one document. A signature made electronically, including by typing, drawing or selecting a signature, is as effective as a handwritten one, and each side agrees to sign and keep ${what} in electronic form.`,
  `<strong>Headings.</strong> Headings are only for finding your way around. They do not change the meaning.`,
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
