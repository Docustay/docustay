// src/booking/policySentence.mjs — Stage 13 task 13.8, CONTRACTS.md CT-F45.
//
// ★★★ THIS MODULE WAS BEING BUILT TWICE — once in writes.mjs returning a bare string, once here
//     (originally a Stage 18 task) returning {sentence, short} — both rewriting the same three
//     src/routes/app.mjs handlers. CT-F45 ruled the {sentence, short} shape the winner and this the
//     one and only file. Stage 18's 18.39 only reduces to the refusal ORDER and the
//     `hostFirstName` argument; it does not create this module and must not duplicate it.
//
// PURE. No database, no import from writes.mjs. Input is the object policyFor() returns
// (src/booking/writes.mjs:387) — this module never re-reads a setting on its own; every word it
// produces is derived from the SAME values the route already enforced, so the sentence a client
// reads can never say something the route's own refusal disagrees with.

/**
 * @param {object} policy — the object `policyFor()` returns: client_may_reschedule,
 *   client_may_cancel, cancellation_notice_minutes, late_cancel_behaviour,
 *   late_cancel_charge_percent (and other fields this module does not read).
 * @param {object} [terms]
 * @param {string|null} [terms.hostFirstName] — the coach/host's first name. Absent, `null`, or
 *   whitespace-only all fall back to "the practice" — see the guard below.
 * @param {boolean} [terms.blockCovered] — true when the late-cancel charge is waived because the
 *   session is covered by a package/block. Only ever changes the full-charge clause.
 * @returns {{sentence: string, short: string}}
 */
export function policySentence(policy, { hostFirstName = null, blockCovered = false } = {}) {
  // ★★★ WHAT AN ABSENT NAME DOES, STATED ONCE, BINDING ON EVERY BRANCH BELOW. Normalise ONCE, at
  //     the top — every branch below uses `host`, never `hostFirstName` directly. Without this, an
  //     omitted option (`undefined`), the default (`null`), or a coach row with an empty/whitespace
  //     `display_name` (`""`/`"   "`) would put the literal string "undefined", "null", or nothing
  //     at all into a sentence a CLIENT reads. `typeof … === "string" && … .trim() !== ""` catches
  //     all three at once — `??` alone would not, because `??` passes `""` straight through.
  const host = (typeof hostFirstName === "string" && hostFirstName.trim() !== "")
    ? hostFirstName.trim()
    : "the practice";

  // H — the cancellation/reschedule notice window, worded the way a person reads a clock: an
  // exact multiple of 60 minutes is said in hours, everything else in minutes.
  const noticeMinutes = policy.cancellation_notice_minutes;
  const H = (Number.isInteger(noticeMinutes) && noticeMinutes % 60 === 0)
    ? `${noticeMinutes / 60} hours`
    : `${noticeMinutes} minutes`;

  const canReschedule = policy.client_may_reschedule === true;
  const canCancel = policy.client_may_cancel === true;

  let verbs = null;
  if (canReschedule && canCancel) verbs = "move or cancel";
  else if (canReschedule) verbs = "move";
  else if (canCancel) verbs = "cancel";

  // Neither switch is on — there is no window to state, because there is nothing the client can
  // do on their own. Say so, and stop: nothing below (the late-cancel clause) applies.
  if (verbs === null) {
    return {
      sentence: `To move or cancel, message ${host}.`,
      short: `Message ${host} to move it`,
    };
  }

  let sentence = `Free to ${verbs} up to ${H} before.`;
  const short = `Free up to ${H} before`;

  const behaviour = policy.late_cancel_behaviour;
  const percent = policy.late_cancel_charge_percent;

  if (behaviour === "charge_percent" && percent === 100) {
    sentence += " After that the session is charged in full.";
    // ★ Money words are the dangerous ones — no-show/late-cancel charging is charge, part-charge,
    //   or waive, and that is a business decision, never a default. This clause only ever ADDS the
    //   block-covered line when the caller says the block covers it; it never invents certainty
    //   the setting did not state.
    if (blockCovered === true) sentence += " It comes out of your block.";
  } else if (behaviour === "charge_percent") {
    sentence += ` After that ${percent}% of the price is charged.`;
  } else if (behaviour === "credit_back") {
    sentence += " After that the session comes out of your block.";
  } else if (behaviour === "free") {
    sentence += ` After that it's still free — just let ${host} know.`;
  }

  return { sentence, short };
}
