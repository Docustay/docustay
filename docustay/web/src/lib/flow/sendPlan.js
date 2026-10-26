// D-004 / D-050: what a send really does, worked out from who is on it — so the sentence under the Send button and the message after it never say "everyone is emailed" when some people sign on this device, have no address, or the workspace is in test mode.
// R8-29: in "one after another" only the first person with an address is emailed at once, so the message after sending says that instead of "everyone".
export function sendPlan(people = [], inPersonRoles = [], testMode = false, order = "all") {
  const here = new Set(inPersonRoles ?? []);
  const emailed = (people ?? []).filter((p) => p.email && !here.has(p.role)).length;
  const total = (people ?? []).length;
  const kind = testMode ? "test" : emailed === 0 ? "none" : emailed === total ? "all" : "some";
  return { kind, emailed, total, inTurn: order === "sequential" && emailed > 1 };
}
/** The "what happens next" line about email, for the Send step. */
export function nextLine(plan, t) {
  if (plan.kind === "test") return t("Test mode is on: the only email goes to you, stamped TEST.");
  if (plan.kind === "none") return t("No email is sent: everyone signs on this device.");
  if (plan.kind === "some") return t("People with an email address get a link to open the document; people signing on this device sign here.");
  if (plan.total === 1) return t("The person on it gets an email with a button to open the document.");   // Run 8 J6: one person is not "each person"
  return t("Each person gets an email with a button to open the document.");
}
/** The message shown once the document has been sent. */
export function sentLine(plan, t) {
  if (plan.kind === "test") return t("Sent as a test. The email went only to you.");
  if (plan.kind === "none") return t("Done. Nobody is emailed because everyone signs on this device.");
  if (plan.inTurn) return t("Sent. The first person has been emailed a link; the next is emailed when the one before has signed.");
  if (plan.kind === "some") return t("Sent. People with an email address have been emailed a link.");
  if (plan.total === 1) return t("Sent. The person on it has been emailed a link.");
  return t("Sent. Everyone on it has been emailed a link.");
}
