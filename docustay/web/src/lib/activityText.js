// The words for a document's activity list (Track page). The server sends each event's kind and detail with an English line; the page words it in the reader's language here
// (Run 9, F677: the English line had been printed in every language). An unknown kind falls back to the server's line, so a new kind is never blank.
import { t } from "$lib/i18n/index.svelte.js";
const WORDS = () => ({
  uploaded: t("Uploaded"), created: t("Document created"), scheduled: t("Send scheduled"), sent: t("Sent for signature"), delivered: t("Email delivered"), opened: t("Opened"), viewed: t("Viewed"),
  link_clicked: t("Opened the link"), consented: t("Agreed to sign electronically"), signed: t("Signed"), approved: t("Approved"), rejected: t("Rejected the document"), acknowledged: t("Confirmed they viewed it"),
  assisted: t("Filled in details"), declined: t("Declined"), executed: t("Completed — everyone has signed"), reminded: t("Reminder sent"), voided: t("Cancelled"), reassigned: t("Changed who signs"),
  link_reissued: t("New link sent"), expired: t("Expired"), delegated: t("Passed their part to someone else"), downloaded: t("Downloaded the signed copy"), embed_session: t("Opened signing inside another website"),
  seal_untimestamped: t("Sealed without a trusted timestamp (the timestamp service did not answer)"), seal_restamped: t("A trusted timestamp was added to the sealed copy afterwards"),
  bounced: t("Email bounced"), erased: t("Personal details removed on request"), complained: t("Reported as spam"), changes_requested: t("Asked for changes"), test_sent: t("Test sent to the sender"),
  saved: t("Saved"), verified: t("Identity checked"), hidden_by_rule: t("Left out by a rule"), witnessed: t("Witnessed"), group_closed: t("The others in the group no longer need to sign"),
  held_for_payment: t("Signed; the signature is kept while they pay"), hold_lapsed: t("The kept signature lapsed (not paid within 7 days)"), paid: t("Paid"), refunded: t("Refunded"), disputed: t("Payment disputed"),   // Run 9 Part 3.7
});
/** One event → its line. `short` gives the one-word form the progress strip uses ("Completed", not "Completed — everyone has signed"). */
export function activityText(e, { short = false } = {}) {
  if (short && e.kind === "executed") return t("Completed");
  const kind = e.kind === "uploaded" && e.detail?.origin === "created" ? "created" : e.kind;
  if (kind === "hidden_by_rule") {
    const list = [...(e.detail?.labels ?? e.detail?.sections ?? []), ...(e.detail?.pages ?? []).map((n) => t("page {n}", { n }))];
    return list.length && !short ? t("Left out by a rule: {list}", { list: list.join(", ") }) : t("Left out by a rule");
  }
  // R13-D307: the owner's email says the signer's words are on the timeline; the line now carries them
  if (kind === "changes_requested" && !short && typeof e.detail?.message === "string" && e.detail.message.trim()) return t("Asked for changes: “{message}”", { message: e.detail.message.trim() });
  return WORDS()[kind] ?? e.text ?? kind;
}
