// P15C.0 / P15C.10 — THE ELECTRONIC RECORDS DISCLOSURE. TEXT, VERSION, AND THE ASK-AGAIN RULE.
//
// ★★★ PORTED FROM `~/example-simple-app/shared/esign/electronicRecordsDisclosure.tsx` (ADD6-1).
//     The React component is ported separately to `web/src/esign/ElectronicRecordsDisclosure.jsx`;
//     **this file is the pure text, version and decision, and it lives SERVER-SIDE ON PURPOSE.**
//
// ★★★ WHY THE SERVER OWNS THE TEXT, WHICH IS A CHANGE FROM THE ORIGINAL'S SHARED PLACEMENT:
//     §M0 LAW 3 requires the disclosure text AND ITS VERSION to be FROZEN into an executed
//     instrument. If the text existed only in the browser bundle, the server would be freezing
//     whatever the CLIENT told it the client had displayed — trusting the signer's device to report
//     the contents of a legal record. That is the wrong direction for evidence.
//   ★ So the server holds the authority and the browser renders what the server holds. The component
//     imports FROM here; nothing imports the text from the component.
//
// ═══════════════════════════════════════════════════════════════════════════
// B5 — THE ELECTRONIC RECORDS DISCLOSURE. Shown ONCE PER SIGNER, before their first signature.
//
// ── WHY IT EXISTS ─────────────────────────────────────────────────────────
// [MEASURED, in the old system] per-SECTION consent was collected on each document and
// `consentGiven`/`consentSource` were persisted on the signature record. What existed NOWHERE was
// the account-level, once-per-signer electronic-records disclosure the ESIGN Act asks for before a
// consumer is given records electronically — nor any record that a person had ever accepted one.
//
// ── THE REQUIREMENTS, VERIFIED AGAINST THE STATUTE ────────────────────────
// [VERIFIED] ESIGN Act, 15 U.S.C. 7001(c)(1). Before consent is obtained the consumer must be told:
//   a. any right to have the record on PAPER;
//   b. the right to WITHDRAW, with any conditions, consequences AND FEES;
//   c. the SCOPE — this transaction, or the whole relationship;
//   d. how to UPDATE their contact details;
//   e. how to get a PAPER COPY AFTER consenting, and whether a FEE applies;
//   f. the HARDWARE AND SOFTWARE needed to access AND RETAIN the records.
// And:
//   g. ★ consent must be given ELECTRONICALLY, "in a manner that reasonably demonstrates that the
//      consumer can access information in the electronic form that will be used". THIS IS A BUILD
//      REQUIREMENT, NOT COPY — it is why the box is ticked on that page, in the same medium and the
//      same browser that will render the agreement. A consent collected by phone or on paper would
//      not satisfy it.
//   h. withdrawal takes effect within a reasonable time after receipt.
//
// [VERIFIED] California UETA, Civil Code 1633.5: an agreement to transact electronically may NOT be
// contained in a standard form contract that is not itself an electronic record, except as a SEPARATE
// AND OPTIONAL agreement whose primary purpose is to authorise electronic transacting.
//   ★ THAT IS WHY THIS IS ITS OWN SCREEN and not a clause inside the service agreement, and why
//     declining is a real, offered choice rather than a dead end. A buried clause would fail the
//     statute on its face.
//
// ── WHY THE TEXT IS VERSIONED ─────────────────────────────────────────────
// ★★ ERSD_VERSION IS STORED WITH EVERY ACCEPTANCE. Storing a bare boolean would mean that editing
//    this file retroactively rewrites what every past signer agreed to — the record would say
//    "accepted" and point at text they never saw. The version is the evidence. When it changes,
//    consent is asked again.
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════
// ★★★ PER ORGANISATION (Batch A, the maintainer 3 Oct 2026). The wording names the organisation and gives its contact address, both taken from the organisation itself (`ersdTextFor({ orgName, contactEmail })`):
// its public name, and the address replies go to (the sending identity's reply-to; the practice's owner email when none is set). Nothing about any one practice is typed here, and there is no
// practice-only gate: every organisation shows its own name and its own monitored address.

/**
 * ★ BUMP THIS WHENEVER ERSD_TEXT CHANGES IN SUBSTANCE.
 *
 * Format: YYYY-MM-DD.n — the date the wording was settled, plus a counter for more than one revision
 * in a day. It is stored on every acceptance record, and a signer whose stored version is older than
 * this is asked again.
 *
 * A typo fix that changes no meaning does NOT need a bump; anything that changes what a person is
 * agreeing to DOES.
 */
