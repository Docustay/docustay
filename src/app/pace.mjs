// 18.34 — THE PACE SENTENCE. COMPUTED FROM ENTITLEMENT STANDING AND ATTENDANCE.
//
// ★★★ ONE COMPOSITION OF THE PACE FORECAST. The client app reads `paceSentence()` directly; the
//     invoice receipt and confirmation email may also read it (three renderings of one fact).

/**
 * Compute the pace sentence for a client's credit block.
 *
 * ★ Returns `null` when there is no block to forecast (no remaining credits, or no attendance history).
 *   A person who has never attended and has credits has no cadence to extrapolate from.
 *
 * @param {object} args
 * @param {number} args.remaining - credits still in the entitlement
 * @param {number} args.attendedLast8Weeks - sessions attended in the past 8 weeks
 * @param {Date|string} args.now - current date (for computing the target date)
 * @param {string} args.hostFirstName - the primary coach's first name
 * @returns {string|null} e.g. "At one a week you'll be through them by late October. the maintainer will offer you the next block before then."
 */
export function paceSentence({ remaining, attendedLast8Weeks, now, hostFirstName }) {
  // ★ No forecast when there is no forward motion.
  if (remaining === 0 || attendedLast8Weeks === 0) return null;

  // ★ Compute the per-week cadence from the past 8 weeks of attendance.
  const perWeek = attendedLast8Weeks / 8;

  // ★ Map the cadence to words. These boundaries are chosen to be stable across small variations.
  let cadenceWords;
  if (perWeek >= 1.75) {
    cadenceWords = "two a week";
  } else if (perWeek >= 0.75) {
    cadenceWords = "one a week";
  } else if (perWeek >= 0.4) {
    cadenceWords = "one a fortnight";
  } else {
    cadenceWords = "one a month";
  }

  // ★ Compute how many weeks until the credits are consumed.
  const weeksLeft = remaining / perWeek;

  // ★ Add weeks to the current date to find the target month.
  const nowDate = new Date(now);
  const targetDate = new Date(nowDate.getTime() + weeksLeft * 7 * 24 * 60 * 60 * 1000);

  // ★ Determine the part of the month (early, mid, or late) based on the day of the month.
  const dayOfMonth = targetDate.getDate();
  let monthPart;
  if (dayOfMonth <= 10) {
    monthPart = "early";
  } else if (dayOfMonth <= 20) {
    monthPart = "mid";
  } else {
    monthPart = "late";
  }

  // ★ Format the target month name.
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthName = monthNames[targetDate.getMonth()];

  // ★ Compose the final sentence.
  return (
    `At ${cadenceWords} you'll be through them by ${monthPart} ${monthName}. ` +
    `${hostFirstName} will offer you the next block before then.`
  );
}
