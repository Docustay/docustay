// Run 8 R8-47: the Check step's rows are written by the server (src/documents/pdfBody.mjs checkPdfDraft, pdfDocs.mjs getPdfDocument) in English.
// A row with a `key` is shown through the catalogue; one without (a rare wording, or a reason only the server has) falls back to its English `text`.
// Every key the server sends is listed here as a literal so the extractor puts it in the catalogue — test/r8_check_rows_translated.test.mjs fails when the two lists drift.
export const CHECK_KEYS = (t) => [
  t("{n, plural, one {# person signs} other {# people sign}}", { n: 1 }),
  t("Nobody is set to sign — add at least one person"),
  t("A person on this send has no name"),
  t("{name}: email looks right", { name: "" }),
  t("{name} has no email — add one, or mark them as signing on this device", { name: "" }),
  t("{name}: has a signature field", { name: "" }),
  t("{name} has no signature field — place one", { name: "" }),
  t("{n, plural, one {# field is assigned to a seat nobody fills} other {# fields are assigned to a seat nobody fills}}", { n: 1 }),
  t("Every field belongs to someone"),
  t("“{label}” is yours to fill in before sending (Filled in by: Sender)", { label: "" }),   // Run 9 (R8-57)
  t("Email isn't set up yet, so nobody can be emailed a link. Open Settings → Email, choose how mail goes out and send yourself a test, then send."),
  t("You chose an access code but have not set one — type it on the Send step"),
  t("{name} has no email, so an email code cannot reach them", { name: "" }),
  t("This PDF already carries a digital signature. It will be sent exactly as it is — fields cannot be added without breaking that signature."),
  t("Today's email limit is used up ({sent} of {limit}), so nobody can be emailed a link until it resets at midnight UTC. You can still send and give each person their link yourself.", { sent: 0, limit: 0 }),
  t("Your {plan} plan allows {limit} documents a month and you have sent {used}. Switch to Pay as you go to keep sending (${price} a document after the first {included}), or choose Pro.", { plan: "", limit: 0, used: 0, price: "", included: 0 }),
  t("Your {plan} plan allows {limit} documents a month and you have sent {used}. The count resets next month.", { plan: "", limit: 0, used: 0 }),
  t("{left, plural, one {Only # of today's {limit} emails is left} other {Only # of today's {limit} emails are left}}, so not everyone can be emailed a link now. It resets at midnight UTC.", { left: 0, limit: 0 }),
];

// Run 9: the rule-order problems (src/documents/rules.mjs checkRuleOrderDetailed — Check, Send and the Rules panel) and the check before sending (src/documents/sendCheck.mjs).
// test/r9_send_check.test.mjs fails when a key either file writes is missing here or untranslated.
export const RULE_KEYS = (t) => [
  t("The rule on “{box}”: {why}", { box: "", why: "" }),
  t("The rule on page {page}: {why}", { page: 1, why: "" }),
  t("The rule on “{box}” reads “{other}”, which is not a field on this document", { box: "", other: "" }),
  t("The rule on page {page} reads “{other}”, which is not a field on this document", { page: 1, other: "" }),
  t("The rule on “{box}” reads “{other}”, which the same person fills in. A rule can only use answers from people who act earlier (or that you fill in before sending).", { box: "", other: "" }),
  t("The rule on page {page} reads “{other}”, which the same person fills in. A rule can only use answers from people who act earlier (or that you fill in before sending).", { page: 1, other: "" }),
  t("The rule on “{box}” reads “{other}”, which someone later fills in. A rule can only use answers from people who act earlier.", { box: "", other: "" }),
  t("The rule on page {page} reads “{other}”, which someone later fills in. A rule can only use answers from people who act earlier.", { page: 1, other: "" }),
  t("The rule on the section “{section}” reads “{other}”. A section of a written document can only depend on what you fill in before sending, so it can be laid out before anyone signs.", { section: "", other: "" }),
  t("The formula in “{box}”: {why}", { box: "", why: "" }),
  t("The formula in “{box}” uses “{other}”, which is not a field on this document", { box: "", other: "" }),
  t("The formula in “{box}” uses “{other}”, which someone later fills in", { box: "", other: "" }),
  t("These formulas use each other in a loop: {chain}", { chain: "" }),
];
export const SEND_CHECK_KEYS = (t) => [
  t("Nobody is set to sign — add at least one person"),
  t("Every signer has a signature box"),
  t("{name} has no signature box", { name: "" }),
  t("Signing order makes sense"),
  t("Every required box has someone to fill it"),
  t("“{box}” is empty and nobody is set to fill it.", { box: "" }),
  t("“{box}” is yours to fill in before sending.", { box: "" }),
  t("“{box}” {problem}.", { box: "", problem: "" }),
  t("The email says “{email}” but the document says “{doc}”.", { email: "", doc: "" }),
  t("The email says “{email}” but nobody on this document is called {name}.", { email: "", name: "" }),
  t("The email matches the document"),
  t("The email uses the standard wording"),
];

/** The row's words in the reader's language. */
export const checkText = (it, translate) => (it?.key ? translate(it.key, it.vars ?? {}) : (it?.text ?? ""));