export const ERSD_VERSION = "2026-10-03.1";   // intro now names the organisation instead of one practice

/**
 * The disclosure, in plain English.
 *
 * ★ WRITTEN FOR A PARENT IN CRISIS, NOT A LAWYER. Short sentences, no defined terms, no "hereby", no
 *   capitalised party names. Every statutory element is present but none of them is phrased as a
 *   statutory element.
 * ★ ONLY REAL ADDRESSES. The organisation's own contact address throughout (`contactEmail`, from the organisation, never typed here). No phone number and no postal
 *   address appear because there is no postal route for this — paper requests come by email, and the
 *   copy says so plainly rather than implying an address that does not exist.
 */
export const ersdTextFor = ({ orgName, contactEmail }) => Object.freeze({
  title: "Agreeing to sign and receive records electronically",
  intro:
    `${orgName} works with you directly. To sign agreements and ` +
    "receive records from us on your phone or computer, the law asks us to tell you a few " +
    "things first, and to ask whether that is alright with you. Please read this before you " +
    "sign anything.",
  sections: Object.freeze([
    {
      heading: "What you are agreeing to",
      body:
        "If you agree, we can give you agreements, notices and other records electronically " +
        "instead of on paper. Your electronic signature counts the same as a signature in ink.",
    },
    {
      // Element (c) — scope.
      heading: "This covers everything, not just today",
      body:
        "Your agreement applies to this document and to records we provide you for as long as " +
        "you are working with us. You can change your mind at any time — see below.",
    },
    {
      // Elements (a) and (e) — paper, and the fee question, answered.
      heading: "You can always have paper instead",
      body:
        "You never have to accept electronic records. You can ask us for a paper copy of " +
        `anything we have sent you, at any time, by emailing ${contactEmail}. ` +
        "There is no charge for this.",
    },
    {
      // Elements (b) and (h) — withdrawal, its consequences, its fees, its timing.
      heading: "You can change your mind",
      body:
        `You can withdraw your agreement at any time by emailing ${contactEmail} ` +
        "and telling us you no longer want records electronically. We will action it within a " +
        "reasonable time of receiving your message. Withdrawing does not end your coaching and " +
        "does not cost anything — we will simply send your records on paper from then on. It " +
        "does not undo anything you have already signed.",
    },
    {
      // Element (d) — updating contact details.
      heading: "Keeping your details up to date",
      body:
        "We will send records to the email address we have for you. If your email address " +
        `changes, tell us at ${contactEmail} so we can keep reaching you. If we ` +
        "cannot reach you electronically, we may switch you back to paper.",
    },
    {
      // Element (f) — hardware and software, for access AND retention.
      heading: "What you need to read and keep these records",
      body:
        "A device that connects to the internet — a phone, tablet or computer. A current web " +
        "browser such as Chrome, Safari, Firefox or Edge. A working email address that you can " +
        "get to. A way to view PDF files, which most phones and browsers already have. And, to " +
        "keep your own copy, either somewhere to save a file or a printer. " +
        // ★ Element (g), in plain English.
        "If you can read this page and tick the box below, your device meets these requirements.",
    },
    {
      heading: "If anything here is unclear",
      body:
        `Email ${contactEmail} and a person will get back to you. You do not have ` +
        "to agree to this to ask us a question.",
    },
  ]),
  agreeLabel: "I have read this and I agree to sign and receive records electronically.",
  acceptCta: "Continue",
  declineCta: "Not right now",
});

/**
 * Must this signer be shown the disclosure?
 *
 * ★ A STORED VERSION OLDER THAN THE CURRENT ONE MEANS ASK AGAIN. That is the entire purpose of
 *   versioning: someone who agreed to superseded wording has not agreed to the current wording, and
 *   carrying them forward would make the record claim otherwise.
 * ★ FAILS CLOSED on anything unexpected — no record, a null version, a version that does not match.
 *   Showing it once more costs a tap; skipping it wrongly loses the statutory basis for signing
 *   electronically at all.
 */
export function needsDisclosure(accepted, storedVersion, currentVersion = ERSD_VERSION) {
  if (!accepted) return true;
  if (!storedVersion) return true;
  return storedVersion !== currentVersion;
}

