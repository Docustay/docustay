// Site pass 3: extra sections for the Trust pages. Every statement repeats a fact already on the trust pages or in the legal evidence file; none adds a certification, a compliance or a legal-outcome claim.
export const TRUST_ADD = {
  // Run 7 part 7: the hub's and the retired pages' additions moved into the Trust centre itself (src/lib/site/pages/trust.js); the hub's old strip said "5 sub-processors" and "restored weekly", both wrong.
  "/trust/legal-validity": [
    { t: "screen", kind: "phone", eyebrow: "The act", h2: "What the signer does, and what we keep.", sub: "The signer opens the document, fills the fields, ticks that they agree to sign electronically, draws or types a signature and presses Finish and sign. The act, its time, address and browser are stored. {{F-SIGN}}", caption: "FIG. 08 · A SIGNING ON A PHONE", note: "SAMPLE DATA", notes: [["Consent", "A disclosure is shown first; its text and version are frozen into the record. {{F-SIGN}}"]] },
    { t: "screen", kind: "certificate", rev: true, eyebrow: "The proof", h2: "A certificate page ends every signed copy.", sub: "Each person, the time and address of each act, the document's SHA-256 fingerprint and the audit trail. {{F-CERT}}", caption: "FIG. 09 · THE CERTIFICATE PAGE", note: "SAMPLE DATA", notes: [["Not legal advice", "This is general information about how signing works. It promises no legal outcome."]] },
  ],
};
