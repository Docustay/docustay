// THE SHARED DOCUMENT ENGINE — worked examples for the drafting prompt: for each document type, three short patterns (a blank written the right way, how an unknown is handled, how
// a one-sided request is flagged). They are PATTERNS of form, never terms to copy. Pure data.
export const EXAMPLES = Object.freeze({
  nda: [
    'Unknown duration → a blank, not a guess: "The duty lasts for {{Confidentiality term;type=text;role=Disclosing party;label=How long the duty lasts}} after the agreement ends."',
    'Mutual request → both sides are Disclosing and Receiving: "Each party may share Confidential Information (“Confidential Information” means …) and each promises to protect what it receives."',
    'One-sided asks go in careful: "The request makes only one side protect secrets; check that is what you want."',
  ],
  lease_addendum: [
    'Property named in the brief is written exactly; tenant names the brief did not give become {{Tenant name;type=text;role=Tenant}}.',
    'A fee the brief states is written verbatim ("a one-time fee of $50"); no fee stated → no fee clause and an open question "Is there a fee?".',
    'An addendum says it changes only what it names: "Everything else in the lease stays the same."',
  ],
  photo_release: [
    'Uses named in the brief are listed as bullets, one use each; nothing else is granted.',
    'A minor involved → a guardian signs: people include { role: "Parent or guardian", action: "signer" } and the text names the minor with {{Minor name;type=text;role=Parent or guardian}}.',
    'No end date in the brief → say it lasts until the person withdraws in writing, and add that to assumptions.',
  ],
  services: [
    'Scope and deliverables are separate headings; a deliverable the brief did not name is not invented.',
    'Fees: amounts exactly as the brief gives them; payment dates not given → {{Payment due date;type=date;role=Client}}.',
    'Ownership asked to go entirely to one side is flagged in careful: "All rights go to the client; check this carefully."',
  ],
  contractor: [
    'Independence stays factual: own tools and own hours only if the brief says so.',
    'Pay as the brief gives it; never a rate invented to fill a gap.',
    'A request that looks like employment (set hours, exclusivity) is flagged in careful.',
  ],
  consent_waiver: [
    'The activity is described in the brief\'s words; risks listed are only the ones the brief named, plus an open question if none were named.',
    'Minors → guardian signs; both lines appear in people.',
    'A request to waive all claims for everything is flagged in careful: "Very broad; check this carefully."',
  ],
  offer_letter: [
    'Role, pay and start date exactly as given; a missing start date is {{Start date;type=date;role=Candidate}}.',
    'The candidate signs to accept; the sender signs first when the brief says so.',
    'Anything promised that the brief did not say (bonus, equity) is left out.',
  ],
  payment_plan: [
    'Total and instalments exactly as given; if instalments do not add up to the total, say so in open questions and do not fix the numbers yourself.',
    'Late payments: only the consequence the brief names.',
    'A payment field is used only when the brief asks to collect money through the document.',
  ],
  other: [
    'Start from the brief\'s purpose; use headings for each thing the document must do.',
    'Each "must never" in the brief becomes a plain sentence in the text and a line in assumptions.',
    'Unknowns are blanks or open questions, never filler.',
  ],
});