/**
 * ★★★ THE SNAPSHOT FRAGMENT §M0 LAW 3 ASKS FOR — BUILT FROM THE SIGNER'S OWN ACCEPTANCE.
 *
 * ★★ MY FIRST VERSION OF THIS READ THE GLOBAL CONSTANT AND CALLED the per-organisation text, SO
 *    **EVERY EXECUTION IN EVERY NON-Docustay TENANT THREW.** [EXECUTED] two document tests went red
 *    immediately. That was wrong in SCOPE, not in detail: the disclosure is the SIGNER'S once-per-
 *    person consent to receive records electronically, not a property of the instrument. An internal
 *    coach-only document has no consumer signer and needs no disclosure at all.
 *   ★ So the snapshot quotes THE ROW THE SIGNER ACCEPTED — version and the text they were shown — and
 *     when there is none it says so plainly. That is both correct and testable, and it does not block
 *     execution for a tenant whose wording has not been verified yet.
 *
 * ★★★ THREE STATUSES, AND THE THIRD IS THE POINT.
 *   · `NO_CONSUMER_SIGNER` — the instrument has no consumer signer at all (internal, staff-only).
 *     No disclosure was required, and none is missing.
 *   · `NOT_ACCEPTED`       — there IS a consumer signer and they have NO live acceptance. **A DEFECT.**
 *   · `CAPTURED`           — the version and the exact text that person was shown.
 *  ★★ MY FIRST VERSION RETURNED `NOT_ACCEPTED` FOR BOTH OF THE FIRST TWO, with prose explaining that
 *     the reader had to work out which one it was from elsewhere in the record. That is exactly the
 *     conflation this project's own test already forbade one line down — *"'not captured' must be
 *     distinguishable from 'not applicable'"* — and it would make a compliance reader auditing a book
 *     of instruments unable to separate "no consumer, fine" from "a client signed with no disclosure".
 *     **A status that needs a paragraph to disambiguate it is two statuses.**
 *
 * @param acceptance a row from `keystone.esign_disclosure_acceptance`, or null when the signer has none
 * @param opts.hasConsumerSigner whether the instrument has a consumer signer. REQUIRED — there is no
 *        safe default: assuming `true` reports a false defect on every internal document, and assuming
 *        `false` reports compliance on an instrument that a client signed with no disclosure.
 */
export function disclosureSnapshotFromAcceptance(acceptance, opts) {
  if (typeof opts?.hasConsumerSigner !== "boolean") {
    throw new Error(
      "disclosureSnapshotFromAcceptance requires opts.hasConsumerSigner as a boolean. Defaulting it " +
      "either way writes a wrong compliance statement onto a signed instrument: true invents a defect " +
      "on a staff-only document, false certifies a consumer signature that had no disclosure behind it."
    );
  }
  if (!acceptance) {
    // ★★ NAMED, NOT OMITTED. An absent field is indistinguishable from "no disclosure applied", and on
    //    a signed instrument that difference is the whole question.
    if (!opts.hasConsumerSigner) {
      return {
        status: "NO_CONSUMER_SIGNER",
        version: null,
        text: null,
        detail:
          "This instrument has no consumer signer — it is internal, signed by staff only — so no " +
          "electronic-records disclosure was required and none is missing. 15 U.S.C. 7001(c)(1) " +
          "governs consent by a CONSUMER; there is no consumer here.",
      };
    }
    return {
      status: "NOT_ACCEPTED",
      version: null,
      text: null,
      detail:
        "★ DEFECT. This instrument has a consumer signer who had NO live electronic-records disclosure " +
        "acceptance at execution. §M0 LAW 3 and 15 U.S.C. 7001(c)(1) require the disclosure to precede " +
        "a consumer's first electronic signature. This field records that it did not, rather than " +
        "leaving a reader to infer it from an absent field.",
    };
  }
  return {
    status: "CAPTURED",
    version: acceptance.version,
    // ★ THE TEXT AS SHOWN TO THAT PERSON, read from their acceptance row — NOT the current constant.
    //   Quoting today's wording on an instrument signed under older wording is precisely the
    //   retroactive rewrite the versioning exists to prevent.
    text: acceptance.text_shown ?? null,
    accepted_at: acceptance.accepted_at ?? null,
    // ★ `is_current` lets a reader see at a glance whether the signer's consent was to the wording in
    //   force at execution, without having to know the version history.
    is_current: acceptance.version === ERSD_VERSION,
    verified_against: ["15 U.S.C. 7001(c)(1)", "Cal. Civ. Code 1633.5"],
  };
}
